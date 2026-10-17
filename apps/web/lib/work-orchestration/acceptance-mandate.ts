import {
  ACCEPTANCE_MANDATE_ALLOWED_ACTIONS,
  deriveAcceptanceFacts,
  evaluateCandidateIntegrity,
  evaluateMandateAcceptance,
  evaluateMandateGrantRequest,
  type AcceptanceMandateGrantRequestV1,
  type CandidateIntegrityDefect,
  type CandidateIntegrityV1,
  type MandateAcceptanceDefect,
  type MandateGrantDefect,
  type MandateRecordView,
  type WorkEvent,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Aceite sob mandato antecipado — camada de APLICAÇÃO (A2-0, Recorte 2).
//
//   GRANTOR  → `MandateGrantorSink` (cliente do grantor dedicado; credenciais NUNCA vêm do ambiente do runner).
//   WRITER   → `MandatedAcceptanceSink` (Trusted System Writer): único que chama `accept_work_result_under_mandate`.
//   GIT      → `collectCandidateIntegrity`: conferência Git feita AQUI, no lado confiável do writer, nunca a partir de
//              declaração do runner. O banco ainda cruza o relatório com a evidência git OBSERVADA PELO HOST.
//
// A autoridade final é a RPC (recalcula tudo). A pré-checagem TS existe para falhar cedo e com defeito tipado,
// sem nunca substituir a decisão do banco.
// ============================================================

type Db = SupabaseClient<Database>;
export type SinkResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

// ---- Grantor ----------------------------------------------------------------------------------------------------
export interface MandatePreview {
  readonly workItemId: string;
  readonly state: string;
  readonly proposalVersion: number;
  readonly contractSha256: string;
  readonly baseSha: string | null;
  readonly includedScope: readonly string[];
  readonly blockers: readonly string[];
  readonly policyVersion: string;
}
export interface MandateGrantorSink {
  preview(workItemId: string): Promise<SinkResult<MandatePreview>>;
  grant(request: AcceptanceMandateGrantRequestV1): Promise<SinkResult<{ readonly action: 'granted' | 'replayed'; readonly mandateId: string; readonly eventSeq: number }>>;
  revoke(mandateId: string, reason: string): Promise<SinkResult<{ readonly action: 'revoked' | 'replayed'; readonly mandateId: string }>>;
}

const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const mandateGrantorSinkFor = (client: Db): MandateGrantorSink => ({
  preview: async (workItemId) => {
    const { data, error } = await client.rpc('preview_acceptance_contract', { p_work_item_id: workItemId });
    if (error) return { ok: false, message: error.message };
    const d = obj(data);
    if (typeof d.contractSha256 !== 'string' || !Array.isArray(d.blockers)) return { ok: false, message: 'preview_malformed' };
    return { ok: true, value: {
      workItemId: String(d.workItemId), state: String(d.state), proposalVersion: Number(d.proposalVersion), contractSha256: d.contractSha256,
      baseSha: typeof d.baseSha === 'string' ? d.baseSha : null, includedScope: Array.isArray(d.includedScope) ? d.includedScope.map(String) : [],
      blockers: d.blockers.map(String), policyVersion: String(d.policyVersion),
    } };
  },
  grant: async (request) => {
    const { data, error } = await client.rpc('grant_acceptance_mandate', {
      p_work_item_id: request.workItemId, p_expected_proposal_version: request.proposalVersion, p_contract_sha256: request.contractSha256,
      p_base_sha: request.baseSha, p_scope_files: [...request.scopeFiles], p_not_before: request.notBefore, p_expires_at: request.expiresAt, p_request_id: request.requestId,
    });
    if (error) return { ok: false, message: error.message };
    const d = obj(data);
    if (typeof d.mandate_id !== 'string') return { ok: false, message: 'grant_malformed' };
    return { ok: true, value: { action: d.action === 'replayed' ? 'replayed' : 'granted', mandateId: d.mandate_id, eventSeq: Number(d.event_seq) } };
  },
  revoke: async (mandateId, reason) => {
    const { data, error } = await client.rpc('revoke_acceptance_mandate', { p_mandate_id: mandateId, p_reason: reason });
    if (error) return { ok: false, message: error.message };
    const d = obj(data);
    return { ok: true, value: { action: d.action === 'replayed' ? 'replayed' : 'revoked', mandateId } };
  },
});

export type GrantOutcome =
  | { readonly ok: true; readonly action: 'granted' | 'replayed'; readonly mandateId: string; readonly eventSeq: number }
  | { readonly ok: false; readonly stage: 'validation' | 'preview' | 'blocked' | 'hash_mismatch' | 'persist'; readonly reason: string; readonly defect?: MandateGrantDefect };

/**
 * Concessão com o que o humano VIU: valida o pedido, busca o preview (hash canônico do banco) e só concede se o hash visto
 * for o hash atual, sem bloqueios e com o escopo igual ao included_scope do contrato.
 */
export async function grantAcceptanceMandate(
  sink: MandateGrantorSink, request: AcceptanceMandateGrantRequestV1, now: () => Date = () => new Date(),
): Promise<GrantOutcome> {
  const checked = evaluateMandateGrantRequest(request, now());
  if (!checked.ok) return { ok: false, stage: 'validation', reason: checked.explanation, defect: checked.defect };
  const preview = await sink.preview(checked.value.workItemId).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  if (!preview.ok) return { ok: false, stage: 'preview', reason: preview.message };
  if (preview.value.blockers.length > 0) return { ok: false, stage: 'blocked', reason: preview.value.blockers.join(',') };
  if (preview.value.contractSha256 !== checked.value.contractSha256 || preview.value.proposalVersion !== checked.value.proposalVersion) {
    return { ok: false, stage: 'hash_mismatch', reason: 'O hash/versão informado não é o do contrato atual.' };
  }
  const granted = await sink.grant(checked.value).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  if (!granted.ok) return { ok: false, stage: 'persist', reason: granted.message };
  return { ok: true, ...granted.value };
}

// ---- Writer -----------------------------------------------------------------------------------------------------
export interface MandatedAcceptanceRequest {
  readonly workItemId: string;
  readonly proposalVersion: number;
  readonly reviewedResultEventId: string;
  readonly mandateId: string;
  readonly integrity: CandidateIntegrityV1;
}
export interface MandatedAcceptanceSink {
  accept(request: MandatedAcceptanceRequest): Promise<SinkResult<{ readonly action: 'accepted' | 'replayed'; readonly eventSeq: number | null }>>;
}
export const mandatedAcceptanceSinkFor = (client: Db): MandatedAcceptanceSink => ({
  accept: async (request) => {
    const { data, error } = await client.rpc('accept_work_result_under_mandate', {
      p_work_item_id: request.workItemId, p_expected_proposal_version: request.proposalVersion,
      p_reviewed_result_event_id: request.reviewedResultEventId, p_mandate_id: request.mandateId, p_integrity: request.integrity as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    const d = obj(data);
    return { ok: true, value: { action: d.action === 'replayed' ? 'replayed' : 'accepted', eventSeq: typeof d.event_seq === 'number' ? d.event_seq : null } };
  },
});

// ---- Git (lado confiável) ---------------------------------------------------------------------------------------
export type GitRunner = (args: readonly string[]) => Promise<{ readonly exitCode: number; readonly stdout: string }>;
const SHA = /^[0-9a-f]{40}$/;
export const NO_REPLACE = '--no-replace-objects';
const REGULAR_FILE_MODES = new Set(['100644', '100755']);
const lines = (text: string): string[] => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/** Coleta a integridade do candidato diretamente do Git (read-only: cat-file, rev-list, merge-base, diff). */
export async function collectCandidateIntegrity(
  runGit: GitRunner, input: { readonly baseSha: string; readonly commitSha: string }, now: () => Date = () => new Date(),
): Promise<SinkResult<CandidateIntegrityV1>> {
  if (!SHA.test(input.baseSha) || !SHA.test(input.commitSha)) return { ok: false, message: 'invalid_sha' };
  // `refs/replace/*` (e enxertos) fariam o Git DESTE processo enxergar outro objeto que o realmente commitado: sempre sem substituição.
  const run = async (args: readonly string[]) => runGit([NO_REPLACE, ...args]).catch(() => ({ exitCode: -1, stdout: '' }));
  const [commitObj, baseObj] = await Promise.all([run(['cat-file', '-t', input.commitSha]), run(['cat-file', '-t', input.baseSha])]);
  if (commitObj.exitCode !== 0 || commitObj.stdout.trim() !== 'commit' || baseObj.exitCode !== 0 || baseObj.stdout.trim() !== 'commit') return { ok: false, message: 'commit_not_found' };
  const [parents, count, merges, ancestor, diff, raw, rawCommit] = await Promise.all([
    run(['rev-list', '--parents', '-n', '1', input.commitSha]),
    run(['rev-list', '--count', `${input.baseSha}..${input.commitSha}`]),
    run(['rev-list', '--merges', '--count', `${input.baseSha}..${input.commitSha}`]),
    run(['merge-base', '--is-ancestor', input.baseSha, input.commitSha]),
    run(['diff', '--name-status', '--no-renames', input.baseSha, input.commitSha]),
    run(['diff', '--raw', '--no-renames', input.baseSha, input.commitSha]),
    run(['cat-file', 'commit', input.commitSha]),
  ]);
  if (parents.exitCode !== 0 || count.exitCode !== 0 || merges.exitCode !== 0 || diff.exitCode !== 0 || raw.exitCode !== 0 || rawCommit.exitCode !== 0 || (ancestor.exitCode !== 0 && ancestor.exitCode !== 1)) return { ok: false, message: 'git_unavailable' };
  // Só arquivos regulares: link simbólico (120000) ou submódulo (160000) com o nome certo passaria na conferência de caminho.
  const modes = lines(raw.stdout).map(l => l.split('\t')[0]?.split(/\s+/)[1] ?? '');
  if (modes.some(mode => !REGULAR_FILE_MODES.has(mode))) return { ok: false, message: 'git_unusual_file_mode' };
  const parentLine = lines(parents.stdout)[0]?.split(/\s+/) ?? [];
  // Pais LIDOS DO PRÓPRIO OBJETO commit (imunes a shallow/enxertos/replace) precisam coincidir com os do grafo; divergência = repositório adulterado.
  const header = rawCommit.stdout.split(/\r?\n\r?\n/)[0] ?? '';
  const rawParents = header.split(/\r?\n/).filter(l => l.startsWith('parent ')).map(l => l.slice(7).trim());
  if (rawParents.join(',') !== parentLine.slice(1).join(',')) return { ok: false, message: 'git_graph_inconsistent' };
  const statuses = lines(diff.stdout).map(l => { const [status, ...rest] = l.split('\t'); return { status: status ?? '', path: rest.join('\t').replace(/\\/g, '/') }; });
  const commitCount = Number(count.stdout.trim()); const mergeCount = Number(merges.stdout.trim());
  if (!Number.isInteger(commitCount) || !Number.isInteger(mergeCount) || parentLine[0] !== input.commitSha) return { ok: false, message: 'git_output_malformed' };
  return { ok: true, value: {
    schemaVersion: 1, commitSha: input.commitSha, baseSha: input.baseSha, parentShas: parentLine.slice(1), commitCount, mergeCount,
    baseIsAncestor: ancestor.exitCode === 0, changedFiles: statuses.map(s => s.path).sort(), changeStatuses: statuses.sort((a, b) => a.path.localeCompare(b.path)),
    checkedAt: now().toISOString(),
  } };
}

// ---- Orquestração do aceite -------------------------------------------------------------------------------------
export interface AcceptanceReads {
  readonly item: { readonly state: string; readonly proposalVersion: number; readonly impactLevel: string; readonly intent: unknown };
  readonly events: readonly WorkEvent[];
  readonly mandate: MandateRecordView;
}
export interface AcceptUnderMandateDeps {
  readonly read: (workItemId: string, mandateId: string) => Promise<SinkResult<AcceptanceReads>>;
  readonly runGit: GitRunner;
  readonly sink: MandatedAcceptanceSink;
  readonly now?: () => Date;
}
export type AcceptUnderMandateOutcome =
  | { readonly ok: true; readonly action: 'accepted' | 'replayed'; readonly eventSeq: number | null }
  | { readonly ok: false; readonly stage: 'read' | 'precheck' | 'integrity_git' | 'integrity_policy' | 'persist';
      readonly defects?: readonly (MandateAcceptanceDefect | CandidateIntegrityDefect)[]; readonly reason?: string };

const requiresTestBinding = (intent: unknown): boolean => {
  const criteria = obj(obj(intent).execution_spec).validation_criteria;
  return Array.isArray(criteria) && criteria.some(c => obj(c).claim_kind === 'test_binding');
};

/**
 * Fail-closed, nunca lança. Só chama o sink do writer depois de: leitura do ledger, pré-checagem espelhada e relatório
 * de integridade colhido do Git LOCAL. A RPC repete tudo contra o banco (única autoridade).
 */
export async function acceptUnderMandate(
  deps: AcceptUnderMandateDeps,
  input: { readonly workItemId: string; readonly mandateId: string; readonly reviewedResultEventId: string },
): Promise<AcceptUnderMandateOutcome> {
  const now = deps.now ?? (() => new Date());
  try {
    const read = await deps.read(input.workItemId, input.mandateId);
    if (!read.ok) return { ok: false, stage: 'read', reason: read.message };
    const { item, events, mandate } = read.value;
    if (!(ACCEPTANCE_MANDATE_ALLOWED_ACTIONS as readonly string[]).every(a => mandate.allowedActions.includes(a))) return { ok: false, stage: 'precheck', defects: ['action_not_allowed'] };
    const derived = deriveAcceptanceFacts({
      itemState: item.state, itemProposalVersion: item.proposalVersion, impactLevel: item.impactLevel, testBindingRequired: requiresTestBinding(item.intent),
      events, reviewedResultEventId: input.reviewedResultEventId, contractSha256FromMandate: mandate.contractSha256,
    });
    const verdict = evaluateMandateAcceptance(mandate, derived.facts, now());
    if (!verdict.ok) return { ok: false, stage: 'precheck', defects: verdict.defects };
    if (!derived.handoffCommitSha || !derived.hostEvidence) return { ok: false, stage: 'precheck', reason: 'candidate_evidence_missing' };
    const integrity = await collectCandidateIntegrity(deps.runGit, { baseSha: mandate.baseSha, commitSha: derived.handoffCommitSha }, now);
    if (!integrity.ok) return { ok: false, stage: 'integrity_git', reason: integrity.message };
    const policy = evaluateCandidateIntegrity(integrity.value, {
      mandateBaseSha: mandate.baseSha, mandateScopeFiles: mandate.scopeFiles, hostObservedCommitSha: derived.hostEvidence.observedCommitSha,
      hostObservedBaseSha: derived.hostEvidence.baseSha, hostObservedChangedFiles: derived.hostEvidence.observedChangedFiles, handoffCommitSha: derived.handoffCommitSha,
    });
    if (!policy.ok) return { ok: false, stage: 'integrity_policy', defects: [policy.defect] };
    const accepted = await deps.sink.accept({
      workItemId: input.workItemId, proposalVersion: item.proposalVersion, reviewedResultEventId: input.reviewedResultEventId, mandateId: input.mandateId, integrity: integrity.value,
    });
    if (!accepted.ok) return { ok: false, stage: 'persist', reason: accepted.message };
    return { ok: true, ...accepted.value };
  } catch (error) {
    return { ok: false, stage: 'persist', reason: error instanceof Error ? error.message : String(error) };
  }
}
