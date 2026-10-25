import { isExternalWorkEnvelope } from './external-work-proposal';
import { isFullCommitSha } from './external-target';
import { readExternalTarget } from './external-target';
import { projectLatestWorkResult } from './presentation';
import { readAutonomousExecutionSpec } from './eligibility';
import type { WorkEvent, WorkItem } from './types';
import { projectWorktreeHandoff } from './worktree-handoff';

// ============================================================
// Revisão HUMANA de critérios de um candidato EXTERNO (Project Builder V0 — T4). Núcleo PURO.
//
// Um critério `proof: 'human_review'` (ex.: "os testes existentes não foram enfraquecidos") não é prova automática: o Verifier só
// registra `human_review_pending`. Antes do aceite do resultado de um trabalho externo, o operador precisa registrar, para CADA
// critério pendente, uma decisão explícita (aceitar/rejeitar) VINCULADA ao candidato exato: item, versão, attempt, evento de
// resultado, commit candidato, SHA-base e o digest do diff que ele viu. Revisão de outro candidato nunca é reaproveitada.
//
// A persistência reutiliza contratos existentes (mensagem do operador + `attach_work_context`); este módulo só define o registro,
// o vínculo e a decisão do gate. Não toca disco, Git, banco nem LLM.
// ============================================================

export const EXTERNAL_CRITERION_REVIEW_KIND = 'external_criterion_review_v1' as const;

export interface ExternalCandidateFacts {
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly attemptId: string;
  readonly resultEventId: string;
  readonly candidateCommitSha: string;
  readonly baseSha: string;
  readonly branch: string;
  readonly reference: string;
  readonly changedFiles: readonly string[];
}

export interface ExternalCriterionReviewV1 {
  readonly schemaVersion: 1;
  readonly kind: typeof EXTERNAL_CRITERION_REVIEW_KIND;
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly attemptId: string;
  readonly resultEventId: string;
  readonly candidateCommitSha: string;
  readonly baseSha: string;
  readonly reference: string;
  /** Texto EXATO do critério (`expectedEffects`) coberto por `human_review`. */
  readonly criterion: string;
  readonly decision: 'accept' | 'reject';
  /** sha256 hex do diff `base..candidato` que o operador revisou. */
  readonly diffSha256: string;
  readonly reviewerUserId: string;
  readonly reviewedAt: string;
  readonly reason?: string;
}

const KEYS = ['approvedProposalVersion', 'attemptId', 'baseSha', 'candidateCommitSha', 'criterion', 'decision', 'diffSha256', 'kind', 'reference',
  'resultEventId', 'reviewedAt', 'reviewerUserId', 'schemaVersion', 'workItemId'] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Leitura estrita (campos fechados, SHAs completos). `null` ⇒ não é um registro de revisão válido. */
export function parseExternalCriterionReview(raw: unknown): ExternalCriterionReviewV1 | null {
  const o = object(raw);
  if (!o) return null;
  const keys = Object.keys(o).filter(k => k !== 'reason').sort();
  if (keys.join(',') !== [...KEYS].join(',')) return null;
  if (o['kind'] !== EXTERNAL_CRITERION_REVIEW_KIND || o['schemaVersion'] !== 1) return null;
  if (!Number.isInteger(o['approvedProposalVersion']) || (o['approvedProposalVersion'] as number) < 1) return null;
  if (!str(o['workItemId']) || !str(o['attemptId']) || !str(o['resultEventId']) || !str(o['reference']) || !str(o['criterion']) || !str(o['reviewerUserId'])) return null;
  if (!isFullCommitSha(o['candidateCommitSha']) || !isFullCommitSha(o['baseSha'])) return null;
  if (typeof o['diffSha256'] !== 'string' || !SHA256.test(o['diffSha256'])) return null;
  if (o['decision'] !== 'accept' && o['decision'] !== 'reject') return null;
  if (typeof o['reviewedAt'] !== 'string' || !Number.isFinite(Date.parse(o['reviewedAt']))) return null;
  if (o['reason'] !== undefined && (typeof o['reason'] !== 'string' || o['reason'].length > 1000)) return null;
  return o as unknown as ExternalCriterionReviewV1;
}

/** Critérios `human_review` do contrato, na ordem de `expectedEffects` (posição 1-based = `A<n>` do propose sequencial). */
export function humanReviewCriteria(item: Pick<WorkItem, 'intent' | 'proposal'>): readonly { readonly position: number; readonly text: string }[] {
  const spec = readAutonomousExecutionSpec(item.intent);
  const effects = item.proposal.data.expectedEffects;
  const review = new Set((spec?.validationCriteria ?? []).filter(c => c.proof === 'human_review').flatMap(c => c.covers ?? []));
  return effects.flatMap((text, index) => review.has(text) ? [{ position: index + 1, text }] : []);
}

export type ExternalCandidateRead = { readonly ok: true; readonly facts: ExternalCandidateFacts } | { readonly ok: false; readonly reason: string };

/** Fatos do candidato a partir dos eventos persistidos (nada de Git): resultado mais recente + handoff + evidência Git do host. */
export function readExternalCandidate(item: WorkItem, events: readonly WorkEvent[]): ExternalCandidateRead {
  if (!isExternalWorkEnvelope(item.intent)) return { ok: false, reason: 'not_external_work' };
  const target = readExternalTarget((item.intent['execution_spec'] as Record<string, unknown> | undefined)?.['target']);
  if (!target.ok) return { ok: false, reason: 'external_target_identity_missing' };
  const latest = projectLatestWorkResult(events);
  const handoff = projectWorktreeHandoff(events);
  if (!latest || !handoff) return { ok: false, reason: 'no_reviewable_result' };
  if (latest.proposalVersion !== item.proposalVersion || handoff.approvedProposalVersion !== item.proposalVersion || handoff.workItemId !== item.id) {
    return { ok: false, reason: 'result_version_mismatch' };
  }
  if (handoff.baseSha !== target.target.identity.baseSha) return { ok: false, reason: 'base_sha_diverges_from_authorized_identity' };
  if (!isFullCommitSha(handoff.commitSha)) return { ok: false, reason: 'candidate_commit_missing' };
  // O commit do handoff é atestado pelo executor: precisa coincidir com o observado pelo host para a MESMA attempt.
  const observed = events.filter(e => e.type === 'host_observed_evidence_recorded').map(e => {
    const data = object(object(e.payload)?.['data']);
    return { attempt: data?.['attempt_id'], commit: object(data?.['evidence'])?.['observedCommitSha'], base: object(data?.['evidence'])?.['baseSha'] };
  }).filter(o => o.attempt === handoff.attemptId).at(-1);
  if (!observed || observed.commit !== handoff.commitSha || observed.base !== handoff.baseSha) return { ok: false, reason: 'host_observed_commit_mismatch' };
  return { ok: true, facts: {
    workItemId: item.id, approvedProposalVersion: item.proposalVersion, attemptId: handoff.attemptId, resultEventId: latest.eventId,
    candidateCommitSha: handoff.commitSha, baseSha: handoff.baseSha, branch: handoff.branch, reference: target.target.reference,
    changedFiles: [...handoff.changedFiles],
  } };
}

const isReviewOf = (r: ExternalCriterionReviewV1, f: ExternalCandidateFacts): boolean =>
  r.workItemId === f.workItemId && r.approvedProposalVersion === f.approvedProposalVersion && r.attemptId === f.attemptId
  && r.resultEventId === f.resultEventId && r.candidateCommitSha === f.candidateCommitSha && r.baseSha === f.baseSha && r.reference === f.reference;

export type ExternalReviewGate =
  | { readonly ok: true; readonly reviewed: readonly string[] }
  | { readonly ok: false; readonly reason: 'external_human_review_missing' | 'external_human_review_rejected' | 'external_candidate_unreadable'; readonly criteria: readonly string[]; readonly detail?: string };

/**
 * Gate do aceite do resultado de um trabalho EXTERNO: cada critério `human_review` precisa ter, para ESTE candidato, uma revisão
 * `accept` (a última decisão vence). Revisão de outro item, versão, attempt, resultado, commit ou base é ignorada. Itens que não
 * são trabalho externo, ou sem critério `human_review`, não são afetados.
 * `reviews` já deve vir filtrada por autoria do operador dono do item (a camada de persistência garante).
 */
export function evaluateExternalReviewGate(item: WorkItem, events: readonly WorkEvent[], reviews: readonly ExternalCriterionReviewV1[]): ExternalReviewGate {
  if (!isExternalWorkEnvelope(item.intent)) return { ok: true, reviewed: [] };
  const pending = humanReviewCriteria(item);
  if (pending.length === 0) return { ok: true, reviewed: [] };
  const candidate = readExternalCandidate(item, events);
  if (!candidate.ok) return { ok: false, reason: 'external_candidate_unreadable', criteria: pending.map(p => p.text), detail: candidate.reason };
  const missing: string[] = [], rejected: string[] = [], reviewed: string[] = [];
  for (const criterion of pending) {
    const decisive = reviews.filter(r => isReviewOf(r, candidate.facts) && r.criterion === criterion.text).at(-1);
    if (!decisive) missing.push(criterion.text);
    else if (decisive.decision === 'reject') rejected.push(criterion.text);
    else reviewed.push(criterion.text);
  }
  if (rejected.length) return { ok: false, reason: 'external_human_review_rejected', criteria: rejected };
  if (missing.length) return { ok: false, reason: 'external_human_review_missing', criteria: missing };
  return { ok: true, reviewed };
}

// ─── Conflito físico (mesmo repositório sob referências diferentes) ───────────────────────────

export interface ExternalPhysicalIdentityRef { readonly repoRootCanonical: string; readonly gitCommonDirCanonical: string }
export interface ExternalItemSnapshot { readonly id: string; readonly state: string; readonly intent: unknown }
export interface ExternalOpenClaim { readonly workItemId: string; readonly expiresAt: string | null }
export interface ExternalPhysicalConflict {
  readonly workItemId: string;
  readonly reference: string;
  /** `running`: claim aberto e vigente (escrita possível agora); `retained`: item in_progress sem claim (candidato retido, não escreve). */
  readonly kind: 'running' | 'retained';
}

const norm = (p: string): string => { const x = p.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[A-Za-z]:\//.test(x) || x.startsWith('//') ? x.toLowerCase() : x; };

/**
 * Outros itens que apontam para o MESMO repositório físico (raiz ou git-common-dir canônicos), seja qual for a `reference`. O
 * banco só serializa por referência; esta projeção é a prova de exclusividade física que o host aplica antes de operar.
 */
export function findExternalPhysicalConflicts(
  self: { readonly itemId: string; readonly identity: ExternalPhysicalIdentityRef },
  items: readonly ExternalItemSnapshot[],
  openClaims: readonly ExternalOpenClaim[],
  now: Date,
): readonly ExternalPhysicalConflict[] {
  const out: ExternalPhysicalConflict[] = [];
  for (const item of items) {
    if (item.id === self.itemId) continue;
    const target = readExternalTarget((object(object(item.intent)?.['execution_spec']))?.['target']);
    if (!target.ok) continue;
    const same = norm(target.target.identity.repoRootCanonical) === norm(self.identity.repoRootCanonical)
      || norm(target.target.identity.gitCommonDirCanonical) === norm(self.identity.gitCommonDirCanonical);
    if (!same) continue;
    const running = openClaims.some(c => c.workItemId === item.id && (c.expiresAt === null || Date.parse(c.expiresAt) > now.getTime()));
    if (running) out.push({ workItemId: item.id, reference: target.target.reference, kind: 'running' });
    else if (item.state === 'in_progress') out.push({ workItemId: item.id, reference: target.target.reference, kind: 'retained' });
  }
  return out;
}
