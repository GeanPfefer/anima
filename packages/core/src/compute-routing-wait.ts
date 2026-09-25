import type { WorkState } from './work-orchestration/types';

/** Duração que o Compute Router V1 pede à authority paga por volta (compute provider_api).
 * Uma authority com `maxDurationMs` menor não é compatível e a unidade continua esperando. */
export const COMPUTE_ROUTER_REQUESTED_DURATION_MS = 30 * 60_000;

/** Nó canônico do compute OpenAI (provider_api) nas authorities pagas. */
export const OPENAI_PROVIDER_API_NODE_ID = 'openai-api';

/** O envelope EXATO de authority que destrava a espera: derivado da decisão registrada,
 * nunca digitado livremente — o humano escolhe só os limites (teto, duração, validade). */
export interface ComputeAuthorityRequirementV1 {
  readonly providerId: 'openai';
  readonly nodeId: typeof OPENAI_PROVIDER_API_NODE_ID;
  readonly resourceClass: string;
  readonly model: string;
  readonly workItemId: string;
  readonly minDurationMs: number;
}

export type ComputeRoutingWaitV1 =
  | {
      readonly status: 'waiting_for_human_authorization';
      readonly reasonCode: string;
      readonly reason: string;
      readonly approvedProposalVersion: number;
      readonly decidedAt: string;
      readonly requiredAuthority: ComputeAuthorityRequirementV1;
    }
  | {
      readonly status: 'blocked';
      readonly reasonCode: string;
      readonly reason: string;
      readonly approvedProposalVersion: number;
      readonly decidedAt: string;
    };

export interface ComputeRoutingWaitEventV1 {
  readonly type: string;
  readonly proposalVersion: number | null;
  readonly payload: unknown;
  readonly occurredAt: Date;
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

/**
 * Projeção PURA: a unidade `approved` está parada no Compute Router? Lê a decisão
 * não-selecionada MAIS RECENTE da versão aprovada vigente; qualquer início de execução
 * posterior a resolve. Em espera por autoridade, devolve o envelope exato que a destrava.
 * Eventos em ordem de ocorrência (ascendente). Sem decisão pendente ⇒ null.
 */
export function projectComputeRoutingWait(input: {
  readonly workItemId: string;
  readonly state: WorkState;
  readonly proposalVersion: number;
  readonly events: readonly ComputeRoutingWaitEventV1[];
}): ComputeRoutingWaitV1 | null {
  if (input.state !== 'approved') return null;
  let pending: ComputeRoutingWaitEventV1 | null = null;
  for (const event of input.events) {
    if (event.proposalVersion !== input.proposalVersion) continue;
    if (event.type === 'compute_routing_decided') {
      const status = recordOf(recordOf(recordOf(event.payload)?.data)?.decision)?.status;
      pending = status === 'selected' ? null : event;
    } else if (event.type === 'execution_started' || event.type === 'work_started') {
      pending = null;
    }
  }
  if (!pending) return null;
  const decision = recordOf(recordOf(recordOf(pending.payload)?.data)?.decision);
  const reasonCode = text(decision?.reasonCode) ?? 'unknown';
  const reason = text(decision?.reason) ?? '';
  const common = { reasonCode, reason, approvedProposalVersion: input.proposalVersion, decidedAt: pending.occurredAt.toISOString() };
  if (decision?.status !== 'waiting_for_human_authorization') return { status: 'blocked', ...common };
  const alternatives = Array.isArray(decision.alternativesConsidered) ? decision.alternativesConsidered : [];
  const model = text(alternatives.map(recordOf).find(alt => alt?.provider === 'openai')?.model);
  // Sem o candidato OpenAI identificável a espera não é destravável por authority: bloqueio.
  if (!model) return { status: 'blocked', ...common };
  return {
    status: 'waiting_for_human_authorization', ...common,
    requiredAuthority: {
      providerId: 'openai', nodeId: OPENAI_PROVIDER_API_NODE_ID, resourceClass: `provider_api:${model}`,
      model, workItemId: input.workItemId, minDurationMs: COMPUTE_ROUTER_REQUESTED_DURATION_MS,
    },
  };
}
