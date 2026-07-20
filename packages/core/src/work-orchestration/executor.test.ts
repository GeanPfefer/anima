import { BoundedWorkExecutor, FakeBoundedWorkExecutor, runPersistedWorkExecution, type WorkExecutionOutcome, type WorkExecutionRequest, type BoundedWorkExecutorAdapter, type WorkExecutionRecorder, type WorkItem, type WorkOperationResult } from '.';
const request:WorkExecutionRequest={workItemId:'w',capability:'programming',objective:'Validar contrato',contextReferences:[{kind:'message',id:'m'}],limits:{maxAttempts:2,timeoutMs:50,shutdownGraceMs:20}};
describe('fronteira limitada de executores',()=>{
  test('retorna sucesso sem conhecer fornecedor',async()=>{const result=await new BoundedWorkExecutor().run(request,new FakeBoundedWorkExecutor([{kind:'success',summary:'feito',resultReferences:['local:x']}]));expect(result).toEqual({kind:'succeeded',executorId:'fake',attempts:1,summary:'feito',resultReferences:['local:x']});});
  test('repete somente falha retryable até o limite',async()=>{const result=await new BoundedWorkExecutor().run(request,new FakeBoundedWorkExecutor([{kind:'failure',message:'transiente',retryable:true},{kind:'failure',message:'fim',retryable:true}]));expect(result).toEqual({kind:'failed',executorId:'fake',attempts:2,message:'fim'});});
  test('não repete falha terminal',async()=>{const result=await new BoundedWorkExecutor().run(request,new FakeBoundedWorkExecutor([{kind:'failure',message:'inválido',retryable:false}]));expect(result).toEqual({kind:'failed',executorId:'fake',attempts:1,message:'inválido'});});
  test('rejeição do executor vira resultado tipado',async()=>{const adapter:BoundedWorkExecutorAdapter={id:'broken',execute:()=>Promise.reject(new Error('quebrou'))};const result=await new BoundedWorkExecutor().run(request,adapter);expect(result).toEqual({kind:'failed',executorId:'broken',attempts:1,message:'quebrou'});});
  test('timeout de executor que ignora aborto registra encerramento sujo',async()=>{const adapter:BoundedWorkExecutorAdapter={id:'slow',execute:()=>new Promise(()=>{})};const result=await new BoundedWorkExecutor().run({...request,limits:{maxAttempts:2,timeoutMs:5,shutdownGraceMs:10}},adapter);expect(result).toEqual({kind:'timed_out',executorId:'slow',attempts:1,terminatedCleanly:false});});
  test('timeout aguarda executor reconhecer o aborto',async()=>{const adapter:BoundedWorkExecutorAdapter={id:'graceful',execute:(_,signal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({kind:'failure',message:'shutdown',retryable:false}),{once:true}))};const result=await new BoundedWorkExecutor().run({...request,limits:{maxAttempts:2,timeoutMs:5,shutdownGraceMs:1000}},adapter);expect(result).toEqual({kind:'timed_out',executorId:'graceful',attempts:1,terminatedCleanly:true});});
  test('propaga cancelamento com encerramento reconhecido',async()=>{const controller=new AbortController();const adapter:BoundedWorkExecutorAdapter={id:'waiting',execute:(_,signal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({kind:'failure',message:'abort',retryable:false}),{once:true}))};const pending=new BoundedWorkExecutor().run(request,adapter,controller.signal);controller.abort();expect(await pending).toEqual({kind:'cancelled',executorId:'waiting',attempts:1,terminatedCleanly:true});});
  test('cancelamento ignorado pelo executor registra encerramento sujo',async()=>{const controller=new AbortController();const adapter:BoundedWorkExecutorAdapter={id:'stuck',execute:()=>new Promise(()=>{})};const pending=new BoundedWorkExecutor().run({...request,limits:{maxAttempts:1,timeoutMs:5000,shutdownGraceMs:10}},adapter,controller.signal);controller.abort();expect(await pending).toEqual({kind:'cancelled',executorId:'stuck',attempts:1,terminatedCleanly:false});});
  test('recusa ciclos ilimitados',async()=>{await expect(new BoundedWorkExecutor().run({...request,limits:{maxAttempts:6,timeoutMs:50}},new FakeBoundedWorkExecutor([]))).rejects.toThrow('inválidos');});
});

describe('execução persistida',()=>{
  const workItem={id:'w'} as WorkItem;
  const ok=():Promise<WorkOperationResult<WorkItem>>=>Promise.resolve({ok:true,value:workItem});
  const execution={workItemId:'w',expectedProposalVersion:2,executionId:'exec-1',request};
  test('persiste início e desfecho correlacionados',async()=>{
    const finished:WorkExecutionOutcome[]=[];
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(ok),finishExecution:jest.fn(command=>{finished.push(command.outcome);return ok();})};
    const result=await runPersistedWorkExecution(recorder,new FakeBoundedWorkExecutor([{kind:'success',summary:'feito',resultReferences:['local:x']}]),execution);
    expect(result.ok).toBe(true);
    expect(recorder.startExecution).toHaveBeenCalledWith({workItemId:'w',expectedProposalVersion:2,executionId:'exec-1',executorId:'fake'});
    expect(finished).toEqual([{kind:'succeeded',executorId:'fake',attempts:1,summary:'feito',resultReferences:['local:x']}]);
  });
  test('não executa quando o início não pode ser persistido',async()=>{
    const adapter:BoundedWorkExecutorAdapter={id:'fake',execute:jest.fn()};
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(async()=>({ok:false as const,error:{code:'version_conflict' as const,message:'Conflito.',retryable:false}})),finishExecution:jest.fn(ok)};
    const result=await runPersistedWorkExecution(recorder,adapter,execution);
    expect(result).toMatchObject({ok:false,error:{code:'version_conflict'}});
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(recorder.finishExecution).not.toHaveBeenCalled();
  });
  test('falha ao persistir o desfecho sobe como erro tipado',async()=>{
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(ok),finishExecution:jest.fn(async()=>({ok:false as const,error:{code:'persistence_failure' as const,message:'Sem banco.',retryable:true}}))};
    const result=await runPersistedWorkExecution(recorder,new FakeBoundedWorkExecutor([{kind:'success',summary:'feito',resultReferences:[]}]),execution);
    expect(result).toMatchObject({ok:false,error:{code:'persistence_failure'}});
  });
  test('desfecho tardio rejeitado pelo contrato não é reinterpretado',async()=>{
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(ok),finishExecution:jest.fn(async()=>({ok:false as const,error:{code:'version_conflict' as const,message:'O item mudou desde a última leitura.',retryable:false}}))};
    const result=await runPersistedWorkExecution(recorder,new FakeBoundedWorkExecutor([{kind:'success',summary:'tardio',resultReferences:[]}]),execution);
    expect(result).toMatchObject({ok:false,error:{code:'version_conflict'}});
  });
  test('timeout persiste desfecho tipado com encerramento sujo',async()=>{
    const finished:WorkExecutionOutcome[]=[];
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(ok),finishExecution:jest.fn(command=>{finished.push(command.outcome);return ok();})};
    const adapter:BoundedWorkExecutorAdapter={id:'slow',execute:()=>new Promise(()=>{})};
    await runPersistedWorkExecution(recorder,adapter,{...execution,request:{...request,limits:{maxAttempts:1,timeoutMs:5,shutdownGraceMs:10}}});
    expect(finished).toEqual([{kind:'timed_out',executorId:'slow',attempts:1,terminatedCleanly:false}]);
  });
  test('pedido inválido falha tipado sem registrar início',async()=>{
    const recorder:WorkExecutionRecorder={startExecution:jest.fn(ok),finishExecution:jest.fn(ok)};
    const result=await runPersistedWorkExecution(recorder,new FakeBoundedWorkExecutor([]),{...execution,request:{...request,limits:{maxAttempts:9,timeoutMs:50}}});
    expect(result).toMatchObject({ok:false,error:{code:'invalid_input'}});
    expect(recorder.startExecution).not.toHaveBeenCalled();
  });
});
