import {
  buildIntegrationEffectReceipt,
  classifyIntegrationTarget,
  compareExternalTargetIdentity,
  evaluateVerifierRequirement,
  externalIntegrationRepositoryId,
  INTEGRATION_EFFECT_MODE_FF_ONLY,
  isAllowedExternalIntegrationTargetRef,
  isExternalTargetReference,
  planIntegrationEffect,
  projectLatestWorkResult,
  readExternalCandidate,
  readExternalTarget,
  type IntegrationEffectAuthorizationV1,
  type IntegrationEffectReceiptV1,
  type IntegrationTargetObservation,
  type WorkEvent,
  type WorkItem,
  type WorkOperationResult,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExecutionContract } from './executor-selection';
import type { PersistIntegrationReceipt } from './integration-effect';
import type { VerifiedExternalTarget } from './external-target-resolver';
import type { GitRunner } from './trusted-git';

// ============================================================
// Integração Git GOVERNADA de candidato EXTERNO (Project Builder V0 — T5).
//
// Reusa a cadeia existente (aceite → autorização humana do efeito → executor → recibo pelo Trusted System Writer):
// `planIntegrationEffect` (escopo `external`), `classifyIntegrationTarget`, `buildIntegrationEffectReceipt`, Git confiável
// (`trusted-git`: ambiente limpo, `--git-dir`, hooks/fsmonitor desligados) e `record_integration_completed`. O que é novo:
//   - destino LOCAL explícito (`ANIMA_EXTERNAL_INTEGRATION`), sem remoto e sem publicação;
//   - exclusividade FÍSICA transacional por repositório (lease no banco, independente da referência textual);
//   - estratégia segura para branch em checkout (clean + HEAD no SHA esperado + `merge --ff-only`; worktree vinculada ⇒ recusa).
// Nunca: merge commit, force, cherry-pick, hooks do repositório, push/fetch, fallback para a raiz do Anima.
// ============================================================

export const EXTERNAL_INTEGRATION_ENV = 'ANIMA_EXTERNAL_INTEGRATION';

export interface ExternalIntegrationConfig {
  readonly reference: string;
  readonly targetRef: string;
}

export type ExternalIntegrationConfigResult = { readonly ok: true; readonly config: ExternalIntegrationConfig } | { readonly ok: false; readonly code: string; readonly message: string };

/** `{"reference":"ext:<slug>","targetRef":"refs/heads/main"}` — o operador fixa QUAL destino local está autorizado. */
export function parseExternalIntegrationConfig(raw: string | undefined): ExternalIntegrationConfigResult {
  const bad = (code: string, message: string) => ({ ok: false as const, code, message });
  if (!raw || raw.trim() === '') return bad('external_integration_not_configured', 'Nenhum destino de integração externa foi autorizado pelo operador.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return bad('external_integration_config_invalid', 'A configuração de integração externa não é JSON válido.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('external_integration_config_invalid', 'A configuração de integração externa deve ser um objeto.');
  const o = parsed as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'reference,targetRef' || !isExternalTargetReference(o['reference']) || !isAllowedExternalIntegrationTargetRef(o['targetRef'])) {
    return bad('external_integration_config_invalid', 'A configuração exige exatamente reference (ext:<slug>) e targetRef (refs/heads/<nome> fora de anima-work/).');
  }
  return { ok: true, config: { reference: o['reference'], targetRef: o['targetRef'] } };
}

// ─── Provider Git (somente repositório VERIFICADO; Git confiável) ───────────────────────────

const SHA = /^[a-f0-9]{40}$/;
const firstSha = (out: string): string | null => { const t = out.trim().split(/\s+/)[0]; return t && SHA.test(t) ? t : null; };

export class ExternalGitError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ExternalGitError'; }
}

/** Chaves de config LOCAL que executariam código/redirecionariam o Git ao tocar a árvore de trabalho. */
const UNSAFE_CONFIG_KEY = /^(filter\..*|include\..*|includeif\..*|credential\..*|url\..*|core\.(fsmonitor|hookspath|pager|editor|attributesfile|sshcommand|askpass|gitproxy|worktree|sparsecheckout)|(diff|merge)\..+\.(command|textconv|driver|cmd))$/;
/** Operações em andamento na árvore de trabalho (relativas ao git-dir). */
const IN_PROGRESS_MARKERS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'index.lock'] as const;

export type TargetCheckout = 'none' | 'main_worktree' | 'linked_worktree';

export class ExternalGitIntegrationProvider {
  constructor(
    private readonly git: GitRunner,
    private readonly repoRoot: string,
    private readonly gitDir: string,
    private readonly exists: (path: string) => boolean,
    /** `-c` do OPERADOR para operações que tocam a árvore (ex.: `core.autocrlf` global, que o Git confiável não lê). */
    private readonly workTreeOptions: readonly string[] = [],
  ) {}

  private async ok(args: readonly string[], code: string): Promise<string> {
    const r = await this.git(args);
    if (r.exitCode !== 0) throw new ExternalGitError(code, `git ${args[0] ?? ''} falhou`);
    return r.stdout;
  }

  async resolve(ref: string): Promise<string | null> {
    const r = await this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return r.exitCode === 0 ? firstSha(r.stdout) : null;
  }

  async readTarget(targetRef: string): Promise<string> {
    const sha = await this.resolve(targetRef);
    if (!sha) throw new ExternalGitError('target_unreadable', 'Destino sem SHA legível.');
    return sha;
  }

  async commitExists(sha: string): Promise<boolean> { return (await this.git(['cat-file', '-e', `${sha}^{commit}`])).exitCode === 0; }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await this.git(['merge-base', '--is-ancestor', ancestor, descendant]);
    if (r.exitCode === 0) return true;
    if (r.exitCode === 1) return false;
    throw new ExternalGitError('ancestry_unknown', 'Ancestralidade não pôde ser determinada.');
  }

  async parents(sha: string): Promise<readonly string[]> {
    return (await this.ok(['rev-list', '--parents', '-n', '1', sha], 'parents_unreadable')).trim().split(/\s+/).slice(1).filter(t => SHA.test(t));
  }

  /** Quem tem o destino em checkout: a worktree principal, uma vinculada, ou ninguém. */
  async checkout(targetRef: string): Promise<TargetCheckout> {
    const out = await this.ok(['worktree', 'list', '--porcelain'], 'worktrees_unreadable');
    const blocks = out.split(/\r?\n\r?\n/).map(b => b.split(/\r?\n/).map(l => l.trim()).filter(Boolean)).filter(b => b.length > 0);
    let result: TargetCheckout = 'none';
    blocks.forEach((lines, index) => {
      if (lines.some(l => l === `branch ${targetRef}`)) { if (index === 0 && result === 'none') result = 'main_worktree'; else result = 'linked_worktree'; }
    });
    return result;
  }

  /** `null` = a árvore de trabalho principal pode receber um ff com segurança; senão o motivo (recusa). */
  async workingTreeRefusal(targetRef: string, expectedSha: string): Promise<string | null> {
    const names = (await this.ok(['config', '--local', '--no-includes', '--list', '--name-only'], 'config_unreadable')).split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean);
    if (names.some(k => UNSAFE_CONFIG_KEY.test(k))) return 'unsafe_repository_config';
    const sep = this.gitDir.includes('\\') ? '\\' : '/';
    if (IN_PROGRESS_MARKERS.some(m => this.exists(`${this.gitDir}${sep}${m}`))) return 'operation_in_progress';
    const head = await this.git(['symbolic-ref', '-q', 'HEAD']);
    if (head.exitCode !== 0 || head.stdout.trim() !== targetRef) return 'head_not_on_target';
    if ((await this.resolve('HEAD')) !== expectedSha) return 'head_not_at_expected';
    const status = await this.git([...this.workTreeOptions, `--work-tree=${this.repoRoot}`, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
    if (status.exitCode !== 0) return 'status_unreadable';
    return status.stdout.trim() === '' ? null : 'working_tree_dirty';
  }

  /** Compare-and-swap do ref (destino fora de checkout): só avança se ainda estiver em `expected`. */
  async casAdvance(targetRef: string, next: string, expected: string, reason: string): Promise<boolean> {
    return (await this.git(['update-ref', '-m', reason, targetRef, next, expected])).exitCode === 0;
  }

  /** Destino em checkout (limpo, HEAD no esperado): `merge --ff-only` (Git atualiza ref+índice+árvore; sem merge commit). */
  async mergeFastForward(candidate: string): Promise<boolean> {
    const r = await this.git([...this.workTreeOptions, `--work-tree=${this.repoRoot}`, '-c', 'core.logAllRefUpdates=always', 'merge', '--ff-only', '--no-stat', '--no-verify-signatures', candidate]);
    return r.exitCode === 0;
  }

  /** O valor ANTERIOR do ref segundo o reflog (confirma de qual SHA o ff realmente partiu). */
  async previousValue(targetRef: string): Promise<string | null> {
    const r = await this.git(['rev-parse', '--verify', '--quiet', `${targetRef}@{1}`]);
    return r.exitCode === 0 ? firstSha(r.stdout) : null;
  }
}

// ─── Executor ────────────────────────────────────────────────────────────────────────

export type ExternalIntegrationOutcome =
  | { readonly status: 'integrated'; readonly disposition: 'effected' | 'reconciled' | 'already_persisted'; readonly receipt: IntegrationEffectReceiptV1 }
  | { readonly status: 'denied' | 'human_required' | 'retryable' | 'reconciliation_required' | 'integrity_violation'; readonly reason: string; readonly receipt?: IntegrationEffectReceiptV1 };

export interface ExternalLeasePort {
  readonly acquire: (workItemId: string, ownerInstanceId: string, seconds: number) => Promise<{ readonly ok: true; readonly leaseId: string } | { readonly ok: false; readonly reason: string }>;
  readonly release: (leaseId: string, reason: 'released' | 'failed' | 'completed') => Promise<void>;
}

export interface ExecuteExternalIntegrationDeps {
  readonly getItem: (id: string) => Promise<WorkOperationResult<WorkItem>>;
  readonly listEvents: (id: string) => Promise<WorkOperationResult<readonly WorkEvent[]>>;
  readonly config: ExternalIntegrationConfig;
  /** Reverificação da identidade física (T1) contra o repositório vivo. */
  readonly verifyTarget: (contract: ReturnType<typeof readExecutionContract>) => Promise<VerifiedExternalTarget>;
  readonly gitFor: (gitDir: string) => GitRunner;
  readonly exists: (path: string) => boolean;
  readonly lease: ExternalLeasePort;
  /** Revisão humana por critério (T4): `null` = liberado. */
  readonly humanReviewRefusal: (workItemId: string) => Promise<{ readonly code: string; readonly message: string } | null>;
  readonly persist: PersistIntegrationReceipt;
  /** Opções `-c` do operador aplicadas só à árvore de trabalho (ver `ExternalGitIntegrationProvider`). */
  readonly workTreeOptions?: readonly string[];
  readonly ownerInstanceId: string;
  readonly leaseSeconds?: number;
}

const specTargetOf = (item: WorkItem): unknown => ((item.intent as Record<string, unknown> | null)?.['execution_spec'] as Record<string, unknown> | undefined)?.['target'];
const denied = (reason: string): ExternalIntegrationOutcome => ({ status: 'denied', reason });
const human = (reason: string): ExternalIntegrationOutcome => ({ status: 'human_required', reason });

/**
 * Executa EXATAMENTE o efeito autorizado em um repositório externo. O chamador fornece só identidades opacas; destino, identidade
 * física, candidato e SHA esperado vêm dos fatos persistidos e da configuração do host.
 */
export async function executeAuthorizedExternalIntegration(
  input: { readonly workItemId: string; readonly integrationAuthorizationId: string },
  deps: ExecuteExternalIntegrationDeps,
): Promise<ExternalIntegrationOutcome> {
  const [item, events] = await Promise.all([deps.getItem(input.workItemId), deps.listEvents(input.workItemId)]);
  if (!item.ok || !events.ok) return { status: 'retryable', reason: 'persisted_state_unreadable' };

  // 1. Item externo, plano revalidado (completed, versão, aceite vigente, handoff, commit, modo ff_only, destino seguro).
  const target = readExternalTarget(specTargetOf(item.value));
  if (!target.ok) return denied('not_external_work');
  const planned = planIntegrationEffect({
    item: item.value, events: events.value, authorizationId: input.integrationAuthorizationId,
    trustedRepositoryId: externalIntegrationRepositoryId(deps.config.reference), scope: 'external',
  });
  if (!planned.ok) return denied(planned.defect);
  const { authorization: auth, handoff, persisted, persistedMismatch } = planned.plan;
  const frozen = auth.external;
  if (!frozen) return denied('authorization_not_external');

  // 2. Destino e referência autorizados PELO HOST; identidade congelada na autorização == identidade do contrato do item.
  if (frozen.reference !== deps.config.reference || target.target.reference !== deps.config.reference) return denied('reference_not_configured');
  if (auth.targetRef !== deps.config.targetRef) return denied('destination_not_configured');
  const id = target.target.identity;
  if (frozen.repoRootCanonical !== id.repoRootCanonical || frozen.gitCommonDirCanonical !== id.gitCommonDirCanonical
    || frozen.rootCommitSha !== id.rootCommitSha || frozen.baseSha !== id.baseSha || handoff.baseSha !== id.baseSha) return denied('authorization_identity_mismatch');

  // 3. Verifier verified correlacionado ao resultado aceito + revisão humana de critério + candidato da attempt aceita.
  const latest = projectLatestWorkResult(events.value);
  if (!latest || latest.eventId !== auth.acceptedResultEventId) return denied('accepted_result_changed');
  const verifier = evaluateVerifierRequirement(item.value, events.value, latest.eventId);
  if (!verifier.satisfied) return denied('verifier_not_verified');
  const review = await deps.humanReviewRefusal(input.workItemId);
  if (review) return human(review.code);
  const candidate = readExternalCandidate(item.value, events.value);
  if (!candidate.ok) return denied(candidate.reason);
  if (candidate.facts.candidateCommitSha !== auth.resultCommitSha || candidate.facts.attemptId !== auth.attemptId || candidate.facts.resultEventId !== auth.acceptedResultEventId) {
    return denied('candidate_not_from_accepted_attempt');
  }

  // 4. Identidade física relida ANTES de qualquer leitura de efeito.
  const contract = readExecutionContract(item.value.intent);
  const verifiedBefore = await deps.verifyTarget(contract);
  if (!verifiedBefore.ok) return denied(verifiedBefore.code);
  if (compareExternalTargetIdentity(id, verifiedBefore.identity)) return denied('external_target_identity_changed');
  const repo = new ExternalGitIntegrationProvider(deps.gitFor(verifiedBefore.identity.gitCommonDirCanonical), verifiedBefore.repoRoot, verifiedBefore.identity.gitCommonDirCanonical, deps.exists, deps.workTreeOptions);

  // 5. Receipt já persistido: sucesso idempotente SÓ se o Git ainda o comprova (leitura pura).
  if (persisted) {
    if (persistedMismatch || persisted.operationKey !== auth.operationKey || persisted.authorizationId !== auth.authorizationId) return { status: 'integrity_violation', reason: 'receipt_conflict' };
    try {
      const current = await repo.readTarget(auth.targetRef);
      const proven = persisted.mergeCommitSha === null && persisted.mergeParents.length === 0
        && (await repo.commitExists(persisted.resultingTargetSha)) && (await repo.isAncestor(persisted.resultingTargetSha, current));
      return proven ? { status: 'integrated', disposition: 'already_persisted', receipt: persisted } : { status: 'integrity_violation', reason: 'receipt_not_proven_by_git' };
    } catch (error) { return { status: 'retryable', reason: error instanceof ExternalGitError ? error.code : 'git_unreadable' }; }
  }

  // 6. Exclusividade FÍSICA transacional (banco) — pré-condição bloqueante da mutação.
  const lease = await deps.lease.acquire(input.workItemId, deps.ownerInstanceId, deps.leaseSeconds ?? 300);
  if (!lease.ok) return human(`repo_exclusivity_unavailable:${lease.reason}`);
  let leaseReason: 'completed' | 'failed' | 'released' = 'failed';
  try {
    // 7. Sob exclusividade: identidade relida DE NOVO, depois destino e candidato.
    const verifiedUnder = await deps.verifyTarget(contract);
    if (!verifiedUnder.ok) return denied(verifiedUnder.code);
    if (compareExternalTargetIdentity(id, verifiedUnder.identity)) return denied('external_target_identity_changed');

    const branchTip = await repo.resolve(`refs/heads/${candidate.facts.branch}`);
    if (branchTip !== auth.resultCommitSha) return human('candidate_branch_moved');
    if (!(await repo.commitExists(auth.resultCommitSha))) return human('result_commit_missing');
    if (!(await repo.isAncestor(handoff.baseSha, auth.resultCommitSha))) return denied('result_not_descendant_of_base');

    const current = await repo.readTarget(auth.targetRef);
    const observe = async (sha: string): Promise<IntegrationTargetObservation> => ({
      targetSha: sha, targetParents: await repo.parents(sha), resultCommitInTarget: await repo.isAncestor(auth.resultCommitSha, sha),
      expectedTargetInTargetHistory: await repo.isAncestor(auth.expectedTargetSha, sha),
    });
    const observation = await observe(current);
    const classification = classifyIntegrationTarget(auth, observation);
    if (classification === 'stale') return human('authorization_stale');
    if (classification === 'ambiguous') return human('ambiguous_target');
    if (classification === 'already_effected') {
      // Efeito exato já no Git sem recibo (queda entre Git e Postgres): registrar, NÃO repetir.
      const outcome = await persistObserved(auth, current, 'reconciled', deps);
      if (outcome.status === 'integrated') leaseReason = 'completed';
      return outcome;
    }

    if (!(await repo.isAncestor(auth.expectedTargetSha, auth.resultCommitSha))) return denied('ff_not_possible');
    const checkout = await repo.checkout(auth.targetRef);
    if (checkout === 'linked_worktree') return human('target_checked_out_in_linked_worktree');
    if (checkout === 'main_worktree') {
      const refusal = await repo.workingTreeRefusal(auth.targetRef, auth.expectedTargetSha);
      if (refusal) return human(`target_checked_out:${refusal}`);
    }

    const advanced = checkout === 'main_worktree'
      ? await repo.mergeFastForward(auth.resultCommitSha)
      : await repo.casAdvance(auth.targetRef, auth.resultCommitSha, auth.expectedTargetSha, `anima external integration ${auth.operationKey}`);
    const after = await repo.readTarget(auth.targetRef);
    if (!advanced && after !== auth.resultCommitSha) {
      const afterObs = await observe(after);
      const re = classifyIntegrationTarget(auth, afterObs);
      if (re === 'already_effected') { const o = await persistObserved(auth, after, 'reconciled', deps); if (o.status === 'integrated') leaseReason = 'completed'; return o; }
      if (re === 'ready') return { status: 'retryable', reason: 'target_update_failed' };
      return human(re === 'ambiguous' ? 'ambiguous_target' : 'authorization_stale');
    }
    if (after !== auth.resultCommitSha) return { status: 'reconciliation_required', reason: 'effect_not_observed' };
    if (checkout === 'main_worktree' && (await repo.previousValue(auth.targetRef)) !== auth.expectedTargetSha) {
      // O ff partiu de um SHA diferente do autorizado (corrida fora do lease): não emitir recibo para um efeito diferente.
      return { status: 'reconciliation_required', reason: 'previous_value_unconfirmed' };
    }
    const outcome = await persistObserved(auth, after, 'effected', deps);
    if (outcome.status === 'integrated') leaseReason = 'completed';
    return outcome;
  } catch (error) {
    return error instanceof ExternalGitError
      ? { status: 'retryable', reason: error.code }
      : { status: 'reconciliation_required', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await deps.lease.release(lease.leaseId, leaseReason).catch(() => undefined); // lease não liberado expira sozinho
  }
}

async function persistObserved(
  auth: IntegrationEffectAuthorizationV1, resultingTargetSha: string, disposition: 'effected' | 'reconciled', deps: ExecuteExternalIntegrationDeps,
): Promise<ExternalIntegrationOutcome> {
  const receipt = buildIntegrationEffectReceipt(auth, { mergeCommitSha: null, mergeParents: [], resultingTargetSha }, disposition);
  if (!receipt) return { status: 'integrity_violation', reason: 'observed_effect_mismatch' };
  try { await deps.persist(auth, receipt); }
  catch (error) { return { status: 'reconciliation_required', reason: `receipt_persist_failed:${error instanceof Error ? error.message : String(error)}`, receipt }; }
  return { status: 'integrated', disposition, receipt };
}

// ─── Autorização HUMANA do efeito externo ────────────────────────────────────────────

export type AuthorizeExternalIntegrationOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly operationKey: string; readonly expectedTargetSha: string; readonly targetRef: string }
  | { readonly ok: false; readonly reason: string };

/** Ato humano: lê o SHA atual do destino (o que o humano vê), confere ff possível e chama o RPC externo. Tudo mais é derivado no banco. */
export async function authorizeExternalIntegrationEffect(
  input: { readonly workItemId: string; readonly authorizationId: string },
  deps: Pick<ExecuteExternalIntegrationDeps, 'getItem' | 'listEvents' | 'config' | 'verifyTarget' | 'gitFor' | 'exists'> & {
    readonly rpc: (args: Database['public']['Functions']['authorize_external_integration_effect']['Args']) => Promise<{ readonly data: Json | null; readonly error: { readonly message: string } | null }>;
  },
): Promise<AuthorizeExternalIntegrationOutcome> {
  const [item, events] = await Promise.all([deps.getItem(input.workItemId), deps.listEvents(input.workItemId)]);
  if (!item.ok || !events.ok) return { ok: false, reason: 'persisted_state_unreadable' };
  if (item.value.state !== 'completed') return { ok: false, reason: 'item_not_completed' };
  const target = readExternalTarget(specTargetOf(item.value));
  if (!target.ok || target.target.reference !== deps.config.reference) return { ok: false, reason: 'reference_not_configured' };
  const accepted = [...events.value].reverse().find(e => e.type === 'result_accepted');
  const acceptedId = (accepted?.payload as { data?: { accepted_result_event_id?: unknown } } | null)?.data?.accepted_result_event_id;
  if (typeof acceptedId !== 'string') return { ok: false, reason: 'acceptance_missing' };
  const verified = await deps.verifyTarget(readExecutionContract(item.value.intent));
  if (!verified.ok) return { ok: false, reason: verified.code };
  if (compareExternalTargetIdentity(target.target.identity, verified.identity)) return { ok: false, reason: 'external_target_identity_changed' };
  const repo = new ExternalGitIntegrationProvider(deps.gitFor(verified.identity.gitCommonDirCanonical), verified.repoRoot, verified.identity.gitCommonDirCanonical, deps.exists);
  let expected: string;
  try { expected = await repo.readTarget(deps.config.targetRef); } catch { return { ok: false, reason: 'target_unreadable' }; }
  const candidate = readExternalCandidate(item.value, events.value);
  if (!candidate.ok) return { ok: false, reason: candidate.reason };
  try {
    if (!(await repo.isAncestor(expected, candidate.facts.candidateCommitSha))) return { ok: false, reason: 'ff_not_possible' };
  } catch { return { ok: false, reason: 'ancestry_unknown' }; }
  const { data, error } = await deps.rpc({
    work_item_id: input.workItemId, expected_proposal_version: item.value.proposalVersion, accepted_result_event_id: acceptedId,
    authorization_id: input.authorizationId, target_ref: deps.config.targetRef, expected_target_sha: expected,
  });
  if (error) return { ok: false, reason: error.message };
  const value = data as { action?: unknown; operation_key?: unknown } | null;
  if ((value?.action !== 'recorded' && value?.action !== 'replayed') || typeof value.operation_key !== 'string') return { ok: false, reason: 'authorization_outcome_ambiguous' };
  return { ok: true, action: value.action, operationKey: value.operation_key, expectedTargetSha: expected, targetRef: deps.config.targetRef };
}

// ─── Fiação Supabase ─────────────────────────────────────────────────────────────────

/** `core.autocrlf` GLOBAL/SISTEMA do operador (o Git confiável ignora essas configs; sem isto, `status` acusaria CRLF como edição). */
export function operatorWorkTreeOptions(read: (args: readonly string[]) => string | null): readonly string[] {
  const value = read(['config', '--global', '--get', 'core.autocrlf']) ?? read(['config', '--system', '--get', 'core.autocrlf']);
  return value && /^(true|false|input)$/.test(value.trim()) ? ['-c', `core.autocrlf=${value.trim()}`] : [];
}

export const supabaseExternalLeasePort = (client: SupabaseClient<Database>): ExternalLeasePort => ({
  acquire: async (workItemId, ownerInstanceId, seconds) => {
    const { data, error } = await client.rpc('acquire_external_repo_lease', { work_item_id: workItemId, owner_instance_id: ownerInstanceId, lease_seconds: seconds });
    const id = (data as { id?: unknown } | null)?.id;
    if (error || typeof id !== 'string') return { ok: false, reason: error?.message ?? 'lease_outcome_ambiguous' };
    return { ok: true, leaseId: id };
  },
  release: async (leaseId, reason) => { await client.rpc('release_external_repo_lease', { lease_id: leaseId, reason }); },
});
