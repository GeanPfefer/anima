import type { WorkCapability, WorkContextReference, WorkItemId } from './types';

export interface ExecutionLimits { readonly maxAttempts: number; readonly timeoutMs: number; }
export interface WorkExecutionRequest {
  readonly workItemId: WorkItemId;
  readonly capability: WorkCapability;
  readonly objective: string;
  readonly contextReferences: readonly WorkContextReference[];
  readonly limits: ExecutionLimits;
}
export type ExecutorAttemptResult =
  | { readonly kind: 'success'; readonly summary: string; readonly resultReferences: readonly string[] }
  | { readonly kind: 'failure'; readonly message: string; readonly retryable: boolean };
export interface WorkExecutorAdapter {
  readonly id: string;
  execute(request: WorkExecutionRequest, signal: AbortSignal): Promise<ExecutorAttemptResult>;
}
export type WorkExecutionOutcome =
  | { readonly kind: 'succeeded'; readonly executorId: string; readonly attempts: number; readonly summary: string; readonly resultReferences: readonly string[] }
  | { readonly kind: 'failed'; readonly executorId: string; readonly attempts: number; readonly message: string }
  | { readonly kind: 'timed_out'; readonly executorId: string; readonly attempts: number }
  | { readonly kind: 'cancelled'; readonly executorId: string; readonly attempts: number };

const validLimits = ({maxAttempts,timeoutMs}:ExecutionLimits) => Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5 && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 300_000;

export class BoundedWorkExecutor {
  async run(request: WorkExecutionRequest, adapter: WorkExecutorAdapter, signal?: AbortSignal): Promise<WorkExecutionOutcome> {
    if (!request.objective.trim() || !validLimits(request.limits)) throw new Error('Limites ou objetivo de execução inválidos.');
    if (signal?.aborted) return {kind:'cancelled',executorId:adapter.id,attempts:0};
    for (let attempt=1;attempt<=request.limits.maxAttempts;attempt++) {
      const controller=new AbortController();
      const cancel=()=>controller.abort(); signal?.addEventListener('abort',cancel,{once:true});
      let timer:ReturnType<typeof setTimeout>|undefined;
      const timeout=new Promise<'timeout'>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve('timeout');},request.limits.timeoutMs)});
      const cancelled=new Promise<'cancelled'>(resolve=>controller.signal.addEventListener('abort',()=>{if(signal?.aborted)resolve('cancelled')},{once:true}));
      const result=await Promise.race([adapter.execute(request,controller.signal),timeout,cancelled]);
      if(timer)clearTimeout(timer); signal?.removeEventListener('abort',cancel);
      if(signal?.aborted) return {kind:'cancelled',executorId:adapter.id,attempts:attempt};
      if(result==='cancelled') return {kind:'cancelled',executorId:adapter.id,attempts:attempt};
      if(result==='timeout') return {kind:'timed_out',executorId:adapter.id,attempts:attempt};
      if(result.kind==='success') return {kind:'succeeded',executorId:adapter.id,attempts:attempt,summary:result.summary,resultReferences:result.resultReferences};
      if(!result.retryable||attempt===request.limits.maxAttempts) return {kind:'failed',executorId:adapter.id,attempts:attempt,message:result.message};
    }
    throw new Error('Execução terminou sem condição terminal.');
  }
}

export class FakeWorkExecutor implements WorkExecutorAdapter {
  readonly id='fake';
  private cursor=0;
  constructor(private readonly script:readonly ExecutorAttemptResult[]) {}
  async execute(_:WorkExecutionRequest,signal:AbortSignal):Promise<ExecutorAttemptResult>{
    if(signal.aborted)return{kind:'failure',message:'cancelled',retryable:false};
    const result=this.script[Math.min(this.cursor,this.script.length-1)];this.cursor++;
    return result??{kind:'failure',message:'fake script exhausted',retryable:false};
  }
}
