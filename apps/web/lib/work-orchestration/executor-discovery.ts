import { WORKTREE_CODER_BACKENDS, coderBackendId, type CoderProvider } from './coder-backend';
import type { ExecutionContract } from './executor-selection';

// ============================================================
// Discovery de executores de coding (Self-Dev CLI V1) — módulo PURO e READ-ONLY.
//
// Recebe o contrato aprovado e as OBSERVAÇÕES de readiness (feitas por
// `executor-readiness.ts`) e projeta, sem I/O: quais backends existem, quais estão
// utilizáveis, quais são elegíveis e qual o ANIMA recomenda. Não persiste, não
// escolhe executor, não inicia attempt. A recomendação é determinística (sem LLM,
// sem score) e reflete SÓ readiness, elegibilidade e custo — nunca afirma que o
// modelo é adequado à tarefa.
// ============================================================

export type ExecutorAvailability = 'ready' | 'unavailable' | 'unknown';
export type ExecutorEligibility = 'eligible' | 'ineligible';
export type ExecutorCostClass = 'local' | 'subscription' | 'paid_api' | 'unknown';
export type ExecutorRecommendationRule = 'contract_declared' | 'local_first';

/** Fato observado pelo seam de readiness para UM provider. Só código estável, nunca texto livre. */
export interface ExecutorObservation {
  readonly provider: CoderProvider;
  readonly availability: ExecutorAvailability;
  readonly reasonUnavailable: string | null;
}

export interface ExecutorCandidate {
  readonly provider: CoderProvider;
  /** `provider:model`. */
  readonly backendId: string;
  readonly displayName: string;
  readonly availability: ExecutorAvailability;
  readonly eligibility: ExecutorEligibility;
  readonly reasonUnavailable: string | null;
  readonly reasonIneligible: string | null;
  readonly model: string;
  readonly costClass: ExecutorCostClass;
}

export interface ExecutorChoice {
  readonly provider: CoderProvider;
  readonly backendId: string;
}

export interface ExecutorRecommendation extends ExecutorChoice {
  readonly rule: ExecutorRecommendationRule;
  readonly reason: string;
  /** Próximo elegível pronto pela mesma ordenação, ou null. */
  readonly fallback: ExecutorChoice | null;
}

export interface NoExecutorRecommendation {
  readonly reason: 'no_ready_candidate';
  readonly candidates: readonly { readonly provider: CoderProvider; readonly backendId: string; readonly reason: string }[];
}

export interface ExecutorRecommendationOutcome {
  readonly recommendation: ExecutorRecommendation | null;
  readonly noRecommendation: NoExecutorRecommendation | null;
}

/** Só o que a projeção lê do contrato aprovado. */
export type ExecutorDiscoveryContract = Pick<ExecutionContract, 'coderBackend' | 'model'>;

const DISPLAY_NAME: Readonly<Record<CoderProvider, string>> = {
  ollama: 'Ollama (local)',
  openai: 'OpenAI (API paga)',
  'deepseek-harness': 'DeepSeek Harness',
  'codex-cli': 'Codex CLI',
  'claude-code': 'Claude Code',
};

const COST_CLASS: Readonly<Record<CoderProvider, ExecutorCostClass>> = {
  ollama: 'local',
  'codex-cli': 'subscription',
  'claude-code': 'subscription',
  openai: 'paid_api',
  'deepseek-harness': 'unknown',
};

/** Modelo default de cada backend quando o contrato não declara o mesmo provider. */
const DEFAULT_MODEL: Readonly<Record<CoderProvider, string>> = {
  ollama: 'qwen3-coder:latest',
  openai: 'gpt-5.6-terra',
  'deepseek-harness': 'qwen3-coder:latest',
  'codex-cli': 'default',
  'claude-code': 'default',
};

const COST_RANK: Readonly<Record<ExecutorCostClass, number>> = { local: 0, subscription: 1, paid_api: 2, unknown: 3 };

export const PARKED_REASON = 'parked_not_operational';
export const NOT_PROBED_REASON = 'readiness_not_probed';

const SCOPE_NOTE = 'Reflete apenas readiness, elegibilidade e custo; não afirma adequação do modelo à tarefa.';

/** Cinco providers do registry, em ordem estável, com os fatos observados. */
export function projectExecutorCandidates(input: {
  readonly contract: ExecutorDiscoveryContract;
  readonly observations: readonly ExecutorObservation[];
}): readonly ExecutorCandidate[] {
  const { contract, observations } = input;
  return WORKTREE_CODER_BACKENDS.map((provider): ExecutorCandidate => {
    const observed = observations.find(observation => observation.provider === provider);
    const model = contract.coderBackend === provider && contract.model?.trim() ? contract.model.trim() : DEFAULT_MODEL[provider];
    const base = { provider, backendId: coderBackendId(provider, model), displayName: DISPLAY_NAME[provider], model, costClass: COST_CLASS[provider] };
    if (provider === 'deepseek-harness') {
      // Estacionado: nunca finge readiness, qualquer que seja a observação.
      return { ...base, availability: 'unavailable', eligibility: 'ineligible', reasonUnavailable: PARKED_REASON, reasonIneligible: PARKED_REASON };
    }
    if (!observed) {
      return { ...base, availability: 'unknown', eligibility: 'eligible', reasonUnavailable: NOT_PROBED_REASON, reasonIneligible: null };
    }
    return {
      ...base,
      availability: observed.availability,
      eligibility: 'eligible',
      reasonUnavailable: observed.availability === 'ready' ? null : observed.reasonUnavailable ?? 'unspecified',
      reasonIneligible: null,
    };
  });
}

const choiceOf = (candidate: ExecutorCandidate): ExecutorChoice => ({ provider: candidate.provider, backendId: candidate.backendId });

/** Ordenação determinística: classe de custo, depois ordem do registry (estável). */
const costOrdered = (candidates: readonly ExecutorCandidate[]): readonly ExecutorCandidate[] =>
  candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => COST_RANK[a.candidate.costClass] - COST_RANK[b.candidate.costClass] || a.index - b.index)
    .map(entry => entry.candidate);

export function recommendExecutor(
  candidates: readonly ExecutorCandidate[],
  contract: ExecutorDiscoveryContract,
): ExecutorRecommendationOutcome {
  // `unknown` nunca é recomendado.
  const usable = candidates.filter(candidate => candidate.availability === 'ready' && candidate.eligibility === 'eligible');
  if (usable.length === 0) {
    return {
      recommendation: null,
      noRecommendation: {
        reason: 'no_ready_candidate',
        candidates: candidates.map(candidate => ({
          provider: candidate.provider,
          backendId: candidate.backendId,
          reason: candidate.reasonIneligible ?? candidate.reasonUnavailable ?? 'unspecified',
        })),
      },
    };
  }
  const ordered = costOrdered(usable);
  const declared = ordered.find(candidate => candidate.provider === contract.coderBackend);
  if (declared) {
    const fallback = ordered.find(candidate => candidate !== declared);
    return {
      recommendation: {
        ...choiceOf(declared),
        rule: 'contract_declared',
        reason: `Backend declarado no contrato aprovado, pronto e elegível. ${SCOPE_NOTE}`,
        fallback: fallback ? choiceOf(fallback) : null,
      },
      noRecommendation: null,
    };
  }
  const [first, second] = ordered;
  return {
    recommendation: {
      ...choiceOf(first!),
      rule: 'local_first',
      reason: `Contrato não declara um backend pronto e elegível; menor classe de custo entre os prontos (local < subscription < paid_api), desempate pela ordem do registry. ${SCOPE_NOTE}`,
      fallback: second ? choiceOf(second) : null,
    },
    noRecommendation: null,
  };
}
