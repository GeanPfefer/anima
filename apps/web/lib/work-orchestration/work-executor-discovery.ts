import type { WorkItem } from '@anima/core';
import { projectExecutorCandidates, recommendExecutor, type ExecutorCandidate, type ExecutorObservation, type ExecutorRecommendation, type NoExecutorRecommendation } from './executor-discovery';
import { readExecutionContract } from './executor-selection';
import type { CodexExecutorDiagnostic } from './codex-executor-diagnostics';

// ============================================================
// Descoberta de executores de UM work item — serviço compartilhado por CLI (`anima work executors`)
// e web (`GET /api/work-orchestration/items/[id]/executors`). READ-ONLY: não persiste, não grava evento,
// não escolhe executor nem inicia attempt. A regra vive em `executor-discovery.ts`; aqui só se compõe
// contrato + observações + diagnóstico para que as duas superfícies exibam EXATAMENTE o mesmo resultado.
// ============================================================

export interface WorkExecutorDiscovery {
  readonly contractBackend: string | null;
  readonly observedAt: string;
  readonly candidates: readonly ExecutorCandidate[];
  readonly recommendation: ExecutorRecommendation | null;
  readonly noRecommendation: NoExecutorRecommendation | null;
  readonly codex: CodexExecutorDiagnostic | null;
}

export async function discoverWorkItemExecutors(input: {
  readonly item: Pick<WorkItem, 'intent'>;
  readonly probe: () => Promise<readonly ExecutorObservation[]>;
  readonly diagnoseCodex?: (observation: ExecutorObservation) => Promise<CodexExecutorDiagnostic>;
  readonly now?: () => Date;
}): Promise<WorkExecutorDiscovery> {
  const contract = readExecutionContract(input.item.intent);
  const observations = await input.probe();
  const codexObservation = observations.find(o => o.provider === 'codex-cli');
  const codex = input.diagnoseCodex && codexObservation ? await input.diagnoseCodex(codexObservation).catch(() => null) : null;
  const candidates = projectExecutorCandidates({ contract, observations });
  const outcome = recommendExecutor(candidates, contract);
  return {
    contractBackend: contract.coderBackend ?? null,
    observedAt: (input.now ?? (() => new Date()))().toISOString(),
    candidates,
    recommendation: outcome.recommendation,
    noRecommendation: outcome.noRecommendation,
    codex,
  };
}

/** Comando governado EXATO que o humano roda para uma volta isolada. Nunca é executado pela interface. */
export function governedExecuteOneCommand(reference: string | null, workItemId: string, proposalVersion: number): string {
  return `npm run anima -- work execute-one ${reference ?? workItemId} --version ${proposalVersion}`;
}
