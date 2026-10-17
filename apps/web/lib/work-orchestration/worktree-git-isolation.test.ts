/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktree } from './worktree';

// Prova adversarial do GIT DO HOST sobre uma worktree cujo conteúdo (incluindo o arquivo `.git`) é controlado pelo candidato.
// Segredos FICTÍCIOS; repositórios descartáveis; nenhum repositório real é tocado.
const FAKE: Record<string, string> = { ANIMA_RESIDENT_PASSWORD: 'FAKE-resident-pw', SUPABASE_SERVICE_ROLE_KEY: 'FAKE-service-role', ANIMA_SYSTEM_WRITER_PASSWORD: 'FAKE-writer-pw' };
const fwd = (p: string): string => p.replace(/\\/g, '/');
const CLEAN = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: tmpdir(), USERPROFILE: tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, env: CLEAN as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
  const saved: Record<string, string | undefined> = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

interface Rig { readonly main: string; readonly sha: string; readonly work: GitWorktree; readonly marker: string; readonly evil: string; readonly dir: string }

async function rig(): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), 'anima-gitiso-'));
  const main = join(dir, 'main'); mkdirSync(main);
  sh(main, ['init', '-q', '-b', 'main']); sh(main, ['config', 'user.name', 't']); sh(main, ['config', 'user.email', 't@t']);
  writeFileSync(join(main, 'a.txt'), 'base\n'); sh(main, ['add', '-A']); sh(main, ['commit', '-q', '-m', 'base']);
  const sha = sh(main, ['rev-parse', 'HEAD']).trim();
  const work = await GitWorktree.create({ repoRoot: main, sha, branch: `anima-iso-${Date.now()}` });
  const marker = join(dir, 'marker.txt');
  // Código "do candidato": um repositório próprio (clone) com config/hooks hostis, e o `.git` da worktree redirecionado para ele.
  const evil = join(dir, 'evil.git'); sh(dir, ['clone', '-q', '--bare', main, evil]);
  const js = join(dir, 'marker.js');
  writeFileSync(js, `require('fs').appendFileSync(${JSON.stringify(marker)}, JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(ANIMA_RESIDENT_PASSWORD|SUPABASE_SERVICE_ROLE_KEY|ANIMA_SYSTEM_WRITER_PASSWORD)$/.test(k)).map(([k]) => [k, 'seen'])))+'\\n')`);
  const script = join(dir, 'marker.sh'); writeFileSync(script, `#!/bin/sh\n"${fwd(process.execPath)}" "${fwd(js)}"\n`);
  mkdirSync(join(evil, 'hooks'), { recursive: true }); writeFileSync(join(evil, 'hooks', 'pre-commit'), `#!/bin/sh\nsh "${fwd(script)}"\n`);
  sh(evil, ['config', 'core.bare', 'false']); sh(evil, ['config', 'core.fsmonitor', `sh ${fwd(script)}`]);
  return { main, sha, work, marker, evil, dir };
}
// `.git` é arquivo oculto no Windows: o candidato apaga e recria (ou `attrib -h`); nada exige privilégio.
const tamper = (r: Rig): void => { const f = join(r.work.root, '.git'); rmSync(f, { force: true }); writeFileSync(f, `gitdir: ${fwd(r.evil)}\n`); };
const leaked = (r: Rig): string => (existsSync(r.marker) ? readFileSync(r.marker, 'utf8') : '');

describe('Git do Host sobre worktree controlada pelo candidato', () => {
  it('CONTROLE: sem adulteração, o fluxo normal funciona (commit/diff/grep/ls-files)', async () => {
    const r = await rig();
    try {
      await r.work.writeWorkspaceFile('b.txt', 'novo\n');
      const commit = await r.work.commit('candidate');
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
      expect((await r.work.changedFiles()).length).toBeGreaterThanOrEqual(0);
      expect((await r.work.listFiles({ pattern: '*.txt', maxResults: 10 })).paths.sort()).toEqual(['a.txt', 'b.txt']);
      expect((await r.work.searchText({ query: 'novo', maxResults: 5, isRegex: false })).matches).toHaveLength(1);
      expect(leaked(r)).toBe('');
    } finally { await r.work.dispose({ deleteBranch: true }).catch(() => {}); rmSync(r.dir, { recursive: true, force: true }); }
  }, 120_000);

  it('ADVERSARIAL: `.git` redirecionado + hook/fsmonitor hostis NÃO executam com credenciais do Host (commit, stage, diff, grep, ls-files)', async () => {
    const r = await rig();
    try {
      await r.work.writeWorkspaceFile('b.txt', 'novo\n');
      tamper(r);
      await withEnv(FAKE, async () => {
        await r.work.commit('candidate').catch(() => null);
        await r.work.stageAll().catch(() => null);
        await r.work.diff().catch(() => '');
        await r.work.searchText({ query: 'novo', maxResults: 5, isRegex: false }).catch(() => null);
        await r.work.listFiles({ pattern: '*', maxResults: 5 }).catch(() => null);
      });
      // O marcador registra só NOMES (nunca valores): qualquer linha = código do candidato rodou com o ambiente do Host.
      expect(leaked(r).split('\n').filter(Boolean).length).toBe(0);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  }, 180_000);

  it('falha FECHADA: sem diretório administrativo confiável registrado, nada roda e o `.git` hostil nunca é consultado', async () => {
    const r = await rig();
    try {
      await r.work.writeWorkspaceFile('b.txt', 'novo\n');
      rmSync(join(r.main, '.git', 'worktrees'), { recursive: true, force: true }); // registro do repositório principal ausente
      tamper(r);
      await withEnv(FAKE, async () => {
        expect(await r.work.commit('candidate').catch(() => null)).toBeNull();
        expect((await r.work.listFiles({ pattern: '*', maxResults: 5 }).catch(() => ({ paths: [] as string[] }))).paths).toEqual([]);
      });
      expect(leaked(r).split('\n').filter(Boolean).length).toBe(0);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  }, 120_000);

  it('o commit do candidato continua indo para a branch da worktree (não para o repositório hostil)', async () => {
    const r = await rig();
    try {
      await r.work.writeWorkspaceFile('c.txt', 'c\n');
      tamper(r);
      const sha = await r.work.commit('candidate');
      if (sha !== null) expect(sh(r.main, ['cat-file', '-t', sha]).trim()).toBe('commit');
      expect(sh(r.evil, ['rev-list', '--all', '--count']).trim()).toBe('1'); // hostil intacto: nada foi escrito nele
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  }, 120_000);
});
