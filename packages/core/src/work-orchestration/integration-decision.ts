import type { Json } from '@anima/types';
import type { IntegrationBoundary } from './integration-boundary';
import type { ProposalVersion, WorkEvent, WorkItemId } from './types';

// ============================================================
// Persistência da decisão de integração — a SEGUNDA aprovação humana (ADR-002).
//
// Este módulo é o lado de LEITURA e o CONTRATO DE PAYLOAD do evento append-only
// `integration_decided`, que a RPC `decide_integration` grava sobre um item já
// ACEITO (`result_accepted` → item `completed`). A decisão NÃO muda o estado do
// item (não existe `WorkState` `integrated`): ela só registra, de forma auditável
// e idempotente, que o humano autorizou ou recusou a integração daquele resultado
// exato.
//
// `projectIntegrationBoundary` reconstrói a `IntegrationBoundary` ratificada
// (INT-03) a partir dos eventos persistidos, servindo tanto de read model quanto
// de ponte para o substrato de publicação do ADR-002: uma fronteira projetada em
// `integration_authorized` é exatamente a entrada de `buildIntegrationPublicationRequest`.
//
// Fronteira preservada: este módulo NÃO projeta nem grava `integrated` — marcar
// integração como realizada exige efeito externo comprovado, que só o publisher
// real (etapa posterior, atrás de nova aprovação humana) pode fornecer.
// ============================================================

export type WorkIntegrationDecision = 'authorize' | 'refuse';

/** Forma canônica do payload do evento `integration_decided` (a RPC SQL grava
 * exatamente esta estrutura em `payload.data`). */
export interface IntegrationDecisionPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly work_item_id: WorkItemId;
    readonly attempt_id: string;
    readonly approved_proposal_version: ProposalVersion;
    readonly accepted_result_event_id: string;
    readonly decision: WorkIntegrationDecision;
    readonly decision_id: string;
  };
}

// Tipos de evento comparados como string: o valor `integration_decided` ainda não
// está no enum gerado (`work_event_type`) até `supabase gen types` rodar contra a
// migration; comparar por string evita uma falsa dependência de tipo e mantém a
// projeção correta assim que o valor existir no banco.
const RESULT_SUBMITTED = 'result_submitted';
const RESULT_ACCEPTED = 'result_accepted';
const INTEGRATION_DECIDED = 'integration_decided';

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;
const dataOf = (event: WorkEvent): Record<string, Json | undefined> | null => object(object(event.payload)?.data);
const eventType = (event: WorkEvent): string => event.type;

const latestOfType = (events: readonly WorkEvent[], type: string): WorkEvent | null => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (eventType(event) === type) return event;
  }
  return null;
};

const eventById = (events: readonly WorkEvent[], id: string): WorkEvent | null => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.id === id) return event;
  }
  return null;
};

/** Reconstrói a base `result_produced` a partir de um evento `result_submitted`.
 * `null` se o evento estiver malformado (correlação/handoff ausentes). */
const producedFromResult = (result: WorkEvent): IntegrationBoundary | null => {
  const data = dataOf(result);
  const workItemId = data?.work_item_id;
  const attemptId = data?.attempt_id;
  const version = data?.approved_proposal_version;
  const reference = data?.handoff_reference;
  if (!nonBlank(workItemId) || !nonBlank(attemptId) || !positiveVersion(version) || !nonBlank(reference)) return null;
  const correlation = { attemptId, workItemId, approvedProposalVersion: version };
  return {
    status: 'result_produced',
    correlation,
    resultCorrelation: { ...correlation, origin: 'executor' },
    handoff: { kind: 'execution_result', reference, resultEventId: result.id },
  };
};

/**
 * Projeta a `IntegrationBoundary` ratificada a partir do log de eventos, do aceite
 * em diante. Fail-closed: `null` quando não há aceite, quando o resultado aceito
 * não é encontrado, ou quando qualquer elo está malformado ou incoerente. Uma
 * decisão de integração cujo `accepted_result_event_id` divirja do resultado
 * aceito é **ignorada** (sinal obsoleto), mantendo a fronteira em `result_accepted`.
 *
 * Nunca projeta `integrated`: esse estado exige efeito externo comprovado, fora
 * desta camada. O resultado é diretamente consumível por `decideIntegration`
 * (quando `result_accepted`) e por `buildIntegrationPublicationRequest` (quando
 * `integration_authorized`).
 */
export function projectIntegrationBoundary(events: readonly WorkEvent[]): IntegrationBoundary | null {
  const acceptance = latestOfType(events, RESULT_ACCEPTED);
  if (!acceptance) return null;
  const acceptedResultEventId = dataOf(acceptance)?.accepted_result_event_id;
  if (!nonBlank(acceptedResultEventId)) return null;

  const result = eventById(events, acceptedResultEventId);
  if (!result || eventType(result) !== RESULT_SUBMITTED) return null;
  const produced = producedFromResult(result);
  if (!produced) return null;

  const accepted: IntegrationBoundary = {
    ...produced,
    status: 'result_accepted',
    acceptance: {
      decisionId: acceptance.id,
      acceptedResultEventId,
      correlation: { ...produced.correlation, origin: 'user' },
    },
  };

  const decided = latestOfType(events, INTEGRATION_DECIDED);
  if (!decided) return accepted;
  const decidedData = dataOf(decided);
  // Decisão correlacionada ao MESMO resultado aceito; divergência = sinal obsoleto.
  if (decidedData?.accepted_result_event_id !== acceptedResultEventId) return accepted;
  const decision = decidedData?.decision;
  const decisionId = decidedData?.decision_id;
  if ((decision !== 'authorize' && decision !== 'refuse') || !nonBlank(decisionId)) return accepted;

  return {
    ...accepted,
    status: decision === 'authorize' ? 'integration_authorized' : 'integration_refused',
    integrationDecision: {
      decisionId,
      decision,
      correlation: { ...accepted.correlation, origin: 'user' },
    },
  };
}
