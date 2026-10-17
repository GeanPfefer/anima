import { readPersistedExecutionContext } from './host-observed-execution-context';
import type { WorkEvent } from './types';

// ============================================================
// ACCEPTANCE MANDATE V1 (A2-0, Recorte 2) — aceite sob mandato humano ANTECIPADO.
//
// Quatro identidades, quatro autoridades (nunca confundir):
//   1. GRANTOR   — identidade GoTrue dedicada (papel `anima_mandate_grantor`), credenciais FORA do runner.
//                  Só concede/revoga mandatos. Não executa trabalho, não aceita, não integra.
//   2. RUNNER    — a sessão residente que executa a attempt. NÃO concede, amplia nem revoga mandato.
//   3. WRITER    — Trusted System Writer: único que registra o aceite sob mandato, depois de o BANCO
//                  recalcular todas as condições (nada que o runner declare é confiável).
//   4. HUMANO    — o mandato é a decisão humana; o aceite é uma decisão de sistema que a CITA.
//
// Este módulo é PURO: contrato, normalização fail-closed, avaliação espelhada do que o banco decide
// (autoridade final = RPC `accept_work_result_under_mandate`) e leitor do fato persistido.
// O hash do contrato é calculado PELO BANCO (jsonb canônico); aqui ele é só comparado.
// ============================================================

export const ACCEPTANCE_MANDATE_POLICY_VERSION = 'acceptance-mandate-v1' as const;
export const ACCEPTANCE_MANDATE_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const ACCEPTANCE_MANDATE_MIN_VERIFIER_VERSION = 'work-verifier-v6' as const;
export const ACCEPTANCE_MANDATE_ALLOWED_ACTIONS = ['accept'] as const;
export const ACCEPTANCE_MANDATE_MAX_SCOPE_FILES = 20;
export const ACCEPTANCE_MANDATE_AUTHORITY_KIND = 'human_mandate' as const;
export const MANDATE_GRANTED_EVENT_TYPE = 'work_mandate_granted' as const;
export const MANDATE_REVOKED_EVENT_TYPE = 'work_mandate_revoked' as const;

/** Prefixos de segurança que um mandato NUNCA pode cobrir (espelha `private.acceptance_mandate_scope_is_safe`). */
export const ACCEPTANCE_MANDATE_SENSITIVE_PREFIXES: readonly string[] = [
  'supabase', '.claude', '.git', '.github', '.env', 'apps/web/.env', 'scripts', 'apps/web/scripts', 'tools',
  'packages/core/src/work-orchestration/autonomous-authorization',
  'packages/core/src/work-orchestration/acceptance-mandate',
  'apps/web/lib/work-orchestration/auto-approval',
  'apps/web/lib/work-orchestration/acceptance-mandate',
  'apps/web/lib/work-orchestration/trusted-system-writer',
];

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Caminho relativo, normalizado, sem escape, sem caminho absoluto/Windows e fora dos prefixos sensíveis. */
export function isSafeMandateScopePath(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300 || raw !== raw.trim()) return false;
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return false;
  const parts = raw.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return false;
  // Host Windows (NTFS): caixa, ponto/espaço final, nome curto (~) e caracteres reservados/de controle aliasam diretórios protegidos.
  if (/[<>:"|?*~\u0000-\u001f\u007f]/.test(raw) || parts.some(part => /[. ]$/.test(part))) return false;
  const lower = raw.toLowerCase();
  return !ACCEPTANCE_MANDATE_SENSITIVE_PREFIXES.some(prefix => lower.startsWith(prefix));
}

export type MandateGrantDefect =
  | 'invalid_work_item' | 'invalid_proposal_version' | 'invalid_contract_hash' | 'invalid_base_sha'
  | 'invalid_scope' | 'unsafe_scope_path' | 'invalid_window' | 'window_in_past' | 'window_too_long' | 'invalid_request_id';

export interface AcceptanceMandateGrantRequestV1 {
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly contractSha256: string;
  readonly baseSha: string;
  readonly scopeFiles: readonly string[];
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly requestId: string;
}
export type MandateGrantResult =
  | { readonly ok: true; readonly value: AcceptanceMandateGrantRequestV1 }
  | { readonly ok: false; readonly defect: MandateGrantDefect; readonly explanation: string };

const failGrant = (defect: MandateGrantDefect, explanation: string): MandateGrantResult => ({ ok: false, defect, explanation });

/** Normaliza (escopo ordenado e sem duplicatas) e valida o pedido de concessão. Fail-closed. */
export function evaluateMandateGrantRequest(request: AcceptanceMandateGrantRequestV1, now: Date): MandateGrantResult {
  if (typeof request?.workItemId !== 'string' || !UUID.test(request.workItemId)) return failGrant('invalid_work_item', 'O item precisa ser um UUID.');
  if (!Number.isInteger(request.proposalVersion) || request.proposalVersion < 1) return failGrant('invalid_proposal_version', 'A versão aprovada precisa ser inteira positiva.');
  if (typeof request.contractSha256 !== 'string' || !SHA256.test(request.contractSha256)) return failGrant('invalid_contract_hash', 'O hash do contrato precisa ter 64 hex minúsculos.');
  if (typeof request.baseSha !== 'string' || !GIT_SHA.test(request.baseSha)) return failGrant('invalid_base_sha', 'O base_sha precisa ter 40 hex minúsculos.');
  if (typeof request.requestId !== 'string' || !UUID.test(request.requestId)) return failGrant('invalid_request_id', 'O request_id precisa ser um UUID.');
  const scope = request.scopeFiles;
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > ACCEPTANCE_MANDATE_MAX_SCOPE_FILES) return failGrant('invalid_scope', `O escopo exige de 1 a ${ACCEPTANCE_MANDATE_MAX_SCOPE_FILES} arquivos.`);
  if (!scope.every(isSafeMandateScopePath)) return failGrant('unsafe_scope_path', 'Há caminho inseguro, absoluto, com escape ou em prefixo sensível.');
  const sorted = [...new Set(scope)].sort();
  if (sorted.length !== scope.length) return failGrant('invalid_scope', 'O escopo não pode ter duplicatas.');
  const notBefore = Date.parse(request.notBefore);
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || expiresAt <= notBefore) return failGrant('invalid_window', 'A janela é inválida (início/fim).');
  if (expiresAt <= now.getTime()) return failGrant('window_in_past', 'O mandato já nasceria expirado.');
  if (expiresAt - notBefore > ACCEPTANCE_MANDATE_MAX_DURATION_MS) return failGrant('window_too_long', 'A validade máxima é de 24 horas.');
  return { ok: true, value: { ...request, scopeFiles: sorted } };
}

// ------------------------------------------------------------
// Integridade do candidato — conferência Git no lado CONFIÁVEL do writer (nunca declaração do runner).
// ------------------------------------------------------------

export interface CandidateIntegrityV1 {
  readonly schemaVersion: 1;
  readonly commitSha: string;
  readonly baseSha: string;
  /** Pais diretos do commit candidato (esperado: exatamente [baseSha]). */
  readonly parentShas: readonly string[];
  /** Commits entre base..commit (esperado: exatamente 1). */
  readonly commitCount: number;
  readonly mergeCount: number;
  readonly baseIsAncestor: boolean;
  readonly changedFiles: readonly string[];
  /** Status git por arquivo (A, M, D, R…). */
  readonly changeStatuses: readonly { readonly path: string; readonly status: string }[];
  readonly checkedAt: string;
}
export type CandidateIntegrityDefect =
  | 'invalid_integrity_shape' | 'integrity_commit_mismatch' | 'integrity_base_mismatch' | 'not_single_child_of_base'
  | 'has_merges' | 'base_not_ancestor' | 'scope_mismatch' | 'host_scope_mismatch' | 'disallowed_change_status';

export interface CandidateIntegrityContext {
  readonly mandateBaseSha: string;
  readonly mandateScopeFiles: readonly string[];
  /** Fatos observados pelo HOST (evidência git persistida), independentes do runner. */
  readonly hostObservedCommitSha: string;
  readonly hostObservedBaseSha: string;
  readonly hostObservedChangedFiles: readonly string[];
  /** Commit declarado no handoff do resultado. */
  readonly handoffCommitSha: string;
  /** Statuses permitidos (default: apenas adição). */
  readonly allowedStatuses?: readonly string[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...new Set(a)].sort(); const y = [...new Set(b)].sort();
  return x.length === a.length && y.length === b.length && x.length === y.length && x.every((v, i) => v === y[i]);
};

export function evaluateCandidateIntegrity(
  integrity: CandidateIntegrityV1,
  context: CandidateIntegrityContext,
): { readonly ok: true } | { readonly ok: false; readonly defect: CandidateIntegrityDefect } {
  const bad = (defect: CandidateIntegrityDefect) => ({ ok: false as const, defect });
  if (integrity?.schemaVersion !== 1 || !GIT_SHA.test(integrity.commitSha ?? '') || !GIT_SHA.test(integrity.baseSha ?? '')
    || !Array.isArray(integrity.parentShas) || !Array.isArray(integrity.changedFiles) || !Array.isArray(integrity.changeStatuses)
    || !Number.isInteger(integrity.commitCount) || !Number.isInteger(integrity.mergeCount) || typeof integrity.baseIsAncestor !== 'boolean') return bad('invalid_integrity_shape');
  if (integrity.commitSha !== context.handoffCommitSha || integrity.commitSha !== context.hostObservedCommitSha) return bad('integrity_commit_mismatch');
  if (integrity.baseSha !== context.mandateBaseSha || integrity.baseSha !== context.hostObservedBaseSha) return bad('integrity_base_mismatch');
  if (!integrity.baseIsAncestor) return bad('base_not_ancestor');
  if (integrity.mergeCount !== 0) return bad('has_merges');
  if (integrity.commitCount !== 1 || integrity.parentShas.length !== 1 || integrity.parentShas[0] !== integrity.baseSha) return bad('not_single_child_of_base');
  if (!sameSet(integrity.changedFiles, context.mandateScopeFiles)) return bad('scope_mismatch');
  if (!sameSet(context.hostObservedChangedFiles, context.mandateScopeFiles)) return bad('host_scope_mismatch');
  const allowed = new Set(context.allowedStatuses ?? ['A']);
  if (!integrity.changeStatuses.every(s => allowed.has(s.status)) || !sameSet(integrity.changeStatuses.map(s => s.path), context.mandateScopeFiles)) return bad('disallowed_change_status');
  return { ok: true };
}

// ------------------------------------------------------------
// Avaliação espelhada do aceite (pré-checagem do writer-side; a RPC recalcula tudo no banco).
// ------------------------------------------------------------

export interface MandateRecordView {
  readonly id: string;
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly contractSha256: string;
  readonly baseSha: string;
  readonly scopeFiles: readonly string[];
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly allowedActions: readonly string[];
  readonly policyVersion: string;
  readonly revokedAt: string | null;
  readonly consumedAt: string | null;
  readonly grantedEventSeq: number;
}
export interface AcceptanceFacts {
  readonly itemState: string;
  readonly itemProposalVersion: number;
  readonly impactLevel: string;
  readonly currentContractSha256: string;
  readonly latestResultEventId: string;
  readonly reviewedResultEventId: string;
  readonly executionStartedSeq: number | null;
  readonly executionStartedCount: number;
  readonly verifier: {
    readonly verdict: string; readonly version: string; readonly gaps: number; readonly violations: number;
    readonly correlatedToResult: boolean; readonly testBindingRequired: boolean; readonly testBindingIndependent: boolean;
  } | null;
  readonly contextFact: { readonly executionMode: string; readonly attemptMatches: boolean } | null;
  readonly classificationHumanConfirmed: boolean;
  readonly paidComputeObserved: boolean;
  readonly integrationObserved: boolean;
  readonly pendingHumanResolution: boolean;
}
export type MandateAcceptanceDefect =
  | 'action_not_allowed' | 'policy_changed' | 'mandate_revoked' | 'mandate_consumed' | 'mandate_not_yet_valid' | 'mandate_expired'
  | 'wrong_item_or_version' | 'item_not_in_review' | 'result_not_latest' | 'contract_changed' | 'impact_not_low'
  | 'not_anticipated' | 'multiple_attempts' | 'verifier_missing' | 'verifier_not_verified' | 'verifier_version_too_old'
  | 'verifier_gaps_or_violations' | 'verifier_not_correlated' | 'test_binding_not_independent' | 'context_fact_missing_or_invalid'
  | 'classification_not_human_confirmed' | 'paid_compute_present' | 'integration_present' | 'human_resolution_pending';

export function evaluateMandateAcceptance(
  mandate: MandateRecordView, facts: AcceptanceFacts, now: Date,
): { readonly ok: true } | { readonly ok: false; readonly defects: readonly MandateAcceptanceDefect[] } {
  const defects: MandateAcceptanceDefect[] = [];
  if (!(mandate.allowedActions.length === 1 && mandate.allowedActions[0] === 'accept')) defects.push('action_not_allowed');
  if (mandate.policyVersion !== ACCEPTANCE_MANDATE_POLICY_VERSION) defects.push('policy_changed');
  if (mandate.revokedAt !== null) defects.push('mandate_revoked');
  if (mandate.consumedAt !== null) defects.push('mandate_consumed');
  if (now.getTime() < Date.parse(mandate.notBefore)) defects.push('mandate_not_yet_valid');
  if (now.getTime() >= Date.parse(mandate.expiresAt)) defects.push('mandate_expired');
  if (mandate.proposalVersion !== facts.itemProposalVersion) defects.push('wrong_item_or_version');
  if (facts.itemState !== 'review') defects.push('item_not_in_review');
  if (facts.latestResultEventId !== facts.reviewedResultEventId) defects.push('result_not_latest');
  if (facts.currentContractSha256 !== mandate.contractSha256) defects.push('contract_changed');
  if (facts.impactLevel !== 'low') defects.push('impact_not_low');
  if (facts.executionStartedSeq === null || facts.executionStartedSeq <= mandate.grantedEventSeq) defects.push('not_anticipated');
  if (facts.executionStartedCount !== 1) defects.push('multiple_attempts');
  const v = facts.verifier;
  if (!v) defects.push('verifier_missing');
  else {
    if (v.verdict !== 'verified') defects.push('verifier_not_verified');
    if (v.version !== ACCEPTANCE_MANDATE_MIN_VERIFIER_VERSION) defects.push('verifier_version_too_old');
    if (v.gaps !== 0 || v.violations !== 0) defects.push('verifier_gaps_or_violations');
    if (!v.correlatedToResult) defects.push('verifier_not_correlated');
    if (v.testBindingRequired && !v.testBindingIndependent) defects.push('test_binding_not_independent');
  }
  if (!facts.contextFact || !facts.contextFact.attemptMatches || !['unattended', 'supervised'].includes(facts.contextFact.executionMode)) defects.push('context_fact_missing_or_invalid');
  if (!facts.classificationHumanConfirmed) defects.push('classification_not_human_confirmed');
  if (facts.paidComputeObserved) defects.push('paid_compute_present');
  if (facts.integrationObserved) defects.push('integration_present');
  if (facts.pendingHumanResolution) defects.push('human_resolution_pending');
  return defects.length ? { ok: false, defects } : { ok: true };
}

// ------------------------------------------------------------
// Leitor do aceite PERSISTIDO (decisão de sistema que cita a decisão humana).
// ------------------------------------------------------------

export interface PersistedMandatedAcceptance {
  readonly eventSeq: number | undefined;
  readonly acceptedResultEventId: string;
  readonly mandateId: string;
  readonly grantEventSeq: number;
  readonly contractSha256: string;
  readonly policyVersion: string;
  readonly verifierEventId: string;
  readonly contextEventId: string;
  readonly commitSha: string;
}

const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Só devolve o aceite quando TODA a proveniência bate: result_accepted, autor `system`, decidido pelo
 * Trusted System Writer, autoridade `human_mandate` completa. Aceite humano (`user`) NUNCA é lido como mandatado
 * e um `system` sem autoridade completa é rejeitado (null).
 */
export function readPersistedMandatedAcceptance(event: WorkEvent): PersistedMandatedAcceptance | null {
  if (event.type !== 'result_accepted' || event.author !== 'system') return null;
  const data = obj(obj(event.payload).data);
  const authority = obj(data.authority);
  const candidate = obj(data.candidate);
  if (data.decided_by !== 'trusted_system_writer' || authority.kind !== ACCEPTANCE_MANDATE_AUTHORITY_KIND) return null;
  const ok = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!ok(data.accepted_result_event_id) || !UUID.test(String(authority.mandate_id ?? '')) || !Number.isInteger(authority.grant_event_seq)
    || !SHA256.test(String(authority.contract_sha256 ?? '')) || authority.policy_version !== ACCEPTANCE_MANDATE_POLICY_VERSION
    || !ok(data.verifier_event_id) || !ok(data.execution_context_event_id) || !GIT_SHA.test(String(candidate.commit_sha ?? ''))) return null;
  return {
    eventSeq: event.seq,
    acceptedResultEventId: String(data.accepted_result_event_id),
    mandateId: String(authority.mandate_id),
    grantEventSeq: Number(authority.grant_event_seq),
    contractSha256: String(authority.contract_sha256),
    policyVersion: String(authority.policy_version),
    verifierEventId: String(data.verifier_event_id),
    contextEventId: String(data.execution_context_event_id),
    commitSha: String(candidate.commit_sha),
  };
}

// ------------------------------------------------------------
// Derivação dos fatos do aceite a partir do LEDGER (pré-checagem do writer-side; o banco recalcula tudo).
// ------------------------------------------------------------

export interface DerivedAcceptanceInput {
  readonly itemState: string;
  readonly itemProposalVersion: number;
  readonly impactLevel: string;
  readonly testBindingRequired: boolean;
  readonly events: readonly WorkEvent[];
  readonly reviewedResultEventId: string;
  /** O hash do contrato é calculado SÓ pelo banco; aqui entra o do mandato (a RPC é quem confere). */
  readonly contractSha256FromMandate: string;
}
export interface DerivedAcceptance {
  readonly facts: AcceptanceFacts;
  readonly attemptId: string | null;
  readonly handoffCommitSha: string | null;
  readonly hostEvidence: { readonly observedCommitSha: string; readonly baseSha: string; readonly observedChangedFiles: readonly string[] } | null;
}

const data = (event: WorkEvent | undefined): Record<string, unknown> => obj(obj(event?.payload).data);
const bySeq = (a: WorkEvent, b: WorkEvent): number => (a.seq ?? 0) - (b.seq ?? 0);

export function deriveAcceptanceFacts(input: DerivedAcceptanceInput): DerivedAcceptance {
  const events = [...input.events].sort(bySeq);
  const results = events.filter(e => e.type === 'result_submitted');
  const latestResult = results.at(-1);
  const result = events.find(e => e.id === input.reviewedResultEventId && e.type === 'result_submitted');
  const attemptId = typeof data(result).attempt_id === 'string' ? String(data(result).attempt_id) : null;
  const handoff = obj(obj(data(result).executor_signal).worktreeHandoff);
  const handoffCommitSha = typeof handoff.commitSha === 'string' ? handoff.commitSha : null;
  const started = events.filter(e => e.type === 'execution_started');
  const startedForAttempt = started.find(e => data(e).attempt_id === attemptId);
  const opinionEvent = events.filter(e => e.type === 'verifier_opinion_recorded' && data(e).result_event_id === input.reviewedResultEventId
    && data(e).attempt_id === attemptId && e.proposalVersion === input.itemProposalVersion).at(-1);
  const opinion = obj(data(opinionEvent).opinion);
  const summary = obj(opinion.summary);
  const findings = Array.isArray(opinion.findings) ? opinion.findings.map(obj) : [];
  const contextEvent = events.find(e => e.type === 'host_observed_execution_context_recorded' && data(e).attempt_id === attemptId);
  const context = contextEvent ? readPersistedExecutionContext(contextEvent) : null;
  const classification = events.filter(e => e.type === 'work_intelligence_classified' && e.proposalVersion === input.itemProposalVersion).at(-1);
  const cls = obj(data(classification).classification);
  const preference = events.filter(e => e.type === 'compute_preference_recorded').at(-1);
  const gitEvent = events.find(e => e.id === data(opinionEvent).observed_event_id && e.type === 'host_observed_evidence_recorded');
  const evidence = obj(data(gitEvent).evidence);
  const hostEvidence = gitEvent && typeof evidence.observedCommitSha === 'string' && typeof evidence.baseSha === 'string' && Array.isArray(evidence.observedChangedFiles)
    ? { observedCommitSha: evidence.observedCommitSha, baseSha: evidence.baseSha, observedChangedFiles: evidence.observedChangedFiles.map(String) } : null;
  const facts: AcceptanceFacts = {
    itemState: input.itemState,
    itemProposalVersion: input.itemProposalVersion,
    impactLevel: input.impactLevel,
    currentContractSha256: input.contractSha256FromMandate,
    latestResultEventId: latestResult?.id ?? '',
    reviewedResultEventId: input.reviewedResultEventId,
    executionStartedSeq: startedForAttempt?.seq ?? null,
    executionStartedCount: started.length,
    verifier: opinionEvent ? {
      verdict: String(data(opinionEvent).verdict ?? ''),
      version: String(data(opinionEvent).verifier_version ?? ''),
      gaps: Number(summary.gaps ?? Number.NaN),
      violations: Number(summary.violations ?? Number.NaN),
      correlatedToResult: data(opinionEvent).result_event_id === input.reviewedResultEventId && data(opinionEvent).attempt_id === attemptId,
      testBindingRequired: input.testBindingRequired,
      testBindingIndependent: findings.some(f => f.code === 'test_binding_satisfied' && f.provenance === 'independent'),
    } : null,
    contextFact: context ? { executionMode: context.executionMode, attemptMatches: context.attemptId === attemptId && contextEvent?.author === 'system' } : null,
    classificationHumanConfirmed: obj(cls.provenance).kind === 'human_confirmed' && cls.complexity === 'bounded' && cls.risk === 'low'
      && cls.reversibility === 'reversible' && cls.planClarity === 'clear',
    paidComputeObserved: obj(obj(data(preference).preference)).strategy === 'provider_api',
    integrationObserved: events.some(e => String(e.type).startsWith('integration') || e.type === 'result_accepted'),
    pendingHumanResolution: false,
  };
  return { facts, attemptId, handoffCommitSha, hostEvidence };
}
