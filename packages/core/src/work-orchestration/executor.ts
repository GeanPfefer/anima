import type { WorkCapability, WorkContextReference, WorkItemId } from './types';

export interface ExecutionLimits { readonly maxAttempts: number; readonly timeoutMs: number; readonly shutdownGraceMs?: number; }
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
// Contrato limitado legado de F8. INT-01 reserva WorkExecutorAdapter para o
// fluxo autônomo de sinais em work-executor-contract.ts.
export interface BoundedWorkExecutorAdapter {
  readonly id: string;
  execute(request: WorkExecutionRequest, signal: AbortSignal): Promise<ExecutorAttemptResult>;
}
// terminatedCleanly registra se o executor reconheceu o aborto e encerrou
// dentro da janela de graça; false significa execução abandonada, informação
// necessária antes de integrar executores reais com efeitos externos.
export type WorkExecutionOutcome =
  | { readonly kind: 'succeeded'; readonly executorId: string; readonly attempts: number; readonly summary: string; readonly resultReferences: readonly string[] }
  | { readonly kind: 'failed'; readonly executorId: string; readonly attempts: number; readonly message: string }
  | { readonly kind: 'timed_out'; readonly executorId: string; readonly attempts: number; readonly terminatedCleanly: boolean }
  | { readonly kind: 'cancelled'; readonly executorId: string; readonly attempts: number; readonly terminatedCleanly: boolean };

type AttemptSettlement =
  | { readonly status: 'result'; readonly result: ExecutorAttemptResult }
  | { readonly status: 'rejected'; readonly message: string };

const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;
const validLimits = ({maxAttempts,timeoutMs,shutdownGraceMs}:ExecutionLimits) =>
  Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5 &&
  Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 300_000 &&
  (shutdownGraceMs === undefined || (Number.isInteger(shutdownGraceMs) && shutdownGraceMs >= 0 && shutdownGraceMs <= 30_000));

const delay = <T>(ms:number, value:T):{promise:Promise<T>; cancel:()=>void} => {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const promise = new Promise<T>(resolve => { timer = setTimeout(()=>resolve(value), ms); });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); } };
};

export class BoundedWorkExecutor {
  async run(request: WorkExecutionRequest, adapter: BoundedWorkExecutorAdapter, signal?: AbortSignal): Promise<WorkExecutionOutcome> {
    if (!request.objective.trim() || !validLimits(request.limits)) throw new Error('Limites ou objetivo de execução inválidos.');
    const graceMs = request.limits.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    if (signal?.aborted) return { kind:'cancelled', executorId:adapter.id, attempts:0, terminatedCleanly:true };
    for (let attempt=1; attempt<=request.limits.maxAttempts; attempt++) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once:true });
      let resolveCancelled!:(value:'cancelled')=>void;
      const cancelled = new Promise<'cancelled'>(resolve => { resolveCancelled = resolve; });
      const notifyCancelled = () => resolveCancelled('cancelled');
      signal?.addEventListener('abort', notifyCancelled, { once:true });
      const timeout = delay(request.limits.timeoutMs, 'timeout' as const);
      const settlement:Promise<AttemptSettlement> = adapter.execute(request, controller.signal).then(
        result => ({ status:'result', result } as const),
        cause => ({ status:'rejected', message: cause instanceof Error ? cause.message : String(cause) } as const),
      );
      try {
        const first = await Promise.race([settlement, timeout.promise, ...(signal ? [cancelled] : [])]);
        if (first === 'timeout' || first === 'cancelled') {
          controller.abort();
          const grace = delay(graceMs, false as const);
          const terminatedCleanly = await Promise.race([settlement.then(()=>true as const), grace.promise]);
          grace.cancel();
          const kind = first === 'cancelled' ? 'cancelled' : 'timed_out';
          return { kind, executorId:adapter.id, attempts:attempt, terminatedCleanly };
        }
        if (signal?.aborted) return { kind:'cancelled', executorId:adapter.id, attempts:attempt, terminatedCleanly:true };
        if (first.status === 'rejected') return { kind:'failed', executorId:adapter.id, attempts:attempt, message:first.message };
        if (first.result.kind === 'success') return { kind:'succeeded', executorId:adapter.id, attempts:attempt, summary:first.result.summary, resultReferences:first.result.resultReferences };
        if (!first.result.retryable || attempt === request.limits.maxAttempts) return { kind:'failed', executorId:adapter.id, attempts:attempt, message:first.result.message };
      } finally {
        timeout.cancel();
        signal?.removeEventListener('abort', cancel);
        signal?.removeEventListener('abort', notifyCancelled);
      }
    }
    throw new Error('Execução terminou sem condição terminal.');
  }
}

// P1.6: início e desfecho da execução viram eventos persistidos correlacionados
// ao item, versão e executor. O executor nunca certifica a própria entrega:
// um desfecho de sucesso apenas leva o item a revisão, onde o usuário decide.
export interface PersistedWorkExecution {
  readonly workItemId: WorkItemId;
  readonly expectedProposalVersion: number;
  readonly executionId: string;
  readonly request: WorkExecutionRequest;
}
export interface WorkExecutionRecorder {
  startExecution(command: { workItemId: WorkItemId; expectedProposalVersion: number; executionId: string; executorId: string }): Promise<import('./errors').WorkOperationResult<import('./types').WorkItem>>;
  finishExecution(command: { workItemId: WorkItemId; expectedProposalVersion: number; executionId: string; outcome: WorkExecutionOutcome }): Promise<import('./errors').WorkOperationResult<import('./types').WorkItem>>;
}
export async function runPersistedWorkExecution(
  recorder: WorkExecutionRecorder,
  adapter: BoundedWorkExecutorAdapter,
  execution: PersistedWorkExecution,
  signal?: AbortSignal,
): Promise<import('./errors').WorkOperationResult<import('./types').WorkItem>> {
  if (!execution.request.objective.trim() || !validLimits(execution.request.limits)) {
    return { ok: false, error: { code: 'invalid_input', message: 'Limites ou objetivo de execução inválidos.', retryable: false } };
  }
  const started = await recorder.startExecution({ workItemId: execution.workItemId, expectedProposalVersion: execution.expectedProposalVersion, executionId: execution.executionId, executorId: adapter.id });
  if (!started.ok) return started;
  let outcome: WorkExecutionOutcome;
  try {
    outcome = await new BoundedWorkExecutor().run(execution.request, adapter, signal);
  } catch (cause) {
    outcome = { kind: 'failed', executorId: adapter.id, attempts: execution.request.limits.maxAttempts, message: cause instanceof Error ? cause.message : String(cause) };
  }
  // O retorno é persistido, nunca só mantido em memória: se a persistência do
  // desfecho falhar, o erro tipado sobe para reconciliação explícita.
  return recorder.finishExecution({ workItemId: execution.workItemId, expectedProposalVersion: execution.expectedProposalVersion, executionId: execution.executionId, outcome });
}

export class FakeBoundedWorkExecutor implements BoundedWorkExecutorAdapter {
  readonly id='fake';
  private cursor=0;
  constructor(private readonly script:readonly ExecutorAttemptResult[]) {}
  async execute(_:WorkExecutionRequest,signal:AbortSignal):Promise<ExecutorAttemptResult>{
    if(signal.aborted)return{kind:'failure',message:'cancelled',retryable:false};
    const result=this.script[Math.min(this.cursor,this.script.length-1)];this.cursor++;
    return result??{kind:'failure',message:'fake script exhausted',retryable:false};
  }
}
