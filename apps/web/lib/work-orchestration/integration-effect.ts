import { isAbsolute } from 'node:path';
import {
  buildIntegrationEffectReceipt,
  classifyIntegrationTarget,
  INTEGRATION_EFFECT_MODE,
  INTEGRATION_EFFECT_TARGET_REF,
  planIntegrationEffect,
  sameIntegrationEffect,
  type IntegrationEffectAuthorizationV1,
  type IntegrationEffectPlanDefect,
  type IntegrationEffectReceiptV1,
  type WorkEvent,
  type WorkItem,
  type WorkOperationResult,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectRoot } from './executor-selection';
import { createWorkOrchestrationService } from './server';
import { runProcess, type CommandResult } from './worktree';

// ============================================================
// Completed → Integrated V0 — executor do efeito Git AUTORIZADO em refs/heads/dev.
//
// Protocolo reconciliável (Git e Postgres não são uma transação):
//   autorização persistida → carregar/revalidar (fatos + config) → inspecionar Git →
//   preparar merge SEM tocar o alvo (`merge-tree --write-tree`) → criar o merge commit
//   (`commit-tree -p esperado -p resultado`) → avançar o alvo por COMPARE-AND-SWAP
//   (`update-ref <alvo> <novo> <esperado>`) → inspecionar de novo → persistir o receipt.
//
// Nunca persiste `integration_completed` antes do efeito observado. Nunca rebaseia,
// recalcula a base, troca a fonte nem atualiza a autorização: alvo que andou ⇒
// `authorization_stale` (nova decisão humana). Nunca toca `main`: o alvo é a constante
// `refs/heads/dev`, e o chamador fornece só identidades opacas.
//
// O merge é preparado sem worktree (objetos apenas), então não depende da worktree da
// attempt nem da branch de origem — só do commit exato. O alvo não pode estar em
// checkout em nenhuma worktree (mover uma branch em checkout dessincronizaria a árvore
// de trabalho do operador): nesse caso, `target_checked_out` (human_required).
// ============================================================

export interface IntegrationEffectConfig {
  readonly repoRoot: string;
  readonly repositoryId: string;
  readonly remoteName: string;
}

const SAFE_REF = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && !/[\s~^:?*[\\]/.test(value) && !value.includes('..') && !value.endsWith('/') && !value.endsWith('.lock');

/** Configuração confiável do servidor. Ausente/insegura ⇒ `null` (sem capacidade). O alvo
 * NÃO é configurável: é sempre `refs/heads/dev`. */
export function integrationEffectConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): IntegrationEffectConfig | null {
  const repositoryId = env.ANIMA_INTEGRATION_REPOSITORY_ID?.trim();
  const remoteName = env.ANIMA_INTEGRATION_REMOTE_NAME?.trim();
  const repoRoot = env.ANIMA_INTEGRATION_REPO_ROOT?.trim() || projectRoot();
  if (!repositoryId || !remoteName || !SAFE_REF(remoteName) || !isAbsolute(repoRoot)) return null;
  return { repoRoot, repositoryId, remoteName };
}

// ─── Provider Git (dev-only) ───────────────────────────────────────────────────

type GitRun = (args: readonly string[]) => Promise<CommandResult>;
const SHA = /^[a-f0-9]{40}$/;
const firstSha = (output: string): string | null => {
  const token = output.trim().split(/\s+/)[0];
  return token && SHA.test(token) ? token : null;
};
const normalizeRepository = (value: string): string => value.trim().replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/').replace(/\\/g, '/').toLowerCase();
const failed = (result: CommandResult): boolean => result.exitCode !== 0 || result.timedOut || result.cancelled;

export class IntegrationGitError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'IntegrationGitError'; }
}

export class GitIntegrationEffectProvider {
  private readonly run: GitRun;
  private readonly identity = ['-c', 'user.name=Anima Integration', '-c', 'user.email=integration@anima.invalid'];

  constructor(repoRoot: string, run?: GitRun) {
    this.run = run ?? ((args) => runProcess('git', ['-C', repoRoot, ...args], { cwd: repoRoot, timeoutMs: 60_000 }));
  }

  private async ok(args: readonly string[], code: string): Promise<CommandResult> {
    const result = await this.run(args);
    if (failed(result)) throw new IntegrationGitError(code, `git ${args[0] ?? ''} falhou`);
    return result;
  }

  async repositoryMatches(config: IntegrationEffectConfig): Promise<boolean> {
    const result = await this.run(['remote', 'get-url', config.remoteName]);
    return !failed(result) && normalizeRepository(result.stdout) === normalizeRepository(config.repositoryId);
  }

  async readTarget(): Promise<string> {
    const sha = firstSha((await this.ok(['rev-parse', '--verify', `${INTEGRATION_EFFECT_TARGET_REF}^{commit}`], 'target_unreadable')).stdout);
    if (!sha) throw new IntegrationGitError('target_unreadable', 'Alvo sem SHA legível.');
    return sha;
  }

  async commitExists(sha: string): Promise<boolean> {
    return !failed(await this.run(['cat-file', '-e', `${sha}^{commit}`]));
  }

  /** `true`/`false` pelo exit code do merge-base; qualquer outro desfecho é erro. */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.run(['merge-base', '--is-ancestor', ancestor, descendant]);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1 && !result.timedOut && !result.cancelled) return false;
    throw new IntegrationGitError('ancestry_unknown', 'Ancestralidade não pôde ser determinada.');
  }

  async parents(sha: string): Promise<readonly string[]> {
    const tokens = (await this.ok(['rev-list', '--parents', '-n', '1', sha], 'parents_unreadable')).stdout.trim().split(/\s+/);
    return tokens.slice(1).filter((token) => SHA.test(token));
  }

  async targetCheckedOut(): Promise<boolean> {
    const out = (await this.ok(['worktree', 'list', '--porcelain'], 'worktrees_unreadable')).stdout;
    return out.split(/\r?\n/).some((line) => line.trim() === `branch ${INTEGRATION_EFFECT_TARGET_REF}`);
  }

  /** Prepara o merge SEM tocar o alvo: `tree` ou `conflict`. */
  async prepareMerge(base: string, commit: string): Promise<{ readonly tree: string } | { readonly conflict: true }> {
    const result = await this.run(['merge-tree', '--write-tree', '--no-messages', base, commit]);
    if (result.exitCode === 1 && !result.timedOut) return { conflict: true };
    if (failed(result)) throw new IntegrationGitError('prepare_failed', 'merge-tree falhou.');
    const tree = firstSha(result.stdout);
    if (!tree) throw new IntegrationGitError('prepare_failed', 'merge-tree sem árvore.');
    return { tree };
  }

  async commitMerge(tree: string, base: string, commit: string, message: string): Promise<string> {
    const sha = firstSha((await this.ok([...this.identity, 'commit-tree', tree, '-p', base, '-p', commit, '-m', message], 'commit_failed')).stdout);
    if (!sha) throw new IntegrationGitError('commit_failed', 'commit-tree sem SHA.');
    return sha;
  }

  /** Compare-and-swap: só avança se o alvo ainda estiver em `expected`. */
  async casAdvance(next: string, expected: string, reason: string): Promise<boolean> {
    const result = await this.run(['update-ref', '-m', reason, INTEGRATION_EFFECT_TARGET_REF, next, expected]);
    return !failed(result);
  }
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export type IntegrationEffectOutcome =
  | { readonly status: 'integrated'; readonly disposition: 'effected' | 'reconciled' | 'already_persisted'; readonly receipt: IntegrationEffectReceiptV1; readonly cleanup: 'none' | 'done' | 'failed' }
  | { readonly status: 'denied'; readonly reason: IntegrationEffectPlanDefect | 'repository_mismatch' | 'result_not_descendant_of_base' | 'unexpected_merge_parents' }
  | { readonly status: 'human_required'; readonly reason: 'authorization_stale' | 'ambiguous_target' | 'merge_conflict' | 'result_commit_missing' | 'target_checked_out' }
  | { readonly status: 'retryable'; readonly reason: string }
  | { readonly status: 'reconciliation_required'; readonly reason: string; readonly receipt?: IntegrationEffectReceiptV1 }
  | { readonly status: 'integrity_violation'; readonly reason: string };

export type PersistIntegrationReceipt = (
  authorization: IntegrationEffectAuthorizationV1,
  receipt: IntegrationEffectReceiptV1,
) => Promise<{ readonly action: 'recorded' | 'replayed'; readonly eventSeq: number }>;

export interface ExecuteIntegrationDeps {
  readonly getItem: (id: string) => Promise<WorkOperationResult<WorkItem>>;
  readonly listEvents: (id: string) => Promise<WorkOperationResult<readonly WorkEvent[]>>;
  readonly config: IntegrationEffectConfig;
  readonly provider: GitIntegrationEffectProvider;
  readonly persist: PersistIntegrationReceipt;
  /** Limpeza pós-receipt (opcional). Falha NÃO desfaz a integração. */
  readonly cleanup?: (receipt: IntegrationEffectReceiptV1) => Promise<void>;
}

/**
 * Executa EXATAMENTE o efeito autorizado. O chamador fornece só identidades opacas;
 * alvo, fonte, repositório e modo vêm dos fatos persistidos e da configuração.
 */
export async function executeAuthorizedIntegration(
  input: { readonly workItemId: string; readonly integrationAuthorizationId: string },
  deps: ExecuteIntegrationDeps,
): Promise<IntegrationEffectOutcome> {
  const [item, events] = await Promise.all([deps.getItem(input.workItemId), deps.listEvents(input.workItemId)]);
  if (!item.ok || !events.ok) return { status: 'retryable', reason: 'persisted_state_unreadable' };

  const planned = planIntegrationEffect({
    item: item.value, events: events.value, authorizationId: input.integrationAuthorizationId,
    trustedRepositoryId: deps.config.repositoryId,
  });
  if (!planned.ok) return { status: 'denied', reason: planned.defect };
  const { authorization: auth, handoff, persisted } = planned.plan;
  const provider = deps.provider;

  try {
    if (!(await provider.repositoryMatches(deps.config))) return { status: 'denied', reason: 'repository_mismatch' };
    if (!(await provider.commitExists(auth.resultCommitSha))) return { status: 'human_required', reason: 'result_commit_missing' };
    if (!(await provider.isAncestor(handoff.baseSha, auth.resultCommitSha))) return { status: 'denied', reason: 'result_not_descendant_of_base' };

    const current = await provider.readTarget();

    // Receipt já persistido: sucesso idempotente SÓ se o Git ainda o comprova.
    if (persisted) {
      if (persisted.operationKey !== auth.operationKey || persisted.authorizationId !== auth.authorizationId) {
        return { status: 'integrity_violation', reason: 'receipt_conflict' };
      }
      const proven = (await provider.commitExists(persisted.mergeCommitSha))
        && sameParents(await provider.parents(persisted.mergeCommitSha), persisted.mergeParents)
        && (await provider.isAncestor(persisted.mergeCommitSha, current));
      return proven
        ? { status: 'integrated', disposition: 'already_persisted', receipt: persisted, cleanup: 'none' }
        : { status: 'integrity_violation', reason: 'receipt_not_proven_by_git' };
    }

    const observation = {
      targetSha: current,
      targetParents: await provider.parents(current),
      resultCommitInTarget: await provider.isAncestor(auth.resultCommitSha, current),
    };
    const classification = classifyIntegrationTarget(auth, observation);
    if (classification === 'stale') return { status: 'human_required', reason: 'authorization_stale' };
    if (classification === 'ambiguous') return { status: 'human_required', reason: 'ambiguous_target' };
    if (classification === 'already_effected') {
      // Efeito EXATO já no Git sem receipt (crash entre Git e Postgres): persistir, NÃO repetir.
      return persistObserved(auth, { mergeCommitSha: current, mergeParents: observation.targetParents, resultingTargetSha: current }, 'reconciled', deps);
    }

    if (await provider.targetCheckedOut()) return { status: 'human_required', reason: 'target_checked_out' };
    const prepared = await provider.prepareMerge(auth.expectedTargetSha, auth.resultCommitSha);
    if ('conflict' in prepared) return { status: 'human_required', reason: 'merge_conflict' };
    const merge = await provider.commitMerge(
      prepared.tree, auth.expectedTargetSha, auth.resultCommitSha,
      `Integre ${auth.workItemId} (attempt ${auth.attemptId})\n\nanima-integration: ${auth.operationKey}`,
    );
    if (!sameParents(await provider.parents(merge), [auth.expectedTargetSha, auth.resultCommitSha])) {
      return { status: 'denied', reason: 'unexpected_merge_parents' };
    }

    const advanced = await provider.casAdvance(merge, auth.expectedTargetSha, `anima integration ${auth.operationKey}`);
    const after = await provider.readTarget();
    if (!advanced && after !== merge) {
      // Perdeu o CAS: outro executor (ou humano) moveu o alvo. Reclassifica sobre o fato.
      const reobserved = classifyIntegrationTarget(auth, {
        targetSha: after,
        targetParents: await provider.parents(after),
        resultCommitInTarget: await provider.isAncestor(auth.resultCommitSha, after),
      });
      if (reobserved === 'already_effected') {
        return persistObserved(auth, { mergeCommitSha: after, mergeParents: await provider.parents(after), resultingTargetSha: after }, 'reconciled', deps);
      }
      if (reobserved === 'ready') return { status: 'retryable', reason: 'target_update_failed' };
      return { status: 'human_required', reason: reobserved === 'ambiguous' ? 'ambiguous_target' : 'authorization_stale' };
    }

    // Observação independente do efeito.
    if (after !== merge) return { status: 'reconciliation_required', reason: 'effect_not_observed' };
    return persistObserved(auth, { mergeCommitSha: merge, mergeParents: await provider.parents(merge), resultingTargetSha: after }, 'effected', deps);
  } catch (error) {
    return error instanceof IntegrationGitError
      ? { status: 'retryable', reason: error.code }
      : { status: 'reconciliation_required', reason: error instanceof Error ? error.message : String(error) };
  }
}

const sameParents = (observed: readonly string[], expected: readonly string[]): boolean =>
  observed.length === expected.length && observed.every((sha, i) => sha === expected[i]);

async function persistObserved(
  auth: IntegrationEffectAuthorizationV1,
  observed: { readonly mergeCommitSha: string; readonly mergeParents: readonly string[]; readonly resultingTargetSha: string },
  disposition: 'effected' | 'reconciled',
  deps: ExecuteIntegrationDeps,
): Promise<IntegrationEffectOutcome> {
  const receipt = buildIntegrationEffectReceipt(auth, observed, disposition);
  if (!receipt) return { status: 'integrity_violation', reason: 'observed_effect_mismatch' };
  try {
    await deps.persist(auth, receipt);
  } catch (error) {
    // Efeito feito, receipt não gravado: a próxima chamada reconcilia por inspeção.
    return { status: 'reconciliation_required', reason: `receipt_persist_failed:${error instanceof Error ? error.message : String(error)}`, receipt };
  }
  let cleanup: 'none' | 'done' | 'failed' = 'none';
  if (deps.cleanup) {
    cleanup = await deps.cleanup(receipt).then(() => 'done' as const, () => 'failed' as const);
  }
  return { status: 'integrated', disposition, receipt, cleanup };
}

export { sameIntegrationEffect };

// ─── Autorização HUMANA do efeito ──────────────────────────────────────────────

export type AuthorizeIntegrationEffectOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly operationKey: string; readonly expectedTargetSha: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Ato HUMANO: autoriza UM efeito. Tudo é derivado: resultado aceito (último
 * `result_accepted`), repositório (config), alvo (`refs/heads/dev`), modo
 * (`merge_no_ff`) e SHA-alvo esperado (lido do Git agora — o que o humano vê). O commit
 * do resultado é derivado pela própria RPC a partir do handoff persistido.
 */
export async function authorizeIntegrationEffect(
  input: { readonly workItemId: string; readonly authorizationId: string },
  deps: {
    readonly getItem: ExecuteIntegrationDeps['getItem'];
    readonly listEvents: ExecuteIntegrationDeps['listEvents'];
    readonly config: IntegrationEffectConfig;
    readonly provider: GitIntegrationEffectProvider;
    readonly rpc: (args: Database['public']['Functions']['authorize_integration_effect']['Args']) => Promise<{ readonly data: Json | null; readonly error: { readonly message: string } | null }>;
  },
): Promise<AuthorizeIntegrationEffectOutcome> {
  const [item, events] = await Promise.all([deps.getItem(input.workItemId), deps.listEvents(input.workItemId)]);
  if (!item.ok || !events.ok) return { ok: false, reason: 'persisted_state_unreadable' };
  if (item.value.state !== 'completed') return { ok: false, reason: 'item_not_completed' };
  let accepted: string | null = null;
  for (const event of events.value) {
    if (event.type !== 'result_accepted') continue;
    const data = (event.payload as { data?: { accepted_result_event_id?: unknown } } | null)?.data;
    accepted = typeof data?.accepted_result_event_id === 'string' ? data.accepted_result_event_id : null;
  }
  if (!accepted) return { ok: false, reason: 'acceptance_missing' };
  if (!(await deps.provider.repositoryMatches(deps.config))) return { ok: false, reason: 'repository_mismatch' };
  let expectedTargetSha: string;
  try { expectedTargetSha = await deps.provider.readTarget(); } catch { return { ok: false, reason: 'target_unreadable' }; }

  const { data, error } = await deps.rpc({
    work_item_id: input.workItemId,
    expected_proposal_version: item.value.proposalVersion,
    accepted_result_event_id: accepted,
    authorization_id: input.authorizationId,
    repository_id: deps.config.repositoryId,
    target_ref: INTEGRATION_EFFECT_TARGET_REF,
    expected_target_sha: expectedTargetSha,
    mode: INTEGRATION_EFFECT_MODE,
  });
  if (error) return { ok: false, reason: error.message };
  const value = data as { action?: unknown; operation_key?: unknown } | null;
  if ((value?.action !== 'recorded' && value?.action !== 'replayed') || typeof value.operation_key !== 'string') {
    return { ok: false, reason: 'authorization_outcome_ambiguous' };
  }
  return { ok: true, action: value.action, operationKey: value.operation_key, expectedTargetSha };
}

// ─── Fiação Supabase ───────────────────────────────────────────────────────────

export const supabaseIntegrationReceiptPersistence = (client: SupabaseClient<Database>): PersistIntegrationReceipt =>
  async (auth, receipt) => {
    const { data, error } = await client.rpc('record_integration_completed', {
      work_item_id: auth.workItemId,
      expected_proposal_version: auth.proposalVersion,
      authorization_id: auth.authorizationId,
      receipt: receipt as unknown as Json,
    });
    if (error) throw new Error(error.message);
    const value = data as { action?: unknown; event_seq?: unknown } | null;
    if ((value?.action !== 'recorded' && value?.action !== 'replayed') || typeof value.event_seq !== 'number') {
      throw new Error('Persistência do receipt de integração retornou outcome ambíguo.');
    }
    return { action: value.action, eventSeq: value.event_seq };
  };

export function executeAuthorizedIntegrationWithSupabase(
  client: SupabaseClient<Database>,
  input: { readonly workItemId: string; readonly integrationAuthorizationId: string },
  config: IntegrationEffectConfig,
): Promise<IntegrationEffectOutcome> {
  const service = createWorkOrchestrationService(client);
  return executeAuthorizedIntegration(input, {
    getItem: (id) => service.getItem(id),
    listEvents: (id) => service.listEvents(id),
    config,
    provider: new GitIntegrationEffectProvider(config.repoRoot),
    persist: supabaseIntegrationReceiptPersistence(client),
  });
}
