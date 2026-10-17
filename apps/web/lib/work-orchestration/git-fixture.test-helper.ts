import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Repositórios Git REAIS e descartáveis para os testes da conferência de integridade (nunca toca o repositório do projeto).
export const cleanEnv = (): NodeJS.ProcessEnv => {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) env[k] = v;
  return env;
};

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    { cwd, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), `${prefix}-`));

export interface FixtureRepo { readonly root: string; readonly base: string; readonly commit: string }
export const SCOPE = ['packages/core/src/a.test.ts', 'packages/core/src/a.ts'] as const;

export const writeFiles = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
};

/** Base com 2 arquivos e um commit candidato (filho único) que adiciona `candidateFiles` (por padrão exatamente `SCOPE`). */
export function createRepo(candidateFiles: Readonly<Record<string, string>> = { [SCOPE[0]]: 'test("a",()=>{})\n', [SCOPE[1]]: 'export const a = 1\n' }): FixtureRepo {
  const root = tempDir('anima-git');
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, { 'README.md': 'base\n', 'packages/core/src/other.ts': 'export const o = 1\n' });
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', 'anima-work/att');
  writeFiles(root, candidateFiles);
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'candidate');
  return { root, base, commit: git(root, 'rev-parse', 'HEAD') };
}
