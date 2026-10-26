/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildExternalWorkProposal, buildWorktreeHandoff, computeVerifierOpinion, integrationOperationKey, projectIntegrationStatus, type ExternalWorkInput, type WorkEvent, type WorkItem,
} from '@anima/core';
import {
  authorizeExternalIntegrationEffect, executeAuthorizedExternalIntegration, operatorWorkTreeOptions, ExternalGitIntegrationProvider, parseExternalIntegrationConfig,
  type ExecuteExternalIntegrationDeps, type ExternalLeasePort,
} from './external-integration';
import { captureExternalTargetSpec, defaultExternalTargetDeps, EXTERNAL_TARGET_ENV, verifyExternalTargetForContract, type ExternalTargetDeps } from './external-target-resolver';
import { createTrustedGitRunner, type GitRunner } from './trusted-git';

// T5 — integração Git governada de candidato externo. Repositórios 100% descartáveis em tmpdir; persistência/lease por doubles
// (a exclusão mútua do BANCO é provada em supabase/tests/external_integration_effect.test.sql). Nada toca o banco residente.
jest.setTimeout(120_000);
const sandboxes: string[] = [];
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const sandbox = (): string => { const d = mkdtempSync(join(tmpdir(), 't5-')); sandboxes.push(d); return d; };

const CLAMP = "'use strict';\nfunction clamp(value, min, max) {\n  if (value < min) return min;\n  return value;\n}\nmodule.exports = { clamp };\n";
const CLAMP_FIXED = CLAMP.replace('  return value;', '  if (value > max) return max;\n  return value;');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const TARGET_REF = 'refs/heads/main';

interface Lab { root: string; rootSha: string; baseSha: string }
function makeLab(name: string): Lab {
  const base = sandbox(); mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries({ 'src/clamp.js': CLAMP, 'package.json': '{}', 'apps/web/package.json': '{}' })) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), baseSha: git(root, 'rev-parse', 'HEAD') };
}
function candidate(lab: Lab, attemptId: string): string {
  git(lab.root, 'checkout', '-q', '-b', `anima-work/${attemptId}`, lab.baseSha);
  writeFileSync(join(lab.root, 'src/clamp.js'), CLAMP_FIXED);
  git(lab.root, 'add', '-A'); git(lab.root, 'commit', '-q', '-m', 'candidato');
  const sha = git(lab.root, 'rev-parse', 'HEAD'); git(lab.root, 'checkout', '-q', 'main'); return sha;
}
const ev = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, author: WorkEvent['author'] = 'system'): WorkEvent =>
  ({ id, workItemId: 'w1', type, author, proposalVersion: 1, payload: { schema_version: 1, data } as never, occurredAt: NOW });

interface World {
  lab: Lab; item: WorkItem; events: WorkEvent[]; env: Record<string, string>; targetDeps: ExternalTargetDeps; attemptId: string; commit: string;
  receipts: unknown[]; leaseState: LeaseState; deps: ExecuteExternalIntegrationDeps; persistFailOnce: { on: boolean }; humanRefusal: { value: { code: string; message: string } | null };
}
interface LeaseState { held: Map<string, { id: string; owner: string }>; released: Array<{ id: string; reason: string }>; seq: number }

function leasePort(state: LeaseState, keyOf: (itemId: string) => string): ExternalLeasePort {
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

async function world(over: { reference?: string; lab?: Lab; owner?: string; leaseState?: LeaseState; gitWrap?: (run: GitRunner, args: readonly string[]) => Promise<ReturnType<GitRunner> extends Promise<infer R> ? R : never> } = {}): Promise<World> {
  const lab = over.lab ?? makeLab('shop'); const animaBase = sandbox(); mkdirSync(join(animaBase, 'apps/web'), { recursive: true });
  writeFileSync(join(animaBase, 'apps/web/package.json'), '{}'); writeFileSync(join(animaBase, 'package.json'), '{}'); git(animaBase, 'init', '-q', '-b', 'main'); writeFileSync(join(animaBase, 'a'), '1'); git(animaBase, 'add', '-A'); git(animaBase, 'commit', '-q', '-m', 'a');
  const anima = realpathSync.native(animaBase);
  const reference = over.reference ?? 'ext:shop';
  const env = { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference, repoRoot: lab.root, rootCommitSha: lab.rootSha }) };
  const targetDeps: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => anima };
  const captured = await captureExternalTargetSpec(env, { deps: targetDeps });
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
    workTreeOptions: operatorWorkTreeOptions(args => { try { return execFileSync('git', [...args], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } }),
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
function authorize(w: World, opts: { id?: string; expected?: string; targetRef?: string; baseOverride?: string } = {}): string {
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
const run = (w: World, id = 'auth-1') => executeAuthorizedExternalIntegration({ workItemId: 'w1', integrationAuthorizationId: id }, w.deps);
const main = (w: World): string => git(w.lab.root, 'rev-parse', 'refs/heads/main');
const count = (w: World): number => Number(git(w.lab.root, 'rev-list', '--count', 'refs/heads/main'));

describe('config do host', () => {
  test('exige exatamente reference e targetRef local seguro', () => {
    expect(parseExternalIntegrationConfig('{"reference":"ext:shop","targetRef":"refs/heads/main"}')).toMatchObject({ ok: true });
    for (const raw of [undefined, '', '{', '[]', '{"reference":"ext:shop"}', '{"reference":"ext:shop","targetRef":"main"}', '{"reference":"ext:shop","targetRef":"refs/heads/anima-work/x"}',
      '{"reference":"ext:shop","targetRef":"refs/remotes/origin/main"}', '{"reference":"anima","targetRef":"refs/heads/main"}', '{"reference":"ext:shop","targetRef":"refs/heads/main","remote":"origin"}']) {
      expect(parseExternalIntegrationConfig(raw)).toMatchObject({ ok: false });
    }
  });
});

describe('fast-forward governado', () => {
  test('destino FORA de checkout: CAS atômico, sem merge commit, repositório sem remoto, recibo coerente com o Git', async () => {
    const w = await world();
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    expect(git(w.lab.root, 'remote')).toBe('');
    authorize(w);
    const out = await run(w);
    expect(out).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(main(w)).toBe(w.commit);
    expect(count(w)).toBe(2); // base + candidato: nenhum commit de merge
    expect(git(w.lab.root, 'rev-parse', 'HEAD')).toBe(w.lab.baseSha); // a árvore em checkout ('work') não foi tocada
    const receipt = w.receipts[0] as { mergeCommitSha: null; mergeParents: string[]; resultingTargetSha: string; previousTargetSha: string };
    expect(receipt).toMatchObject({ mergeCommitSha: null, mergeParents: [], resultingTargetSha: w.commit, previousTargetSha: w.lab.baseSha, mode: 'ff_only', targetRef: TARGET_REF });
    expect(projectIntegrationStatus(w.events)).toBe('integrated');
    expect(w.leaseState.released).toEqual([{ id: 'lease-1', reason: 'completed' }]);
    expect(w.leaseState.held.size).toBe(0);
  });

  test('destino EM checkout na árvore principal (limpa): merge --ff-only; árvore e índice acompanham; recibo confirmado pelo reflog', async () => {
    const w = await world();
    authorize(w);
    expect(git(w.lab.root, 'symbolic-ref', 'HEAD')).toBe(TARGET_REF);
    const out = await run(w);
    expect(out).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(main(w)).toBe(w.commit);
    expect(readFileSync(join(w.lab.root, 'src/clamp.js'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).toBe(CLAMP_FIXED); // autocrlf do operador pode converter EOL
    expect(git(w.lab.root, 'status', '--porcelain')).toBe('');
    expect(count(w)).toBe(2);
    expect(projectIntegrationStatus(w.events)).toBe('integrated');
  });

  test('destino em checkout SUJO ou com arquivo não rastreado conflitante: recusa humana, nada muda', async () => {
    const w = await world();
    authorize(w);
    writeFileSync(join(w.lab.root, 'src/clamp.js'), CLAMP + '// edição local\n');
    const out = await run(w);
    expect(out).toMatchObject({ status: 'human_required', reason: 'target_checked_out:working_tree_dirty' });
    expect(main(w)).toBe(w.lab.baseSha);
    expect(readFileSync(join(w.lab.root, 'src/clamp.js'), 'utf8')).toContain('edição local');
    expect(w.receipts).toHaveLength(0);
    expect(w.leaseState.released.at(-1)).toMatchObject({ reason: 'failed' });
  });

  test('destino em checkout numa worktree VINCULADA: recusa', async () => {
    const w = await world();
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    git(w.lab.root, 'worktree', 'add', '-q', join(sandbox(), 'wt'), 'main');
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'target_checked_out_in_linked_worktree' });
    expect(main(w)).toBe(w.lab.baseSha);
  });

  test('config local com filtro/driver executável: recusa antes de tocar a árvore', async () => {
    const w = await world();
    git(w.lab.root, 'config', 'filter.evil.smudge', 'sh -c "echo pwned > pwned.txt"');
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'target_checked_out:unsafe_repository_config' });
    expect(existsSync(join(w.lab.root, 'pwned.txt'))).toBe(false);
    expect(main(w)).toBe(w.lab.baseSha);
  });

  test('destino divergente (avançou depois da autorização): authorization_stale, sem mutação', async () => {
    const w = await world();
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    authorize(w);
    git(w.lab.root, 'checkout', '-q', 'main'); writeFileSync(join(w.lab.root, 'other.txt'), 'x'); git(w.lab.root, 'add', '-A'); git(w.lab.root, 'commit', '-q', '-m', 'outro'); git(w.lab.root, 'checkout', '-q', 'work');
    const before = main(w);
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'authorization_stale' });
    expect(main(w)).toBe(before);
    expect(w.receipts).toHaveLength(0);
  });

  test('falha de CAS (corrida externa move o destino entre a leitura e o update-ref): nada é sobrescrito, sem recibo', async () => {
    let raced = false; const labRef: { root: string } = { root: '' };
    const w = await world({
      gitWrap: async (real, args) => {
        if (!raced && args.includes('update-ref')) {
          raced = true;
          const tree = git(labRef.root, 'rev-parse', 'refs/heads/main^{tree}');
          const racer = git(labRef.root, 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'corrida');
          git(labRef.root, 'update-ref', 'refs/heads/main', racer);
        }
        return real(args);
      },
    });
    labRef.root = w.lab.root;
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    authorize(w);
    const out = await run(w);
    expect(raced).toBe(true);
    expect(out).toMatchObject({ status: 'human_required', reason: 'authorization_stale' });
    expect(main(w)).not.toBe(w.commit);
    expect(git(w.lab.root, 'log', '-1', '--format=%s', 'refs/heads/main')).toBe('corrida');
    expect(w.receipts).toHaveLength(0);
  });

  test('falha DEPOIS do Git e ANTES do recibo: reconciliation_required; o retry reconcilia sem repetir o efeito', async () => {
    const w = await world();
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    authorize(w);
    w.persistFailOnce.on = true;
    const first = await run(w);
    expect(first).toMatchObject({ status: 'reconciliation_required' });
    expect(main(w)).toBe(w.commit);
    const reflogBefore = git(w.lab.root, 'reflog', 'show', 'refs/heads/main').split('\n').length;
    const second = await run(w);
    expect(second).toMatchObject({ status: 'integrated', disposition: 'reconciled' });
    expect(git(w.lab.root, 'reflog', 'show', 'refs/heads/main').split('\n').length).toBe(reflogBefore); // nenhuma nova escrita no ref
    expect(count(w)).toBe(2);
    expect(w.receipts).toHaveLength(1);
    expect(projectIntegrationStatus(w.events)).toBe('integrated');
  });

  test('retry após sucesso é idempotente (already_persisted) e só se o Git ainda comprova', async () => {
    const w = await world();
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(await run(w)).toMatchObject({ status: 'integrated', disposition: 'already_persisted' });
    expect(w.receipts).toHaveLength(1);
    git(w.lab.root, 'update-ref', 'refs/heads/main', w.lab.baseSha); // destino desfeito por fora
    expect(await run(w)).toMatchObject({ status: 'integrity_violation', reason: 'receipt_not_proven_by_git' });
  });
});

describe('pré-condições (nenhuma toca o Git)', () => {
  test('sem revisão humana dos critérios: bloqueia', async () => {
    const w = await world(); authorize(w);
    w.humanRefusal.value = { code: 'external_human_review_missing', message: 'x' };
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'external_human_review_missing' });
    expect(main(w)).toBe(w.lab.baseSha); expect(w.leaseState.seq).toBe(0);
  });

  test('Verifier ausente, item não completed, autorização inexistente', async () => {
    const w = await world(); authorize(w);
    w.events.splice(w.events.findIndex(e => e.type === 'verifier_opinion_recorded'), 1);
    expect(await run(w)).toMatchObject({ status: 'denied', reason: 'verifier_not_verified' });
    const w2 = await world(); authorize(w2);
    w2.deps = { ...w2.deps, getItem: async () => ({ ok: true as const, value: { ...w2.item, state: 'review' } as WorkItem }) };
    expect(await run(w2)).toMatchObject({ status: 'denied', reason: 'item_not_completed' });
    expect(await run(w2, 'nope')).toMatchObject({ status: 'denied' });
  });

  test('candidato errado: branch da attempt movida / commit do handoff diferente da autorização', async () => {
    const w = await world(); authorize(w);
    git(w.lab.root, 'checkout', '-q', `anima-work/${w.attemptId}`); writeFileSync(join(w.lab.root, 'extra.txt'), 'x'); git(w.lab.root, 'add', '-A'); git(w.lab.root, 'commit', '-q', '-m', 'extra'); git(w.lab.root, 'checkout', '-q', 'main');
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'candidate_branch_moved' });
    expect(main(w)).toBe(w.lab.baseSha);
    const w2 = await world(); authorize(w2);
    const ev0 = w2.events.find(e => e.type === 'integration_effect_authorized')!;
    ((ev0.payload as { data: Record<string, unknown> }).data)['result_commit_sha'] = w2.lab.baseSha;
    expect(await run(w2)).toMatchObject({ status: 'denied' });
  });

  test('SHA-base divergente na autorização congelada / destino não configurado pelo host / referência não configurada', async () => {
    const w = await world(); authorize(w, { baseOverride: 'f'.repeat(40) });
    expect(await run(w)).toMatchObject({ status: 'denied', reason: 'authorization_identity_mismatch' });
    const w2 = await world(); authorize(w2, { targetRef: 'refs/heads/release' });
    expect(await run(w2)).toMatchObject({ status: 'denied', reason: 'destination_not_configured' });
    const w3 = await world(); authorize(w3);
    w3.deps = { ...w3.deps, config: { reference: 'ext:other', targetRef: TARGET_REF } };
    expect(await run(w3)).toMatchObject({ status: 'denied' });
  });

  test('identidade física alterada (outro repositório ou clone) ⇒ recusa antes de qualquer mutação', async () => {
    const w = await world(); authorize(w);
    const stranger = makeLab('stranger');
    w.deps = { ...w.deps, verifyTarget: c => verifyExternalTargetForContract(c, { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference: 'ext:shop', repoRoot: stranger.root, rootCommitSha: stranger.rootSha }) }, w.targetDeps) };
    const out = await run(w);
    expect(out.status).toBe('denied');
    expect(main(w)).toBe(w.lab.baseSha); expect(w.leaseState.seq).toBe(0);
    const clone = join(sandbox(), 'clone'); execFileSync('git', ['clone', '-q', w.lab.root, clone], { windowsHide: true });
    const cloneRoot = realpathSync.native(clone);
    w.deps = { ...w.deps, verifyTarget: c => verifyExternalTargetForContract(c, { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference: 'ext:shop', repoRoot: cloneRoot, rootCommitSha: w.lab.rootSha }) }, w.targetDeps) };
    expect(await run(w)).toMatchObject({ status: 'denied', reason: 'external_target_identity_changed' });
  });
});

describe('exclusividade física', () => {
  test('outra referência (alias) no MESMO repositório é bloqueada enquanto o lease está ativo', async () => {
    const shared: LeaseState = { held: new Map(), released: [], seq: 0 };
    const w = await world({ leaseState: shared, owner: 'host-1' });
    authorize(w);
    shared.held.set(w.lab.root.toLowerCase(), { id: 'lease-other', owner: 'host-2' }); // item de outra referência detém o repositório
    expect(await run(w)).toMatchObject({ status: 'human_required' });
    expect((await run(w) as { reason: string }).reason).toMatch(/^repo_exclusivity_unavailable:/);
    expect(main(w)).toBe(w.lab.baseSha); expect(w.receipts).toHaveLength(0);
  });

  test('concorrência real: duas execuções simultâneas do mesmo efeito ⇒ um único efeito, um único recibo', async () => {
    const shared: LeaseState = { held: new Map(), released: [], seq: 0 };
    const a = await world({ leaseState: shared, owner: 'host-A' });
    authorize(a);
    const bDeps: ExecuteExternalIntegrationDeps = { ...a.deps, ownerInstanceId: 'host-B' };
    const [r1, r2] = await Promise.all([run(a), executeAuthorizedExternalIntegration({ workItemId: 'w1', integrationAuthorizationId: 'auth-1' }, bDeps)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses.filter(s => s === 'integrated').length).toBeGreaterThanOrEqual(1);
    expect(main(a)).toBe(a.commit); expect(count(a)).toBe(2);
    expect(a.receipts.length).toBeGreaterThanOrEqual(1);
    expect(a.receipts.length).toBeLessThanOrEqual(2);
    expect(projectIntegrationStatus(a.events)).toBe('integrated');
  });

  test('CAS real concorrente no Git: dois update-ref com o mesmo esperado ⇒ exatamente um vence', async () => {
    const w = await world();
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    const tree = git(w.lab.root, 'rev-parse', 'refs/heads/main^{tree}');
    const alt = git(w.lab.root, 'commit-tree', tree, '-p', 'refs/heads/main', '-m', 'alt');
    const gitDir = join(w.lab.root, '.git');
    const repo = new ExternalGitIntegrationProvider(createTrustedGitRunner({ gitDir }), w.lab.root, gitDir, existsSync);
    const results = await Promise.all([repo.casAdvance(TARGET_REF, w.commit, w.lab.baseSha, 'a'), repo.casAdvance(TARGET_REF, alt, w.lab.baseSha, 'b'), repo.casAdvance(TARGET_REF, w.commit, w.lab.baseSha, 'c')]);
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect([w.commit, alt]).toContain(main(w));
    // depois do vencedor, o esperado original não vale mais para ninguém
    expect(await repo.casAdvance(TARGET_REF, alt === main(w) ? w.commit : alt, w.lab.baseSha, 'd')).toBe(false);
  });
});

describe('Git hostil', () => {
  const HOOKS = ['post-merge', 'reference-transaction', 'post-checkout', 'pre-commit'];
  const plant = (root: string, marker: string): void => {
    for (const hook of HOOKS) {
      const path = join(root, '.git', 'hooks', hook);
      writeFileSync(path, `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    }
  };

  test('hooks do repositório NÃO executam (CAS e merge em checkout); o controle prova que o Git comum os executaria', async () => {
    for (const checkedOut of [false, true]) {
      const w = await world();
      if (!checkedOut) git(w.lab.root, 'checkout', '-q', '-b', 'work');
      const marker = join(sandbox(), 'hook-ran.txt');
      plant(w.lab.root, marker);
      authorize(w);
      expect(await run(w)).toMatchObject({ status: 'integrated' });
      expect(existsSync(marker)).toBe(false);
      // controle: Git comum, mesmos hooks, mesma operação ⇒ o marcador aparece
      const c = await world();
      const controlMarker = join(sandbox(), 'control-ran.txt');
      plant(c.lab.root, controlMarker);
      if (checkedOut) git(c.lab.root, 'merge', '--ff-only', '-q', c.commit); else git(c.lab.root, 'update-ref', TARGET_REF, c.commit, c.lab.baseSha);
      expect(existsSync(controlMarker)).toBe(true);
    }
  });

  test('variáveis GIT_* do ambiente do pai não redirecionam o repositório', async () => {
    const w = await world();
    const decoy = makeLab('decoy');
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(decoy.root, '.git'); process.env.GIT_WORK_TREE = decoy.root;
    try {
      authorize(w);
      expect(await run(w)).toMatchObject({ status: 'integrated' });
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved.dir;
      if (saved.tree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = saved.tree;
    }
    expect(main(w)).toBe(w.commit);
    expect(git(decoy.root, 'rev-parse', 'HEAD')).toBe(decoy.baseSha);
  });
});

describe('autorização humana (cliente)', () => {
  test('lê o SHA do destino, confere ff e chama o RPC externo; não autoriza ff impossível', async () => {
    const w = await world();
    const calls: unknown[] = [];
    const rpc = async (args: unknown) => { calls.push(args); return { data: { action: 'recorded', operation_key: 'k' }, error: null }; };
    const base = { getItem: w.deps.getItem, listEvents: w.deps.listEvents, config: w.deps.config, verifyTarget: w.deps.verifyTarget, gitFor: w.deps.gitFor, exists: existsSync, rpc: rpc as never };
    const ok = await authorizeExternalIntegrationEffect({ workItemId: 'w1', authorizationId: 'auth-9' }, base);
    expect(ok).toMatchObject({ ok: true, expectedTargetSha: w.lab.baseSha, targetRef: TARGET_REF });
    expect(calls[0]).toMatchObject({ work_item_id: 'w1', accepted_result_event_id: 'res-1', target_ref: TARGET_REF, expected_target_sha: w.lab.baseSha, authorization_id: 'auth-9' });
    git(w.lab.root, 'checkout', '-q', '-b', 'work');
    writeFileSync(join(w.lab.root, 'z.txt'), 'z'); git(w.lab.root, 'add', '-A'); git(w.lab.root, 'commit', '-q', '-m', 'z');
    git(w.lab.root, 'update-ref', TARGET_REF, git(w.lab.root, 'rev-parse', 'HEAD')); // main agora diverge do candidato
    expect(await authorizeExternalIntegrationEffect({ workItemId: 'w1', authorizationId: 'auth-10' }, base)).toEqual({ ok: false, reason: 'ff_not_possible' });
    expect(calls).toHaveLength(1);
  });
});
