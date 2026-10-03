import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem } from './types';
import { parseWorktreeHandoff, type WorktreeHandoffV1 } from './worktree-handoff';

// ============================================================
// Completed → Integrated V0 (2026-09-28) — integração CANÔNICA de resultado aceito em dev.
//
// Cadeia preservada, cada elo é um fato distinto:
//   Verifier ≠ aceite humano (`result_accepted` ⇒ `completed`) ≠ autorização de merge
//   (`integration_effect_authorized`, author=user) ≠ execução (efeito Git observado ⇒
//   `integration_completed`, author=system).
//
// `integration_decided` (V1) NÃO é reinterpretado como autorização de merge: ele é a
// decisão genérica que alimenta branch publication / PR. A autorização de merge é um
// evento próprio que CONGELA o efeito exato: resultado aceito, commit do resultado
// (derivado do handoff persistido), repositório, alvo, SHA-alvo esperado e modo.
//
// Alvo SOMENTE `refs/heads/dev`. Modos: `merge_no_ff` (V0, merge commit de dois pais) e
// `ff_only` (V1: avança dev para o commit EXATO do resultado, sem commit novo). O modo é
// escolhido na autorização humana e congelado na chave de operação; nunca há fallback de um
// modo para o outro. `main`, `origin/main` e qualquer outro alvo são negados.
// `work_items.state` continua `completed`: `integrated` é projeção do receipt.
// Módulo PURO — o Git mora no executor web.
// ============================================================

export const INTEGRATION_EFFECT_TARGET_REF = 'refs/heads/dev' as const;
/** Modo V0 (histórico). NÃO é default silencioso do `ff_only`: o modo é sempre explícito na autorização. */
export const INTEGRATION_EFFECT_MODE = 'merge_no_ff' as const;
export const INTEGRATION_EFFECT_MODE_FF_ONLY = 'ff_only' as const;
export type IntegrationEffectMode = typeof INTEGRATION_EFFECT_MODE | typeof INTEGRATION_EFFECT_MODE_FF_ONLY;

/** Comparação EXATA: `fast_forward`, `ff`, vazio e qualquer outro valor são negados. */
export function isAllowedIntegrationMode(mode: unknown): mode is IntegrationEffectMode {
  return mode === INTEGRATION_EFFECT_MODE || mode === INTEGRATION_EFFECT_MODE_FF_ONLY;
}
const AUTHORIZED = 'integration_effect_authorized';
const COMPLETED = 'integration_completed';
const SHA = /^[a-f0-9]{40}$/;

/** Único alvo permitido no V0. Comparação EXATA: `main`, `origin/main`, `refs/heads/main`,
 * `dev` sem prefixo, refs remotas e qualquer outro valor são negados. */
export function isAllowedIntegrationTargetRef(ref: unknown): ref is typeof INTEGRATION_EFFECT_TARGET_REF {
  return ref === INTEGRATION_EFFECT_TARGET_REF;
}

export interface IntegrationEffectAuthorizationV1 {
  readonly eventId: string;
  readonly authorizationId: string;
  readonly operationKey: string;
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly attemptId: string;
  readonly acceptedResultEventId: string;
  readonly resultCommitSha: string;
  readonly repositoryId: string;
  readonly targetRef: string;
  readonly expectedTargetSha: string;
  readonly mode: string;
}

export interface IntegrationEffectReceiptV1 {
  readonly kind: 'integration_effect';
  readonly operationKey: string;
  readonly authorizationId: string;
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly attemptId: string;
  readonly acceptedResultEventId: string;
  readonly resultCommitSha: string;
  readonly repositoryId: string;
  readonly targetRef: string;
  readonly mode: string;
  readonly previousTargetSha: string;
  readonly resultingTargetSha: string;
  /** `merge_no_ff`: SHA do merge commit criado. `ff_only`: `null` — NENHUM commit foi criado. */
  readonly mergeCommitSha: string | null;
  /** `merge_no_ff`: `[alvo esperado, resultado]`. `ff_only`: `[]` (sem merge). */
  readonly mergeParents: readonly string[];
  readonly observed: true;
  /** `effected`: esta execução fez o efeito; `reconciled`: efeito exato comprovado por inspeção. */
  readonly disposition: 'effected' | 'reconciled';
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;
const dataOf = (event: WorkEvent): Record<string, Json | undefined> | null => object(object(event.payload)?.data);
const str = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const int = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Chave de operação — espelho exato de `authorize_integration_effect` (SQL). */
export function integrationOperationKey(parts: {
  readonly authorizationId: string;
  readonly acceptedResultEventId: string;
  readonly repositoryId: string;
  readonly targetRef: string;
  readonly expectedTargetSha: string;
  readonly resultCommitSha: string;
  readonly mode: string;
}): string {
  return ['integration-effect', parts.authorizationId, parts.acceptedResultEventId, parts.repositoryId,
    parts.targetRef, parts.expectedTargetSha, parts.resultCommitSha, parts.mode].join(':');
}

/** Autorização persistida pelo id. Só `author=user` conta; forma inválida ⇒ `null`. */
export function projectIntegrationEffectAuthorization(
  events: readonly WorkEvent[],
  authorizationId: string,
): IntegrationEffectAuthorizationV1 | null {
  for (const event of events) {
    if (event.type !== AUTHORIZED || event.author !== 'user') continue;
    const d = dataOf(event);
    if (d?.authorization_id !== authorizationId) continue;
    if (!str(d.operation_key) || !str(d.work_item_id) || !int(d.approved_proposal_version) || !str(d.attempt_id)
      || !str(d.accepted_result_event_id) || !str(d.result_commit_sha) || !SHA.test(d.result_commit_sha)
      || !str(d.repository_id) || !str(d.target_ref) || !str(d.expected_target_sha) || !SHA.test(d.expected_target_sha)
      || !str(d.mode)) return null;
    return {
      eventId: event.id, authorizationId, operationKey: d.operation_key, workItemId: d.work_item_id,
      proposalVersion: d.approved_proposal_version, attemptId: d.attempt_id, acceptedResultEventId: d.accepted_result_event_id,
      resultCommitSha: d.result_commit_sha, repositoryId: d.repository_id, targetRef: d.target_ref,
      expectedTargetSha: d.expected_target_sha, mode: d.mode,
    };
  }
  return null;
}

const isReceipt = (value: Json | undefined): value is Json => {
  const r = object(value);
  return r !== null && r.kind === 'integration_effect' && Array.isArray(r.mergeParents);
};

/**
 * Receipt persistido do item (V0: no máximo um). Trusted System Writer V0: só conta evento
 * `author=system` (a RPC só executa para o writer de sistema). Defesa em profundidade — NÃO
 * substitui a fronteira de identidade, e o banco sozinho não prova Git.
 */
export function projectIntegrationCompleted(
  events: readonly WorkEvent[],
): { readonly authorizationId: string; readonly receipt: IntegrationEffectReceiptV1 } | null {
  for (const event of events) {
    if (event.type !== COMPLETED || event.author !== 'system') continue;
    const d = dataOf(event);
    if (!str(d?.authorization_id) || !isReceipt(d?.receipt)) return null;
    return { authorizationId: d.authorization_id, receipt: d.receipt as unknown as IntegrationEffectReceiptV1 };
  }
  return null;
}

/** O receipt reproduz INTEGRALMENTE a autorização e descreve o efeito exato esperado PARA O MODO? */
export function integrationReceiptMatchesAuthorization(
  authorization: IntegrationEffectAuthorizationV1,
  receipt: IntegrationEffectReceiptV1,
): boolean {
  const common = receipt.kind === 'integration_effect'
    && receipt.operationKey === authorization.operationKey
    && receipt.authorizationId === authorization.authorizationId
    && receipt.workItemId === authorization.workItemId
    && receipt.proposalVersion === authorization.proposalVersion
    && receipt.attemptId === authorization.attemptId
    && receipt.acceptedResultEventId === authorization.acceptedResultEventId
    && receipt.resultCommitSha === authorization.resultCommitSha
    && receipt.repositoryId === authorization.repositoryId
    && receipt.targetRef === authorization.targetRef
    && isAllowedIntegrationTargetRef(receipt.targetRef)
    && receipt.mode === authorization.mode
    && receipt.previousTargetSha === authorization.expectedTargetSha
    && receipt.observed === true
    && (receipt.disposition === 'effected' || receipt.disposition === 'reconciled');
  if (!common) return false;
  const parents = receipt.mergeParents;
  if (authorization.mode === INTEGRATION_EFFECT_MODE_FF_ONLY) {
    // ff_only: o alvo passou a ser EXATAMENTE o commit do resultado; nenhum commit/merge foi criado.
    return receipt.mergeCommitSha === null
      && receipt.resultingTargetSha === authorization.resultCommitSha
      && Array.isArray(parents) && parents.length === 0;
  }
  if (authorization.mode !== INTEGRATION_EFFECT_MODE) return false;
  return receipt.mergeCommitSha !== null && SHA.test(receipt.mergeCommitSha)
    && receipt.resultingTargetSha === receipt.mergeCommitSha
    && Array.isArray(parents) && parents.length === 2
    && parents[0] === authorization.expectedTargetSha && parents[1] === authorization.resultCommitSha;
}

export type IntegrationProjectionStatus = 'integrated' | 'not_integrated' | 'invalid_receipt';

/**
 * `integrated` é PROJEÇÃO: só com receipt `author=system` cuja autorização humana
 * (`author=user`) exista no log e que a reproduza integralmente. `work_items.state`
 * continua `completed`.
 */
export function projectIntegrationStatus(events: readonly WorkEvent[]): IntegrationProjectionStatus {
  const completed = projectIntegrationCompleted(events);
  if (!completed) return 'not_integrated';
  const authorization = projectIntegrationEffectAuthorization(events, completed.authorizationId);
  if (!authorization || !integrationReceiptMatchesAuthorization(authorization, completed.receipt)) return 'invalid_receipt';
  return 'integrated';
}

export type IntegrationEffectPlanDefect =
  | 'authorization_not_found'
  | 'item_mismatch'
  | 'item_not_completed'
  | 'proposal_version_changed'
  | 'acceptance_missing'
  | 'accepted_result_changed'
  | 'result_not_found'
  | 'handoff_not_found'
  | 'attempt_mismatch'
  | 'result_commit_mismatch'
  | 'target_not_allowed'
  | 'mode_not_allowed'
  | 'repository_mismatch'
  | 'operation_key_mismatch';

export interface IntegrationEffectPlan {
  readonly authorization: IntegrationEffectAuthorizationV1;
  readonly handoff: WorktreeHandoffV1;
  /** Receipt já persistido (idempotência / verificação de drift), se houver. */
  readonly persisted: IntegrationEffectReceiptV1 | null;
  /** O receipt persistido NÃO reproduz esta autorização (integridade). */
  readonly persistedMismatch: boolean;
}

export type IntegrationEffectPlanResult =
  | { readonly ok: true; readonly plan: IntegrationEffectPlan }
  | { readonly ok: false; readonly defect: IntegrationEffectPlanDefect };

/**
 * Revalida, SOMENTE a partir de fatos persistidos + configuração confiável, que a
 * autorização ainda descreve o efeito exato do resultado aceito vigente. O chamador
 * fornece apenas identidades opacas (item, autorização).
 */
export function planIntegrationEffect(input: {
  readonly item: WorkItem;
  readonly events: readonly WorkEvent[];
  readonly authorizationId: string;
  /** Repositório configurado no servidor (nunca do payload). */
  readonly trustedRepositoryId: string;
}): IntegrationEffectPlanResult {
  const deny = (defect: IntegrationEffectPlanDefect): IntegrationEffectPlanResult => ({ ok: false, defect });
  const { item, events } = input;
  const auth = projectIntegrationEffectAuthorization(events, input.authorizationId);
  if (!auth) return deny('authorization_not_found');
  if (auth.workItemId !== item.id) return deny('item_mismatch');
  if (item.state !== 'completed') return deny('item_not_completed');
  if (auth.proposalVersion !== item.proposalVersion) return deny('proposal_version_changed');
  if (!isAllowedIntegrationTargetRef(auth.targetRef)) return deny('target_not_allowed');
  if (!isAllowedIntegrationMode(auth.mode)) return deny('mode_not_allowed');
  if (auth.repositoryId !== input.trustedRepositoryId) return deny('repository_mismatch');

  let acceptance: WorkEvent | null = null;
  for (const event of events) if (event.type === 'result_accepted') acceptance = event;
  if (!acceptance) return deny('acceptance_missing');
  if (dataOf(acceptance)?.accepted_result_event_id !== auth.acceptedResultEventId) return deny('accepted_result_changed');

  const result = events.find((event) => event.id === auth.acceptedResultEventId && event.type === 'result_submitted');
  if (!result || result.proposalVersion !== item.proposalVersion) return deny('result_not_found');
  const signal = object(dataOf(result)?.executor_signal);
  const handoff = parseWorktreeHandoff(signal?.worktreeHandoff);
  if (!handoff) return deny('handoff_not_found');
  if (handoff.attemptId !== auth.attemptId || dataOf(result)?.attempt_id !== auth.attemptId) return deny('attempt_mismatch');
  if (handoff.commitSha !== auth.resultCommitSha) return deny('result_commit_mismatch');
  if (integrationOperationKey(auth) !== auth.operationKey) return deny('operation_key_mismatch');

  const completed = projectIntegrationCompleted(events);
  const persisted = completed?.receipt ?? null;
  const persistedMismatch = completed !== null
    && (completed.authorizationId !== auth.authorizationId || !integrationReceiptMatchesAuthorization(auth, completed.receipt));
  return { ok: true, plan: { authorization: auth, handoff, persisted, persistedMismatch } };
}

/** Fatos Git observados sobre o alvo (inspeção independente do efeito). */
export interface IntegrationTargetObservation {
  readonly targetSha: string;
  /** Pais do commit apontado pelo alvo (vazio para commit raiz). */
  readonly targetParents: readonly string[];
  /** O commit do resultado é ancestral do (ou igual ao) alvo? */
  readonly resultCommitInTarget: boolean;
  /** `ff_only`: o SHA-alvo esperado (autorizado) é ancestral do alvo observado? Ausente ⇒ falso. */
  readonly expectedTargetInTargetHistory?: boolean;
}

export type IntegrationTargetClassification =
  /** Alvo no SHA esperado: o efeito pode ser preparado. */
  | 'ready'
  /** O alvo É o merge exato autorizado (pais [esperado, resultado]): efeito já feito. */
  | 'already_effected'
  /** Alvo contém o commit do resultado sem ser o merge exato: não concluir sucesso. */
  | 'ambiguous'
  /** Alvo avançou: a autorização envelheceu — nova decisão humana. */
  | 'stale';

export function classifyIntegrationTarget(
  authorization: IntegrationEffectAuthorizationV1,
  observation: IntegrationTargetObservation,
): IntegrationTargetClassification {
  if (observation.targetSha === authorization.expectedTargetSha) return 'ready';
  if (authorization.mode === INTEGRATION_EFFECT_MODE_FF_ONLY) {
    // ff_only já efetuado = o alvo É o commit do resultado E descende do SHA-alvo autorizado.
    if (observation.targetSha === authorization.resultCommitSha && observation.expectedTargetInTargetHistory === true) return 'already_effected';
    return observation.resultCommitInTarget ? 'ambiguous' : 'stale';
  }
  const [first, second, ...rest] = observation.targetParents;
  if (rest.length === 0 && first === authorization.expectedTargetSha && second === authorization.resultCommitSha) {
    return 'already_effected';
  }
  if (observation.resultCommitInTarget) return 'ambiguous';
  return 'stale';
}

export function buildIntegrationEffectReceipt(
  authorization: IntegrationEffectAuthorizationV1,
  observed: { readonly mergeCommitSha: string | null; readonly mergeParents: readonly string[]; readonly resultingTargetSha: string },
  disposition: IntegrationEffectReceiptV1['disposition'],
): IntegrationEffectReceiptV1 | null {
  let mergeCommitSha: string | null;
  let mergeParents: readonly string[];
  if (authorization.mode === INTEGRATION_EFFECT_MODE_FF_ONLY) {
    // Nenhum commit novo: o alvo observado É o commit do resultado.
    if (observed.mergeCommitSha !== null || observed.mergeParents.length !== 0
      || observed.resultingTargetSha !== authorization.resultCommitSha) return null;
    mergeCommitSha = null;
    mergeParents = [];
  } else if (authorization.mode === INTEGRATION_EFFECT_MODE) {
    const [first, second, ...rest] = observed.mergeParents;
    if (observed.mergeCommitSha === null || !SHA.test(observed.mergeCommitSha) || observed.resultingTargetSha !== observed.mergeCommitSha
      || rest.length > 0 || first !== authorization.expectedTargetSha || second !== authorization.resultCommitSha) {
      return null;
    }
    mergeCommitSha = observed.mergeCommitSha;
    mergeParents = [first, second];
  } else {
    return null;
  }
  return {
    kind: 'integration_effect',
    operationKey: authorization.operationKey,
    authorizationId: authorization.authorizationId,
    workItemId: authorization.workItemId,
    proposalVersion: authorization.proposalVersion,
    attemptId: authorization.attemptId,
    acceptedResultEventId: authorization.acceptedResultEventId,
    resultCommitSha: authorization.resultCommitSha,
    repositoryId: authorization.repositoryId,
    targetRef: authorization.targetRef,
    mode: authorization.mode,
    previousTargetSha: authorization.expectedTargetSha,
    resultingTargetSha: observed.resultingTargetSha,
    mergeCommitSha,
    mergeParents,
    observed: true,
    disposition,
  };
}

/** Mesma identidade de EFEITO (a disposição pode diferir entre execução e reconciliação). */
const EFFECT_FIELDS = [
  'kind', 'operationKey', 'authorizationId', 'workItemId', 'proposalVersion', 'attemptId', 'acceptedResultEventId',
  'resultCommitSha', 'repositoryId', 'targetRef', 'mode', 'previousTargetSha', 'resultingTargetSha', 'mergeCommitSha', 'observed',
] as const;

/** Comparação campo a campo (o receipt relido do jsonb não preserva a ordem das chaves). */
export function sameIntegrationEffect(left: IntegrationEffectReceiptV1, right: IntegrationEffectReceiptV1): boolean {
  return EFFECT_FIELDS.every((field) => left[field] === right[field])
    && left.mergeParents.length === right.mergeParents.length
    && left.mergeParents.every((sha, i) => sha === right.mergeParents[i]);
}
