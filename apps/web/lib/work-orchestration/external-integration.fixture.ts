import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildExternalWorkProposal, buildWorktreeHandoff, computeVerifierOpinion, integrationOperationKey, type ExternalWorkInput, type WorkEvent, type WorkItem,
} from '@anima/core';
import { executeAuthorizedExternalIntegration, operatorWorkTreeOptions, type ExecuteExternalIntegrationDeps, type ExternalLeasePort } from './external-integration';
import { captureExternalTargetSpec, defaultExternalTargetDeps, EXTERNAL_TARGET_ENV, verifyExternalTargetForContract, type ExternalTargetDeps } from './external-target-resolver';
import { createTrustedGitRunner, type GitRunner } from './trusted-git';

// Fixture compartilhada dos testes de integração externa (T5 e V1-01): repositórios 100% descartáveis em tmpdir; persistência e lease por
// doubles. Nada toca o banco residente.
const sandboxes: string[] = [];
export const cleanupSandboxes = (): void => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); };
export const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
export const sandbox = (): string => { const d = mkdtempSync(join(tmpdir(), 't5-')); sandboxes.push(d); return d; };

export const CLAMP = "'use strict';\nfunction clamp(value, min, max) {\n  if (value < min) return min;\n  return value;\n}\nmodule.exports = { clamp };\n";
export const CLAMP_FIXED = CLAMP.replace('  return value;', '  if (value > max) return max;\n  return value;');
export const NOW = new Date('2026-10-26T12:00:00.000Z');
export const TARGET_REF = 'refs/heads/main';

export interface Lab { root: string; rootSha: string; baseSha: string }
export function makeLab(name: string, localConfig: Record<string, string> = {}): Lab {
  const base = sandbox(); mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q', '-b', 'main');
  for (const [key, value] of Object.entries(localConfig)) git(root, 'config', '--local', key, value);
  for (const [p, c] of Object.entries({ 'src/clamp.js': CLAMP, 'package.json': '{}', 'apps/web/package.json': '{}' })) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), baseSha: git(root, 'rev-parse', 'HEAD') };
}
export function candidate(lab: Lab, attemptId: string): string {
  git(lab.root, 'checkout', '-q', '-b', `anima-work/${attemptId}`, lab.baseSha);
  writeFileSync(join(lab.root, 'src/clamp.js'), CLAMP_FIXED);
  git(lab.root, 'add', '-A'); git(lab.root, 'commit', '-q', '-m', 'candidato');
  const sha = git(lab.root, 'rev-parse', 'HEAD'); git(lab.root, 'checkout', '-q', 'main'); return sha;
}
export const ev = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, author: WorkEvent['author'] = 'system'): WorkEvent =>
  ({ id, workItemId: 'w1', type, author, proposalVersion: 1, payload: { schema_version: 1, data } as never, occurredAt: NOW });

export interface World {
  lab: Lab; item: WorkItem; events: WorkEvent[]; env: Record<string, string>; targetDeps: ExternalTargetDeps; attemptId: string; commit: string;
  receipts: unknown[]; leaseState: LeaseState; deps: ExecuteExternalIntegrationDeps; persistFailOnce: { on: boolean }; humanRefusal: { value: { code: string; message: string } | null };
}
export interface LeaseState { held: Map<string, { id: string; owner: string }>; released: Array<{ id: string; reason: string }>; seq: number }

export function leasePort(state: LeaseState, keyOf: (itemId: string) => string): ExternalLeasePort {
  return {
    acquire: async (itemId, owner) => {
      const key = keyOf(itemId);
      await Promise.resolve();
      const current = state.held.get(key);
      if (current && current.owner !== owner) return { ok: false, reason: 'external repository is held by an active lease' };
      const id = current?.id ?? `lease-${++state.seq}`;
      state.held.set(key, { id, owner });
      return { ok: true, leaseId: id };
    },
    release: async (id, reason) => { state.released.push({ id, reason }); for (const [k, v] of state.held) if (v.id === id) state.held.delete(k); },
  };
}

export async function world(over: { env?: (lab: Lab) => Record<string, string>; localConfig?: Record<string, string>; workTreeOptions?: readonly string[]; reference?: string; lab?: Lab; owner?: string; leaseState?: LeaseState; gitWrap?: (run: GitRunner, args: readonly string[]) => Promise<ReturnType<GitRunner> extends Promise<infer R> ? R : never> } = {}): Promise<World> {
  const lab = over.lab ?? makeLab('shop', over.localConfig); const animaBase = sandbox(); mkdirSync(join(animaBase, 'apps/web'), { recursive: true });
  writeFileSync(join(animaBase, 'apps/web/package.json'), '{}'); writeFileSync(join(animaBase, 'package.json'), '{}'); git(animaBase, 'init', '-q', '-b', 'main'); writeFileSync(join(animaBase, 'a'), '1'); git(animaBase, 'add', '-A'); git(animaBase, 'commit', '-q', '-m', 'a');
  const anima = realpathSync.native(animaBase);
  const reference = over.reference ?? 'ext:shop';
  const env = over.env ? over.env(lab) : { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference, repoRoot: lab.root, rootCommitSha: lab.rootSha }) };
  const targetDeps: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => anima };
  const captured = await captureExternalTargetSpec(env, { deps: targetDeps, reference });
  if (!captured.ok) throw new Error(captured.code);
  const input: ExternalWorkInput = {
    reference, objective: 'Corrigir clamp quando excede max', scope: ['src/clamp.js'], excluded: ['package.json'],
    acceptance: [{ id: 'A1', text: 'clamp(15, 0, 10) retorna 10' }, { id: 'A2', text: 'npm test passa' }], gates: [{ command: 'npm test', covers: ['A1', 'A2'] }], bindings: [], reviews: [], backend: 'codex-cli',
  };
  const built = buildExternalWorkProposal(input, captured.specTarget, NOW.toISOString());
  if (!built.ok) throw new Error(built.code);
  const item = { ...built.command, id: 'w1', userId: 'u', sourceMessageId: 's', state: 'completed', originalRequest: 'x', proposalVersion: 1, createdAt: NOW, updatedAt: NOW } as unknown as WorkItem;
  const attemptId = `att-${Math.random().toString(16).slice(2, 8)}`;
  const commit = candidate(lab, attemptId);
  const handoff = buildWorktreeHandoff({ workItemId: 'w1', attemptId, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'codex-cli:default', model: null,
    baseSha: lab.baseSha, branch: `anima-work/${attemptId}`, commitSha: commit, status: 'succeeded', changedFiles: ['src/clamp.js'],
    diffFiles: [{ path: 'src/clamp.js', insertions: 1, deletions: 0 }], gates: [{ label: 'npm test', command: 'npm test', exitCode: 0, outcome: 'passed' }] });
  if (!handoff.ok) throw new Error(handoff.explanation);
  const result = ev('res-1', 'result_submitted', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, summary: 'feito', result_references: [], executor_signal: { worktreeHandoff: handoff.value } });
  const opinion = computeVerifierOpinion({ ...item, state: 'review' } as WorkItem, [result]);
  if (!opinion) throw new Error('sem parecer');
  const verified = { ...opinion, verdict: 'verified' as const, evidenceBasis: { ...opinion.evidenceBasis, observedEventId: 'ev-git', observedGateEventId: 'ev-gate', coverage: { git: true, gates: true } } };
  const events: WorkEvent[] = [result,
    ev('git-1', 'host_observed_evidence_recorded', { attempt_id: attemptId, evidence: { observedCommitSha: commit, baseSha: lab.baseSha } }),
    ev('op-1', 'verifier_opinion_recorded', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, opinion: verified }),
    ev('acc-1', 'result_accepted', { accepted_result_event_id: 'res-1' }, 'user')];
  const receipts: unknown[] = [];
  const persistFailOnce = { on: false };
  const humanRefusal: World['humanRefusal'] = { value: null };
  const leaseState = over.leaseState ?? { held: new Map(), released: [], seq: 0 };
  const deps: ExecuteExternalIntegrationDeps = {
    getItem: async () => ({ ok: true as const, value: item }), listEvents: async () => ({ ok: true as const, value: [...events] }),
    config: { reference, targetRef: TARGET_REF },
    verifyTarget: contract => verifyExternalTargetForContract(contract, env, targetDeps),
    gitFor: gitDir => { const real = createTrustedGitRunner({ gitDir }); return over.gitWrap ? (args => over.gitWrap!(real, args)) : real; },
    exists: existsSync,
    workTreeOptions: over.workTreeOptions ?? operatorWorkTreeOptions(args => { try { return execFileSync('git', [...args], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } }),
    lease: leasePort(leaseState, () => lab.root.toLowerCase()),
    humanReviewRefusal: async () => humanRefusal.value,
    persist: async (auth, receipt) => {
      if (persistFailOnce.on) { persistFailOnce.on = false; throw new Error('db_down'); }
      receipts.push(receipt);
      events.push(ev(`done-${receipts.length}`, 'integration_completed', { authorization_id: auth.authorizationId, receipt }));
      return { action: 'recorded', eventSeq: events.length };
    },
    ownerInstanceId: over.owner ?? 'host-1',
  };
  return { lab, item, events, env, targetDeps, attemptId, commit, receipts, leaseState, deps, persistFailOnce, humanRefusal };
}

/** Ato humano (RPC espelhada): grava `integration_effect_authorized` ff_only com a identidade congelada. */
export function authorize(w: World, opts: { id?: string; expected?: string; targetRef?: string; baseOverride?: string } = {}): string {
  const id = opts.id ?? 'auth-1';
  const expected = opts.expected ?? w.lab.baseSha; const targetRef = opts.targetRef ?? TARGET_REF;
  const repositoryId = `external:${w.deps.config.reference}`;
  const operationKey = integrationOperationKey({ authorizationId: id, acceptedResultEventId: 'res-1', repositoryId, targetRef, expectedTargetSha: expected, resultCommitSha: w.commit, mode: 'ff_only' });
  w.events.push(ev(`auth-evt-${id}`, 'integration_effect_authorized', {
    authorization_id: id, operation_key: operationKey, work_item_id: 'w1', approved_proposal_version: 1, attempt_id: w.attemptId, accepted_result_event_id: 'res-1',
    result_commit_sha: w.commit, repository_id: repositoryId, target_ref: targetRef, expected_target_sha: expected, mode: 'ff_only',
    external: { reference: w.deps.config.reference, repo_root_canonical: w.lab.root, git_common_dir_canonical: join(w.lab.root, '.git'), root_commit_sha: w.lab.rootSha, base_sha: opts.baseOverride ?? w.lab.baseSha },
  }, 'user'));
  return id;
}
export const run = (w: World, id = 'auth-1') => executeAuthorizedExternalIntegration({ workItemId: 'w1', integrationAuthorizationId: id }, w.deps);
export const main = (w: World): string => git(w.lab.root, 'rev-parse', 'refs/heads/main');
export const count = (w: World): number => Number(git(w.lab.root, 'rev-list', '--count', 'refs/heads/main'));
