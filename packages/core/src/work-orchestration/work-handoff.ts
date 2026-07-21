import { containsSensitiveData, type ExecutionAttemptStopReason, type TerminalExecutionAttempt } from './execution-attempt';
import type { ProposalVersion, WorkItemId, WorkResultValidation } from './types';
import type { WorkClaimId } from './work-claim';

// AUTO-04 — Handoff obrigatório (Marco 003 §Handoff obrigatório).
//
// Nenhuma tentativa termina — por qualquer razão — sem deixar um estado
// transferível suficiente para que outra execução, instância ou capacidade
// continue com segurança.
//
// Este módulo NÃO cria um segundo conceito de handoff. Ele estrutura o que
// acompanha o `handoffReference` que já existe desde o INT-04:
//
// - `handoffReference` continua sendo o ponteiro canônico e opaco para o
//   artefato transferível (bundle, commit, patch, relatório). Inalterado.
// - `IntegrationHandoff` (INT-03) continua sendo a projeção do handoff para a
//   fronteira de integração, e casa por `reference`.
// - `WorkHandoffV1` é o conteúdo estruturado que torna a retomada possível.
//
// Classificação dos campos, deliberada:
//
// | Natureza    | Campos                                                     |
// |-------------|------------------------------------------------------------|
// | Correlação  | item, tentativa, versão aprovada, claim                    |
// | Canônico    | estado, razão de parada, feito, restante, decisões, riscos, próximo passo |
// | Evidência   | recursos tocados, validações, falhas, referências          |
// | Derivável   | objetivo, escopo, tentativas anteriores, estado do item    |
//
// O que é derivável **não** é repetido aqui. O objetivo e o escopo vivem na
// versão aprovada da proposta, e o handoff apenas aponta para ela: é assim que
// o contrato torna impossível ampliar escopo por handoff. Tentativas
// anteriores vivem no log append-only e não podem ser reescritas daqui.

export type WorkHandoffDefect =
  | 'invalid_handoff'
  | 'correlation_mismatch'
  | 'unsupported_success_claim'
  | 'hidden_failure'
  | 'sensitive_data'
  | 'handoff_conflict';

export type WorkHandoffResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly defect: WorkHandoffDefect; readonly explanation: string };

export interface WorkHandoffV1 {
  readonly schemaVersion: 1;
  // Correlação obrigatória (INT-02). `claimId` é nulo na execução comandada
  // do INT-04, que não cria claim.
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly claimId: WorkClaimId | null;
  // Estado alcançado.
  readonly status: TerminalExecutionAttempt['status'];
  readonly stopReason: ExecutionAttemptStopReason;
  // Ponteiro canônico para o artefato transferível — o mesmo do INT-04.
  readonly handoffReference: string;
  // Canônico: só quem executou sabe.
  readonly completedSteps: readonly string[];
  readonly remainingSteps: readonly string[];
  readonly decisions: readonly string[];
  readonly risks: readonly string[];
  readonly nextStep: string;
  // Evidência: referenciada, nunca afirmada.
  readonly touchedResources: readonly string[];
  readonly validations: readonly WorkResultValidation[];
  readonly failures: readonly string[];
  readonly evidenceReferences: readonly string[];
}

export interface BuildWorkHandoffInput {
  readonly attempt: TerminalExecutionAttempt;
  readonly claimId: WorkClaimId | null;
  readonly completedSteps: readonly string[];
  readonly remainingSteps: readonly string[];
  readonly decisions: readonly string[];
  readonly risks: readonly string[];
  readonly nextStep: string;
  readonly touchedResources: readonly string[];
  readonly validations: readonly WorkResultValidation[];
  readonly failures: readonly string[];
  readonly evidenceReferences: readonly string[];
}

const fail = (defect: WorkHandoffDefect, explanation: string): { ok: false; defect: WorkHandoffDefect; explanation: string } =>
  ({ ok: false, defect, explanation });

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validOutcomes: ReadonlySet<string> = new Set(['passed', 'failed', 'declared']);

const isStructuredList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(entry => nonBlank(entry));

const areValidations = (value: unknown): value is readonly WorkResultValidation[] =>
  Array.isArray(value)
  && value.every(entry =>
    typeof entry === 'object' && entry !== null
    && nonBlank((entry as WorkResultValidation).label)
    && validOutcomes.has((entry as WorkResultValidation).outcome));

/**
 * Todo desfecho exige handoff estruturado — inclusive o sucesso. O Marco 003 é
 * explícito: nenhuma tentativa termina por qualquer razão sem produzir estado
 * transferível. A função existe para tornar a regra consultável, não para
 * abrir exceções.
 */
export const requiresStructuredHandoff = (_status: TerminalExecutionAttempt['status']): boolean => true;

/**
 * Constrói e valida o handoff de uma tentativa encerrada.
 *
 * Fail-closed em toda ambiguidade. Em particular:
 *
 * - sucesso exige ao menos uma validação `passed`; `declared` é relato, nunca
 *   evidência, e não sustenta afirmação de sucesso;
 * - validação `failed` é incompatível com sucesso, e falha declarada sem
 *   registro em `failures` é ocultação;
 * - a correlação precisa bater exatamente com a tentativa, inclusive o
 *   `handoffReference`, para que artefato e narrativa não se separem.
 */
export function buildWorkHandoff(input: BuildWorkHandoffInput): WorkHandoffResult<WorkHandoffV1> {
  const { attempt, claimId } = input;

  if (attempt.status === undefined || !nonBlank(attempt.attemptId) || !nonBlank(attempt.workItemId)
    || !nonBlank(attempt.handoffReference)) {
    return fail('correlation_mismatch', 'A tentativa precisa estar encerrada e correlacionada para produzir handoff.');
  }
  if (claimId !== null && !nonBlank(claimId)) {
    return fail('correlation_mismatch', 'O claim associado, quando existe, precisa de identificador não vazio.');
  }

  // Estrutura mínima verificável: nada de texto livre solto.
  if (!isStructuredList(input.completedSteps) || !isStructuredList(input.remainingSteps)
    || !isStructuredList(input.decisions) || !isStructuredList(input.risks)
    || !isStructuredList(input.touchedResources) || !isStructuredList(input.failures)
    || !isStructuredList(input.evidenceReferences) || !areValidations(input.validations)) {
    return fail('invalid_handoff', 'Cada seção do handoff precisa ser uma lista estruturada sem entradas vazias.');
  }
  if (!nonBlank(input.nextStep)) {
    return fail('invalid_handoff', 'O handoff precisa recomendar um próximo passo concreto para quem retomar.');
  }
  if (input.completedSteps.length === 0 && input.remainingSteps.length === 0) {
    return fail('invalid_handoff', 'Um handoff que não diz o que foi feito nem o que resta não permite retomada.');
  }

  const failedValidations = input.validations.filter(entry => entry.outcome === 'failed');
  const passedValidations = input.validations.filter(entry => entry.outcome === 'passed');

  if (attempt.status === 'succeeded') {
    if (passedValidations.length === 0) {
      return fail('unsupported_success_claim', 'Sucesso exige ao menos uma validação aprovada; relato declarado não é evidência.');
    }
    if (failedValidations.length > 0) {
      return fail('hidden_failure', 'Uma validação reprovada é incompatível com sucesso; a falha não pode ser omitida.');
    }
  }
  if (failedValidations.length > 0 && input.failures.length === 0) {
    return fail('hidden_failure', 'Validações reprovadas precisam aparecer também entre as falhas registradas.');
  }
  if (attempt.status === 'failed' && input.failures.length === 0) {
    return fail('hidden_failure', 'Uma tentativa que falhou precisa registrar a falha encontrada.');
  }

  const sensitiveCandidates = [
    input.nextStep, ...input.completedSteps, ...input.remainingSteps, ...input.decisions, ...input.risks,
    ...input.touchedResources, ...input.failures, ...input.evidenceReferences,
    ...input.validations.map(entry => entry.label),
  ];
  if (sensitiveCandidates.some(containsSensitiveData)) {
    return fail('sensitive_data', 'O handoff não pode carregar credenciais nem caminhos absolutos locais.');
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: attempt.workItemId,
      attemptId: attempt.attemptId,
      approvedProposalVersion: attempt.approvedProposalVersion,
      claimId,
      status: attempt.status,
      stopReason: attempt.stopReason,
      handoffReference: attempt.handoffReference,
      completedSteps: input.completedSteps,
      remainingSteps: input.remainingSteps,
      decisions: input.decisions,
      risks: input.risks,
      nextStep: input.nextStep,
      touchedResources: input.touchedResources,
      validations: input.validations,
      failures: input.failures,
      evidenceReferences: input.evidenceReferences,
    },
  };
}

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

const sameValidations = (left: readonly WorkResultValidation[], right: readonly WorkResultValidation[]): boolean =>
  left.length === right.length
  && left.every((entry, index) => entry.label === right[index]?.label && entry.outcome === right[index]?.outcome);

/**
 * Reentrega do handoff da mesma tentativa. Conteúdo idêntico é idempotente;
 * divergente falha fechado, porque reescrever um handoff já registrado apagaria
 * o estado a partir do qual alguém pode ter retomado.
 */
export function reconcileWorkHandoff(existing: WorkHandoffV1, incoming: WorkHandoffV1): WorkHandoffResult<WorkHandoffV1> {
  if (existing.attemptId !== incoming.attemptId || existing.workItemId !== incoming.workItemId
    || existing.approvedProposalVersion !== incoming.approvedProposalVersion || existing.claimId !== incoming.claimId) {
    return fail('correlation_mismatch', 'O handoff reentregue pertence a outra correlação.');
  }
  const identical =
    existing.status === incoming.status
    && existing.stopReason === incoming.stopReason
    && existing.handoffReference === incoming.handoffReference
    && existing.nextStep === incoming.nextStep
    && sameList(existing.completedSteps, incoming.completedSteps)
    && sameList(existing.remainingSteps, incoming.remainingSteps)
    && sameList(existing.decisions, incoming.decisions)
    && sameList(existing.risks, incoming.risks)
    && sameList(existing.touchedResources, incoming.touchedResources)
    && sameList(existing.failures, incoming.failures)
    && sameList(existing.evidenceReferences, incoming.evidenceReferences)
    && sameValidations(existing.validations, incoming.validations);

  return identical
    ? { ok: true, value: existing }
    : fail('handoff_conflict', 'Um handoff já registrado para esta tentativa não pode ser substituído por conteúdo diferente.');
}

// Payload proposto para o log append-only. O handoff acompanha o evento de
// término da tentativa; ele NÃO substitui nenhum evento canônico e, por si só,
// não muda estado de item, de claim nem de integração.
export interface WorkHandoffPayloadV1 {
  readonly schema_version: 1;
  readonly data: {
    readonly work_item_id: WorkItemId;
    readonly attempt_id: string;
    readonly approved_proposal_version: ProposalVersion;
    readonly claim_id: WorkClaimId | null;
    readonly status: TerminalExecutionAttempt['status'];
    readonly stop_reason: ExecutionAttemptStopReason;
    readonly handoff_reference: string;
    readonly completed_steps: readonly string[];
    readonly remaining_steps: readonly string[];
    readonly decisions: readonly string[];
    readonly risks: readonly string[];
    readonly next_step: string;
    readonly touched_resources: readonly string[];
    readonly validations: readonly WorkResultValidation[];
    readonly failures: readonly string[];
    readonly evidence_references: readonly string[];
  };
}

export const buildWorkHandoffPayload = (handoff: WorkHandoffV1): WorkHandoffPayloadV1 => ({
  schema_version: 1,
  data: {
    work_item_id: handoff.workItemId,
    attempt_id: handoff.attemptId,
    approved_proposal_version: handoff.approvedProposalVersion,
    claim_id: handoff.claimId,
    status: handoff.status,
    stop_reason: handoff.stopReason,
    handoff_reference: handoff.handoffReference,
    completed_steps: handoff.completedSteps,
    remaining_steps: handoff.remainingSteps,
    decisions: handoff.decisions,
    risks: handoff.risks,
    next_step: handoff.nextStep,
    touched_resources: handoff.touchedResources,
    validations: handoff.validations,
    failures: handoff.failures,
    evidence_references: handoff.evidenceReferences,
  },
});

/**
 * Projeção do handoff para a fronteira de integração do INT-03.
 *
 * Devolve apenas a referência que o `IntegrationHandoff` já espera. É
 * deliberadamente incapaz de autorizar: integrar continua exigindo resultado
 * aceito e uma segunda decisão humana explícita. Produzir handoff nunca é
 * permissão para aplicar, mesclar ou publicar.
 */
export const readHandoffReferenceForIntegration = (handoff: WorkHandoffV1): string => handoff.handoffReference;
