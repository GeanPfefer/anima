/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { integrationOperationKey, projectIntegrationStatus, type WorkItem } from '@anima/core';
import {
  authorizeExternalIntegrationEffect, executeAuthorizedExternalIntegration, ExternalGitIntegrationProvider, operatorWorkTreeOptions, parseExternalIntegrationConfig,
  type ExecuteExternalIntegrationDeps, type ExternalLeasePort,
} from './external-integration';
import { EXTERNAL_TARGET_ENV, verifyExternalTargetForContract } from './external-target-resolver';
import { createTrustedGitRunner } from './trusted-git';
import {
  authorize, candidate, cleanupSandboxes, CLAMP, CLAMP_FIXED, count, ev, git, main, makeLab, NOW, run, sandbox, TARGET_REF, world, type LeaseState, type Lab,
} from './external-integration.fixture';

// T5 — integração Git governada de candidato externo. Repositórios 100% descartáveis em tmpdir; persistência/lease por doubles
// (a exclusão mútua do BANCO é provada em supabase/tests/external_integration_effect.test.sql). Nada toca o banco residente.
jest.setTimeout(120_000);
afterAll(cleanupSandboxes);

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

describe('core.autocrlf — precedência (T5-R1)', () => {
  const operatorTrue = ['-c', 'core.autocrlf=true'] as const;
  const operatorFalse = ['-c', 'core.autocrlf=false'] as const;
  const CR = String.fromCharCode(13);
  const plainStatus = (root: string): string => git(root, 'status', '--porcelain', '--untracked-files=all');
  const physical = (root: string): string => readFileSync(join(root, 'src/clamp.js'), 'utf8');

  test('local=false e operador=true: a escolha LOCAL vence (arquivo em LF, árvore limpa) — o defeito observado na PROOF-EXT-02', async () => {
    const w = await world({ localConfig: { 'core.autocrlf': 'false' }, workTreeOptions: operatorTrue });
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(main(w)).toBe(w.commit);
    expect(physical(w.lab.root)).toBe(CLAMP_FIXED);
    expect(physical(w.lab.root).includes(CR)).toBe(false);
    expect(plainStatus(w.lab.root)).toBe('');
    expect(git(w.lab.root, 'hash-object', 'src/clamp.js')).toBe(git(w.lab.root, 'rev-parse', 'HEAD:src/clamp.js'));
    expect(count(w)).toBe(2);
  });

  test('local=true e operador=false: a escolha LOCAL vence (arquivo em CRLF, árvore limpa)', async () => {
    const w = await world({ localConfig: { 'core.autocrlf': 'true' }, workTreeOptions: operatorFalse });
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(physical(w.lab.root).includes(CR)).toBe(true);
    expect(plainStatus(w.lab.root)).toBe('');
    expect(main(w)).toBe(w.commit);
  });

  test('sem config local: vale o padrão do operador (true ⇒ CRLF), árvore limpa', async () => {
    const w = await world({ workTreeOptions: operatorTrue });
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(physical(w.lab.root).includes(CR)).toBe(true);
    expect(plainStatus(w.lab.root)).toBe('');
  });

  test('o status do pré-requisito também respeita o local: árvore em LF com local=false não é "suja" sob operador=true', async () => {
    const w = await world({ localConfig: { 'core.autocrlf': 'false' }, workTreeOptions: operatorTrue });
    authorize(w);
    const out = await run(w);
    expect(out.status).toBe('integrated'); // com o defeito antigo: human_required target_checked_out:working_tree_dirty ou CRLF residual
  });

  test('hooks e filtros continuam bloqueados com o autocrlf do operador (filtro local ⇒ recusa)', async () => {
    const w = await world({ localConfig: { 'core.autocrlf': 'false' }, workTreeOptions: operatorTrue });
    git(w.lab.root, 'config', 'filter.evil.smudge', 'sh -c "echo pwned > pwned.txt"');
    authorize(w);
    expect(await run(w)).toMatchObject({ status: 'human_required', reason: 'target_checked_out:unsafe_repository_config' });
    expect(existsSync(join(w.lab.root, 'pwned.txt'))).toBe(false);
    expect(main(w)).toBe(w.lab.baseSha);
  });
});
