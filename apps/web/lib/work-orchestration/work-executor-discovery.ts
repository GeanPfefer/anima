import { workComplexities, workPlanClarities, workReversibilities, workRisks, workUrgencies, type WorkItem } from '@anima/core';
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

export interface GovernedNextStep {
  readonly label: string;
  readonly actor: 'human' | 'supervisor';
  readonly command: string;
}

/**
 * Próximos atos governados do item, derivados SÓ do estado persistido (nunca executados pela interface).
 * Para trabalho externo a classificação humana é um ato separado entre approve e execute-one; os valores
 * permitidos vêm das listas canônicas do core, nunca de texto livre.
 */
export function nextGovernedSteps(input: {
  readonly state: string;
  readonly external: boolean;
  readonly reference: string | null;
  readonly workItemId: string;
  readonly proposalVersion: number;
}): readonly GovernedNextStep[] {
  const ref = input.reference ?? input.workItemId;
  const cli = (rest: string) => `npm run anima -- ${rest}`;
  if (input.state === 'proposed') {
    return [{ label: 'Aprovar a proposta (ato humano; também disponível no cartão acima)', actor: 'human', command: cli(`work approve ${ref}`) }];
  }
  if (input.state === 'approved') {
    const steps: GovernedNextStep[] = [];
    if (input.external) {
      steps.push({
        label: 'Classificar o trabalho externo (ato humano; ainda não verificado se já foi classificado)', actor: 'human',
        command: cli(`work external classify ${input.workItemId} --version ${input.proposalVersion} --complexity <${workComplexities.filter(v => v !== 'unknown').join('|')}> --risk <${workRisks.filter(v => v !== 'unknown').join('|')}> --reversibility <${workReversibilities.filter(v => v !== 'unknown').join('|')}> --plan-clarity <${workPlanClarities.filter(v => v !== 'unknown').join('|')}> --urgency <${workUrgencies.filter(v => v !== 'unknown').join('|')}>`),
      });
    }
    steps.push({ label: 'Executar uma volta isolada governada', actor: 'supervisor', command: governedExecuteOneCommand(input.reference, input.workItemId, input.proposalVersion) });
    return steps;
  }
  if (input.state === 'review') {
    return [
      ...(input.external ? [{ label: 'Revisar o diff real do candidato (somente leitura sem --decision)', actor: 'human' as const, command: cli(`work external review ${input.workItemId} --version ${input.proposalVersion}`) }] : []),
      { label: 'Aceitar o resultado (ato humano)', actor: 'human', command: cli(`work accept ${ref}`) },
    ];
  }
  return [];
}
