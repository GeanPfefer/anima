/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExternalTarget } from '@anima/core';
import {
  captureExternalTargetSpec, defaultExternalTargetDeps, EXTERNAL_TARGET_ENV, inspectExternalTarget, parseExternalTargetConfig,
  verifyExternalTargetForContract, type ExternalTargetDeps,
} from './external-target-resolver';
import { readExecutionContract } from './executor-selection';

// Repositórios 100% descartáveis em tmpdir; nenhum toca o checkout do Anima.
jest.setTimeout(60_000);
const sandboxes: string[] = [];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
function makeRepo(name: string, commits = 2): { root: string; rootSha: string; headSha: string } {
  const base = mkdtempSync(join(tmpdir(), 't1-ext-'));
  sandboxes.push(base);
  mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q');
  for (let i = 0; i < commits; i++) { writeFileSync(join(root, `f${i}.txt`), String(i)); git(root, 'add', '.'); git(root, 'commit', '-q', '-m', `c${i}`); }
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), headSha: git(root, 'rev-parse', 'HEAD') };
}
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });

const envFor = (reference: string, repoRoot: string, rootCommitSha: string): Record<string, string | undefined> =>
  ({ [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference, repoRoot, rootCommitSha }) });
// "Anima" simulado: outro repositório descartável. Nunca o checkout real.
const depsWithAnima = (animaRoot: string): ExternalTargetDeps => ({ ...defaultExternalTargetDeps, animaRoot: () => animaRoot, isAnimaRoot: root => existsSync(join(root, '.git')) });
const contractFor = (specTarget: Record<string, unknown>, baseSha: string) =>
  readExecutionContract({ execution_spec: { executor: 'worktree', coder_backend: 'ollama', base_sha: baseSha, target: specTarget } });

describe('configuração do operador', () => {
  test.each([undefined, '', '   '])('ausente (%j) ⇒ nenhum target autorizado', raw => expect(parseExternalTargetConfig(raw)).toMatchObject({ ok: false, code: 'external_target_not_configured' }));
  test.each([
    'not-json', '[]', '{}',
    JSON.stringify({ reference: 'anima', repoRoot: '/x', rootCommitSha: 'a'.repeat(40) }),
    JSON.stringify({ reference: 'project:anima', repoRoot: '/x', rootCommitSha: 'a'.repeat(40) }),
    JSON.stringify({ reference: 'ext:x', repoRoot: 'relativo', rootCommitSha: 'a'.repeat(40) }),
    JSON.stringify({ reference: 'ext:x', repoRoot: '/x', rootCommitSha: 'abc' }),
    JSON.stringify({ reference: 'ext:x', repoRoot: '/x', rootCommitSha: 'a'.repeat(40), extra: 1 }),
  ])('config inválida %s', raw => expect(parseExternalTargetConfig(raw)).toMatchObject({ ok: false, code: 'external_target_config_invalid' }));
});

describe('resolução de um target externo válido', () => {
  test('captura a identidade canônica e o contrato a relê idêntica', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const captured = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { deps: depsWithAnima(anima.root) });
    expect(captured).toMatchObject({ ok: true });
    if (!captured.ok) return;
    expect(captured.target.identity).toEqual({
      repoRootCanonical: repo.root, gitCommonDirCanonical: realpathSync.native(join(repo.root, '.git')), rootCommitSha: repo.rootSha, baseSha: repo.headSha,
    });
    expect(readExternalTarget(captured.specTarget)).toEqual({ ok: true, target: captured.target });
    const verified = await verifyExternalTargetForContract(contractFor(captured.specTarget, repo.headSha), envFor('ext:shop', repo.root, repo.rootSha), depsWithAnima(anima.root));
    expect(verified).toMatchObject({ ok: true, reference: 'ext:shop', repoRoot: repo.root });
  });

  test('base_sha anterior ao HEAD (commit existente) também é válido; commits novos não invalidam a autorização', async () => {
    const repo = makeRepo('shop', 3); const anima = makeRepo('fake-anima');
    const older = git(repo.root, 'rev-parse', 'HEAD~1');
    const captured = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { baseSha: older, deps: depsWithAnima(anima.root) });
    expect(captured).toMatchObject({ ok: true });
    writeFileSync(join(repo.root, 'later.txt'), 'x'); git(repo.root, 'add', '.'); git(repo.root, 'commit', '-q', '-m', 'later');
    if (!captured.ok) return;
    expect(await verifyExternalTargetForContract(contractFor(captured.specTarget, older), envFor('ext:shop', repo.root, repo.rootSha), depsWithAnima(anima.root))).toMatchObject({ ok: true });
  });

  test('alias por link simbólico/junction resolve para a MESMA identidade canônica', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const aliasDir = mkdtempSync(join(tmpdir(), 't1-alias-')); sandboxes.push(aliasDir);
    const alias = join(aliasDir, 'alias');
    symlinkSync(repo.root, alias, 'junction');
    const viaAlias = await captureExternalTargetSpec(envFor('ext:shop', alias, repo.rootSha), { deps: depsWithAnima(anima.root) });
    const direct = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { deps: depsWithAnima(anima.root) });
    expect(viaAlias).toMatchObject({ ok: true });
    expect(viaAlias.ok && direct.ok && viaAlias.target).toEqual(direct.ok && direct.target);
    // autorizado pelo caminho direto, executado via alias ⇒ continua sendo o mesmo repositório
    if (!direct.ok) return;
    expect(await verifyExternalTargetForContract(contractFor(direct.specTarget, repo.headSha), envFor('ext:shop', alias, repo.rootSha), depsWithAnima(anima.root))).toMatchObject({ ok: true, repoRoot: repo.root });
  });
});

describe('recusas antes do claim', () => {
  test('referência desconhecida neste host', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const captured = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { deps: depsWithAnima(anima.root) });
    if (!captured.ok) throw new Error('setup');
    expect(await verifyExternalTargetForContract(contractFor(captured.specTarget, repo.headSha), envFor('ext:other', repo.root, repo.rootSha), depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_unknown' });
    expect(await verifyExternalTargetForContract(contractFor(captured.specTarget, repo.headSha), {}, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_not_configured' });
  });

  test('contrato sem identidade, ou com referência anima, nunca vira externo', async () => {
    const anima = makeRepo('fake-anima');
    for (const target of [{ kind: 'project', reference: 'ext:shop' }, { kind: 'project', reference: 'anima', identity: {} }]) {
      const contract = readExecutionContract({ execution_spec: { executor: 'worktree', base_sha: 'a'.repeat(40), target } });
      expect(await verifyExternalTargetForContract(contract, envFor('ext:shop', anima.root, anima.rootSha), depsWithAnima(anima.root))).toMatchObject({ ok: false });
    }
  });

  test('target externo disfarçado de Anima (mesmo repo, aninhado em qualquer direção, ou mesmo .git)', async () => {
    const anima = makeRepo('fake-anima');
    expect(await captureExternalTargetSpec(envFor('ext:disguise', anima.root, anima.rootSha), { deps: depsWithAnima(anima.root) })).toMatchObject({ ok: false, code: 'external_target_is_anima' });
    const nested = join(anima.root, 'sub'); mkdirSync(nested); git(nested, 'init', '-q'); writeFileSync(join(nested, 'a'), '1'); git(nested, 'add', '.'); git(nested, 'commit', '-q', '-m', 'n');
    const nestedRoot = git(nested, 'rev-list', '--max-parents=0', 'HEAD');
    expect(await captureExternalTargetSpec(envFor('ext:nested', nested, nestedRoot), { deps: depsWithAnima(anima.root) })).toMatchObject({ ok: false, code: 'external_target_is_anima' });
    const outer = makeRepo('outer');
    const inner = join(outer.root, 'inner-anima'); mkdirSync(inner); git(inner, 'init', '-q');
    expect(await captureExternalTargetSpec(envFor('ext:outer', outer.root, outer.rootSha), { deps: depsWithAnima(inner) })).toMatchObject({ ok: false, code: 'external_target_is_anima' });
    const viaAlias = mkdtempSync(join(tmpdir(), 't1-alias-')); sandboxes.push(viaAlias);
    symlinkSync(anima.root, join(viaAlias, 'a'), 'junction');
    expect(await captureExternalTargetSpec(envFor('ext:alias', join(viaAlias, 'a'), anima.rootSha), { deps: depsWithAnima(anima.root) })).toMatchObject({ ok: false, code: 'external_target_is_anima' });
  });

  test('remapeamento após a autorização: outro repositório sob o mesmo nome, ou o mesmo histórico em outro caminho', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const captured = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { deps: depsWithAnima(anima.root) });
    if (!captured.ok) throw new Error('setup');
    const contract = contractFor(captured.specTarget, repo.headSha);
    const stranger = makeRepo('shop-stranger');
    // 1) operador (ou atacante) aponta a referência para outro repo, mantendo o pin do original
    expect(await verifyExternalTargetForContract(contract, envFor('ext:shop', stranger.root, repo.rootSha), depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_base_sha_invalid' });
    // 2) com pin do repo estranho: a raiz da história diverge da autorizada
    const strangerCapture = await verifyExternalTargetForContract(contract, envFor('ext:shop', stranger.root, stranger.rootSha), depsWithAnima(anima.root));
    expect(strangerCapture.ok).toBe(false);
    // 3) mesmo histórico (clone) em outro caminho ⇒ identidade física mudou
    const cloneBase = mkdtempSync(join(tmpdir(), 't1-clone-')); sandboxes.push(cloneBase);
    const clone = join(cloneBase, 'shop-clone');
    execFileSync('git', ['clone', '-q', repo.root, clone], { windowsHide: true });
    expect(await verifyExternalTargetForContract(contract, envFor('ext:shop', realpathSync.native(clone), repo.rootSha), depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_identity_changed', message: expect.stringContaining('repo_root_changed') });
  });

  test('base_sha do contrato divergente da identidade autorizada', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const captured = await captureExternalTargetSpec(envFor('ext:shop', repo.root, repo.rootSha), { deps: depsWithAnima(anima.root) });
    if (!captured.ok) throw new Error('setup');
    expect(await verifyExternalTargetForContract(contractFor(captured.specTarget, repo.rootSha), envFor('ext:shop', repo.root, repo.rootSha), depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_identity_changed' });
  });

  test('.git redirecionado (arquivo gitdir:) e worktree vinculado são recusados', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const redirectBase = mkdtempSync(join(tmpdir(), 't1-redirect-')); sandboxes.push(redirectBase);
    const redirectRoot = realpathSync.native(redirectBase);
    writeFileSync(join(redirectRoot, '.git'), `gitdir: ${join(repo.root, '.git')}\n`);
    expect(await inspectExternalTarget({ reference: 'ext:r', repoRoot: redirectRoot, rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_git_invalid', message: expect.stringContaining('redirect') });
    const wt = join(redirectRoot, 'linked');
    git(repo.root, 'worktree', 'add', '-q', '-b', 'side', wt);
    expect(await inspectExternalTarget({ reference: 'ext:w', repoRoot: realpathSync.native(wt), rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_git_invalid' });
  });

  test('objetos alternativos (alternates) e .git inexistente são recusados', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    mkdirSync(join(repo.root, '.git', 'objects', 'info'), { recursive: true });
    writeFileSync(join(repo.root, '.git', 'objects', 'info', 'alternates'), `${anima.root}\n`);
    expect(await inspectExternalTarget({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_git_invalid', message: expect.stringContaining('alternates') });
    const empty = mkdtempSync(join(tmpdir(), 't1-empty-')); sandboxes.push(empty);
    expect(await inspectExternalTarget({ reference: 'ext:e', repoRoot: realpathSync.native(empty), rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_git_invalid' });
    expect(await inspectExternalTarget({ reference: 'ext:m', repoRoot: join(empty, 'nao-existe'), rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_root_unreadable' });
  });

  test.each([
    ['inexistente', 'f'.repeat(40)],
    ['curto', 'abc1234'],
    ['injeção de opção', '--all'],
    ['maiúsculo', 'A'.repeat(40)],
  ])('SHA-base %s é recusado', async (_name, sha) => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    expect(await inspectExternalTarget({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: repo.rootSha }, sha, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_base_sha_invalid' });
  });

  test('SHA que existe mas não é commit (blob/tree) é recusado', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const tree = git(repo.root, 'rev-parse', 'HEAD^{tree}');
    expect(await inspectExternalTarget({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: repo.rootSha }, tree, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_base_sha_invalid' });
  });

  test('história com mais de um commit raiz é ambígua e recusada', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const main = git(repo.root, 'branch', '--show-current');
    git(repo.root, 'checkout', '-q', '--orphan', 'other'); git(repo.root, 'rm', '-rfq', '.');
    writeFileSync(join(repo.root, 'o.txt'), 'o'); git(repo.root, 'add', '.'); git(repo.root, 'commit', '-q', '-m', 'orphan');
    git(repo.root, 'checkout', '-q', main); git(repo.root, 'merge', '-q', '--allow-unrelated-histories', '-m', 'merge', 'other');
    expect(await inspectExternalTarget({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: repo.rootSha }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_root_commit_ambiguous' });
  });

  test('pin de commit raiz do operador divergente', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    expect(await inspectExternalTarget({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: 'e'.repeat(40) }, null, depsWithAnima(anima.root)))
      .toMatchObject({ ok: false, code: 'external_target_root_commit_mismatch' });
  });
});

describe('raiz do Anima comprovada (T1-R2 P2-2): nunca falha aberta', () => {
  const targetCfg = (repo: { root: string; rootSha: string }) => ({ reference: 'ext:shop', repoRoot: repo.root, rootCommitSha: repo.rootSha });
  const REFUSAL = { ok: false, code: 'external_target_anima_root_unknown' };

  test('raiz do Anima inexistente, inválida, ilegível ou que lança ⇒ recusa explícita', async () => {
    const repo = makeRepo('shop'); const gone = join(repo.root, '..', 'nao-existe');
    const noMarkers = mkdtempSync(join(tmpdir(), 't1-nomark-')); sandboxes.push(noMarkers);
    const real = makeRepo('fake-anima');
    const cases: ExternalTargetDeps[] = [
      { ...defaultExternalTargetDeps, animaRoot: () => gone, isAnimaRoot: () => true },                                          // ausente
      { ...defaultExternalTargetDeps, animaRoot: () => noMarkers },                                                              // sem marcadores do monorepo (prova padrão)
      { ...defaultExternalTargetDeps, animaRoot: () => real.root, isAnimaRoot: () => true,
        realpath: path => { if (path.startsWith(real.root)) throw new Error('EACCES'); return realpathSync.native(path); } },    // ilegível
      { ...defaultExternalTargetDeps, animaRoot: () => { throw new Error('boom'); } },                                           // projectRoot lança
      { ...defaultExternalTargetDeps, animaRoot: () => real.root, isAnimaRoot: () => true,
        realpath: path => { if (path.endsWith('.git') && path.startsWith(real.root)) throw new Error('ENOENT'); return realpathSync.native(path); } }, // .git do Anima ilegível
    ];
    for (const deps of cases) expect(await inspectExternalTarget(targetCfg(repo), null, deps)).toMatchObject(REFUSAL);
  });

  test('cwd arbitrário NÃO é prova de identidade do Anima (projectRoot cai no cwd)', async () => {
    const repo = makeRepo('shop');
    const arbitrary = mkdtempSync(join(tmpdir(), 't1-cwd-')); sandboxes.push(arbitrary);
    const deps: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => arbitrary }; // isAnimaRoot padrão = marcadores reais do monorepo
    expect(await inspectExternalTarget(targetCfg(repo), null, deps)).toMatchObject(REFUSAL);
  });

  test('com a prova PADRÃO (marcadores do monorepo), alvo direto e via junction para o Anima são recusados como is_anima', async () => {
    const anima = makeRepo('fake-anima');
    mkdirSync(join(anima.root, 'apps', 'web'), { recursive: true });
    writeFileSync(join(anima.root, 'package.json'), '{}'); writeFileSync(join(anima.root, 'apps', 'web', 'package.json'), '{}');
    const deps: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => anima.root };
    expect(await inspectExternalTarget(targetCfg(anima), null, deps)).toMatchObject({ ok: false, code: 'external_target_is_anima' });
    const via = mkdtempSync(join(tmpdir(), 't1-junc-')); sandboxes.push(via);
    symlinkSync(anima.root, join(via, 'alias'), 'junction');
    expect(await inspectExternalTarget({ ...targetCfg(anima), repoRoot: join(via, 'alias') }, null, deps)).toMatchObject({ ok: false, code: 'external_target_is_anima' });
    // e um repositório legítimo e distinto continua passando com a mesma prova
    const shop = makeRepo('shop');
    expect(await inspectExternalTarget(targetCfg(shop), null, deps)).toMatchObject({ ok: true });
  });

  test('a verificação pré-claim (verifyExternalTargetForContract) também falha fechada sem a raiz do Anima', async () => {
    const repo = makeRepo('shop'); const anima = makeRepo('fake-anima');
    const env = envFor('ext:shop', repo.root, repo.rootSha);
    const captured = await captureExternalTargetSpec(env, { deps: depsWithAnima(anima.root) });
    if (!captured.ok) throw new Error('setup');
    const broken: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => join(repo.root, '..', 'nao-existe'), isAnimaRoot: () => true };
    expect(await verifyExternalTargetForContract(contractFor(captured.specTarget, repo.headSha), env, broken)).toMatchObject(REFUSAL);
  });
});
