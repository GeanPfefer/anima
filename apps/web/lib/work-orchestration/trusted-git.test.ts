/** @jest-environment node */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectCandidateIntegrity } from './acceptance-mandate';
import { cleanEnv, createRepo, git, SCOPE, tempDir } from './git-fixture.test-helper';
import { createTrustedGitRunner, resolveTrustedRepository, scrubbedGitEnvironment } from './trusted-git';

const hostile = (decoy: string): NodeJS.ProcessEnv => ({
  ...cleanEnv(), GIT_DIR: join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: join(decoy, 'idx'), GIT_OBJECT_DIRECTORY: join(decoy, '.git', 'objects'),
  GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy, '.git', 'objects'), GIT_REPLACE_REF_BASE: 'refs/evil/', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor',
  GIT_CONFIG_VALUE_0: 'echo pwned', GIT_NAMESPACE: 'evil', GIT_COMMON_DIR: join(decoy, '.git'), GIT_SHALLOW_FILE: join(decoy, 'shallow'),
  ANIMA_SYSTEM_WRITER_PASSWORD: 'segredo-de-teste', ANIMA_RESIDENT_PASSWORD: 'outro-segredo',
});

describe('scrubbedGitEnvironment', () => {
  test('descarta TODA variável GIT_* do pai, não repassa segredos e fixa o endurecimento', () => {
    const { env, dropped } = scrubbedGitEnvironment(hostile('C:/x'));
    expect(dropped).toEqual(expect.arrayContaining(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_REPLACE_REF_BASE', 'GIT_CONFIG_COUNT', 'GIT_NAMESPACE', 'GIT_COMMON_DIR', 'GIT_SHALLOW_FILE']));
    expect(env.GIT_DIR).toBeUndefined(); expect(env.GIT_WORK_TREE).toBeUndefined(); expect(env.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined(); expect(env.GIT_CONFIG_KEY_0).toBeUndefined(); expect(env.GIT_REPLACE_REF_BASE).toBeUndefined();
    expect(env).toMatchObject({ GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
    expect(JSON.stringify(env)).not.toMatch(/segredo/);
    expect(Object.keys(env).some(k => /PASSWORD/.test(k))).toBe(false);
  });
});

describe('resolveTrustedRepository', () => {
  test('exige caminho absoluto, diretório .git real e recusa .git redirecionador', () => {
    const repo = createRepo();
    expect(resolveTrustedRepository(repo.root)).toEqual({ ok: true, gitDir: join(repo.root, '.git') });
    expect(resolveTrustedRepository(undefined)).toEqual({ ok: false, reason: 'trusted_repo_must_be_absolute' });
    expect(resolveTrustedRepository('relativo/repo')).toEqual({ ok: false, reason: 'trusted_repo_must_be_absolute' });
    expect(resolveTrustedRepository(tempDir('anima-vazio'))).toEqual({ ok: false, reason: 'trusted_repo_not_found' });
    const redirect = tempDir('anima-redirect'); writeFileSync(join(redirect, '.git'), `gitdir: ${join(repo.root, '.git')}\n`);
    expect(resolveTrustedRepository(redirect)).toEqual({ ok: false, reason: 'trusted_repo_git_is_a_redirect_file' });
  });
});

describe('createTrustedGitRunner (Git real, ambiente hostil)', () => {
  const real = createRepo();
  const decoy = createRepo({ [SCOPE[1]]: 'export const decoy = 1\n' });
  const gitDir = join(real.root, '.git');

  test('inspeciona o repositório CONFIÁVEL mesmo com GIT_DIR/OBJECT_DIRECTORY/ALTERNATES/REPLACE apontando para outro', async () => {
    const run = createTrustedGitRunner({ gitDir, parentEnv: hostile(decoy.root) });
    expect(await run(['cat-file', '-t', real.commit])).toEqual({ exitCode: 0, stdout: 'commit\n' });
    expect((await run(['cat-file', '-t', decoy.commit])).exitCode).not.toBe(0);
    const report = await collectCandidateIntegrity(run, { baseSha: real.base, commitSha: real.commit });
    expect(report).toMatchObject({ ok: true, value: { commitSha: real.commit, baseSha: real.base, parentShas: [real.base], commitCount: 1, mergeCount: 0, baseIsAncestor: true, changedFiles: [...SCOPE] } });
  });

  test('refs/replace do runner NÃO reescreve o candidato (nem os pais)', async () => {
    const repo = createRepo();
    const other = git(repo.root, 'commit-tree', `${repo.commit}^{tree}`, '-m', 'impostor'); // sem pai
    git(repo.root, 'replace', repo.commit, other);
    expect(git(repo.root, 'rev-list', '--parents', '-n', '1', repo.commit).split(' ')).toHaveLength(1); // Git comum, com replace, enxerga um commit sem pai
    const run = createTrustedGitRunner({ gitDir: join(repo.root, '.git'), parentEnv: cleanEnv() });
    const report = await collectCandidateIntegrity(run, { baseSha: repo.base, commitSha: repo.commit });
    expect(report).toMatchObject({ ok: true, value: { parentShas: [repo.base], commitCount: 1 } });
  });

  test('config hostil no repositório (fsmonitor/hooksPath/diff.external) não executa código', async () => {
    const repo = createRepo();
    const marker = join(repo.root, 'PWNED.txt'); const script = join(repo.root, 'evil.sh');
    const posix = (p: string): string => p.split('\\').join('/');
    writeFileSync(script, `#!/bin/sh\necho x > "${posix(marker)}"\n`);
    appendFileSync(join(repo.root, '.git', 'config'), `[core]\n\tfsmonitor = sh ${posix(script)}\n\thooksPath = ${posix(join(repo.root, 'hooks'))}\n[diff]\n\texternal = sh ${posix(script)}\n`);
    mkdirSync(join(repo.root, 'hooks'), { recursive: true });
    const run = createTrustedGitRunner({ gitDir: join(repo.root, '.git'), parentEnv: cleanEnv() });
    const report = await collectCandidateIntegrity(run, { baseSha: repo.base, commitSha: repo.commit });
    expect(report.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  test('shallow forjado pelo runner (poda o pai) é detectado e recusado', async () => {
    const repo = createRepo();
    writeFileSync(join(repo.root, '.git', 'shallow'), `${repo.commit}\n`);
    const run = createTrustedGitRunner({ gitDir: join(repo.root, '.git'), parentEnv: cleanEnv() });
    const report = await collectCandidateIntegrity(run, { baseSha: repo.base, commitSha: repo.commit });
    expect(report.ok).toBe(false);
  });

  test('candidato com link simbólico no escopo é recusado pelo modo do arquivo (Git real)', async () => {
    const repo = createRepo({ [SCOPE[1]]: 'export const a = 1\n' });
    const blobFile = join(repo.root, '.blob.tmp'); writeFileSync(blobFile, 'alvo-fora');
    const blob = git(repo.root, 'hash-object', '-w', blobFile);
    git(repo.root, 'update-index', '--add', '--cacheinfo', `120000,${blob},${SCOPE[0]}`);
    git(repo.root, 'commit', '-q', '-m', 'symlink', '--amend');
    const commit = git(repo.root, 'rev-parse', 'HEAD');
    const run = createTrustedGitRunner({ gitDir: join(repo.root, '.git'), parentEnv: cleanEnv() });
    expect(await collectCandidateIntegrity(run, { baseSha: repo.base, commitSha: commit })).toEqual({ ok: false, message: 'git_unusual_file_mode' });
  });

  test('falha do processo ou timeout vira exitCode -1 (nunca lança)', async () => {
    const run = createTrustedGitRunner({ gitDir, parentEnv: cleanEnv(), run: async () => { throw new Error('boom'); } });
    expect(await run(['cat-file', '-t', real.commit])).toEqual({ exitCode: -1, stdout: '' });
    const timedOut = createTrustedGitRunner({ gitDir, parentEnv: cleanEnv(), run: async () => ({ command: 'git', exitCode: 0, stdout: 'commit\n', stderr: '', durationMs: 1, timedOut: true, cancelled: false }) });
    expect(await timedOut(['cat-file', '-t', real.commit])).toEqual({ exitCode: -1, stdout: '' });
  });
});
