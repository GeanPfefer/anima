import { ensurePlannedProjectClassification } from './planned-project-classification';

const item={state:'approved',proposal_version:3,impact_level:'low',capability:'programming',intent:{planner:'openai_project_tools_v1',execution_spec:{target:{kind:'project',reference:'anima'},permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'test',command:'npm test'}],limits:{max_attempts:3,max_duration_minutes:30}}}};

test('registra somente a classificação ausente sem iniciar claim ou attempt',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:item,error:null});
  const eq=jest.fn(()=>({maybeSingle}));const select=jest.fn(()=>({eq}));const from=jest.fn(()=>({select}));
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'item',3,()=>new Date('2026-08-25T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['current_work_intelligence_classification','record_work_intelligence_classification']);
  expect(rpc.mock.calls[1][1].p_classification).toMatchObject({risk:'low',reversibility:'reversible'});
  expect(from).toHaveBeenCalledWith('work_items');
});

test('falha fechado fora do envelope planejado',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:{...item,state:'in_progress'},error:null});
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc:jest.fn()};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable',message:expect.stringContaining('in_progress')});
  expect(client.rpc).not.toHaveBeenCalled();
});

test('classifica conservadoramente proposta estrutural já aprovada pelo humano',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:{...item,impact_level:'structural'},error:null});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{action:'recorded'},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'item',3,()=>new Date('2026-08-25T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls[1][1].p_classification).toMatchObject({complexity:'bounded',risk:'moderate',reversibility:'conditionally_reversible',planClarity:'clear',urgency:'normal'});
});

test('reconcilia corrida de escrita como replay sem duplicar classificação',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:item,error:null});let reads=0;
  const rpc=jest.fn().mockImplementation((name:string)=>name==='record_work_intelligence_classification'?Promise.resolve({data:null,error:{code:'55000',message:'revision changed'}}):Promise.resolve({data:++reads===1?null:{classification:{schemaVersion:1}},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toEqual({ok:true,replayed:true});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['current_work_intelligence_classification','record_work_intelligence_classification','current_work_intelligence_classification']);
});
