/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGateEnvironment, planIsolatedInvocation, resolveGateSandbox } from './gate-isolation';
import { runIsolated } from './worktree';

// Segredos FICTÍCIOS. Nenhum valor real é lido ou impresso.
const FAKE: Record<string, string> = {
  ANIMA_RESIDENT_PASSWORD: 'FAKE-resident-pw', ANIMA_SYSTEM_WRITER_PASSWORD: 'FAKE-writer-pw', SUPABASE_SERVICE_ROLE_KEY: 'FAKE-service-role',
  OPENAI_API_KEY: 'FAKE-openai', ANIMA_RUNPOD_API_KEY: 'FAKE-runpod', ANIMA_RUNPOD_SSH_PRIVATE_KEY: 'FAKE-ssh', GITHUB_TOKEN: 'FAKE-gh', CODEX_API_KEY: 'FAKE-codex',
};
const SAFE = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon', NODE_ENV: 'test' };

describe('buildGateEnvironment (puro)', () => {
  it('nenhum segredo do control plane atravessa; públicos e o mínimo do toolchain, sim', () => {
    const env = buildGateEnvironment({ ...SAFE, ...FAKE, NEXT_PUBLIC_SECRET_THING: 'x', NEXT_PUBLIC_TOKEN: 'y' });
    for (const k of Object.keys(FAKE)) expect(env[k]).toBeUndefined();
    expect(env.NEXT_PUBLIC_SECRET_THING).toBeUndefined(); expect(env.NEXT_PUBLIC_TOKEN).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('public-anon'); expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeDefined(); expect(env.PATH).toBeDefined(); expect(env.NODE_ENV).toBe('test');
    expect(JSON.stringify(env)).not.toContain('FAKE-');
  });
  it('overrides fixos (PATH da worktree) valem; nunca herda process.env por omissão', () => {
    const env = buildGateEnvironment({ PATH: 'a', ...FAKE }, { PATH: 'b' });
    expect(env.PATH).toBe('b'); expect(Object.keys(env).some(k => /PASSWORD|SERVICE_ROLE|API_KEY/.test(k))).toBe(false);
  });
});

describe('resolveGateSandbox / planIsolatedInvocation (puro)', () => {
  it('padrão off; modo desconhecido, não-Windows e caminho inválido ⇒ unavailable (falha fechada)', () => {
    expect(resolveGateSandbox({})).toEqual({ kind: 'off' });
    expect(resolveGateSandbox({ ANIMA_GATE_SANDBOX: 'docker' }, 'win32').kind).toBe('unavailable');
    expect(resolveGateSandbox({ ANIMA_GATE_SANDBOX: 'codex-windows', ANIMA_GATE_SANDBOX_CODEX_PATH: 'C:\\x\\codex.exe' }, 'linux').kind).toBe('unavailable');
    for (const p of [undefined, '', 'codex', 'C:\\x\\codex.cmd', '..\\codex.exe']) {
      expect(resolveGateSandbox({ ANIMA_GATE_SANDBOX: 'codex-windows', ...(p === undefined ? {} : { ANIMA_GATE_SANDBOX_CODEX_PATH: p }) }, 'win32').kind).toBe('unavailable');
    }
    expect(resolveGateSandbox({ ANIMA_GATE_SANDBOX: 'codex-windows', ANIMA_GATE_SANDBOX_CODEX_PATH: 'C:\\x\\codex.exe' }, 'win32')).toEqual({ kind: 'codex-windows', executable: 'C:\\x\\codex.exe' });
  });
  it('plano: sem sandbox mantém file/shell; com sandbox, Codex externo sem shell e cmd /c interno para batch', () => {
    const env = { PATH: 'p' };
    expect(planIsolatedInvocation({ file: 'npm', args: ['test'], cwd: 'C:\\w', shell: true }, { kind: 'off' }, env)).toEqual({ file: 'npm', args: ['test'], shell: true, env });
    const p = planIsolatedInvocation({ file: 'npm', args: ['run', 'test'], cwd: 'C:\\w', shell: true }, { kind: 'codex-windows', executable: 'C:\\c\\codex.exe' }, env);
    expect(p).toEqual({ file: 'C:\\c\\codex.exe', args: ['sandbox', '-P', ':workspace', '-C', 'C:\\w', '--', 'cmd', '/c', 'npm run test'], shell: false, env });
    expect(planIsolatedInvocation({ file: 'node', args: ['x.js'], cwd: 'C:\\w', shell: false }, { kind: 'codex-windows', executable: 'C:\\c\\codex.exe' }, env).args.slice(-2)).toEqual(['node', 'x.js']);
  });
});

const NODE = process.execPath;
const dump = `process.stdout.write(JSON.stringify(Object.keys(process.env).filter(k=>/PASSWORD|SERVICE_ROLE|API_KEY|PRIVATE_KEY|TOKEN/.test(k))))`;
const readIt = (p: string) => `try{process.stdout.write('READ:'+require('fs').readFileSync(${JSON.stringify(p)},'utf8'))}catch(e){process.stdout.write('DENIED:'+e.code)}`;
const writeIt = (p: string) => `try{require('fs').writeFileSync(${JSON.stringify(p)},'x');process.stdout.write('WROTE')}catch(e){process.stdout.write('DENIED:'+e.code)}`;
const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
  const saved: Record<string, string | undefined> = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

describe('runIsolated — ambiente (processo real, segredos fictícios)', () => {
  it('o filho NÃO enxerga segredos do Host', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'anima-gate-'));
    try {
      const r = await withEnv(FAKE, () => runIsolated(NODE, ['-e', dump], { cwd, timeoutMs: 30_000, shell: false }));
      expect(r.exitCode).toBe(0); expect(JSON.parse(r.stdout)).toEqual([]); expect(r.stdout + r.stderr).not.toContain('FAKE-');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  it('CONTROLE: só remover variáveis NÃO basta — sem sandbox o filho ainda lê o arquivo de segredo do mesmo usuário', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anima-gate-')); const secret = join(dir, 'fake.env'); writeFileSync(secret, 'ANIMA_FAKE=FAKE-file-secret');
    try {
      const r = await runIsolated(NODE, ['-e', readIt(secret)], { cwd: dir, timeoutMs: 30_000, shell: false });
      expect(r.stdout).toBe('READ:ANIMA_FAKE=FAKE-file-secret');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('sandbox configurado e indisponível ⇒ exitCode -3, nada executado', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'anima-gate-')); const marker = join(cwd, 'ran.txt');
    try {
      for (const vars of <Record<string, string>[]>[{ ANIMA_GATE_SANDBOX: 'codex-windows' }, { ANIMA_GATE_SANDBOX: 'codex-windows', ANIMA_GATE_SANDBOX_CODEX_PATH: 'Z:\\nao\\existe\\codex.exe' }, { ANIMA_GATE_SANDBOX: 'bogus' }]) {
        const r = await withEnv(vars, () => runIsolated(NODE, ['-e', writeIt(marker)], { cwd, timeoutMs: 30_000, shell: false }));
        expect(r.exitCode).toBeLessThan(0); expect(existsSync(marker)).toBe(false);
      }
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

// Prova de fronteira do SO com o sandbox REAL do Codex para Windows (usuário CodexSandboxOffline).
const SANDBOX_EXE = process.env.ANIMA_TEST_GATE_SANDBOX_CODEX_PATH ?? '';
const sandboxIt = process.platform === 'win32' && SANDBOX_EXE && existsSync(SANDBOX_EXE) ? it : it.skip;
describe('runIsolated — sandbox do SO (Codex Windows, :workspace)', () => {
  sandboxIt('negação de leitura para CodexSandboxUsers bloqueia o gate; o Host (mesmo usuário) continua lendo; escrita fora do workspace é negada', async () => {
    const work = mkdtempSync(join(tmpdir(), 'anima-gate-ws-')); const other = mkdtempSync(join(tmpdir(), 'anima-gate-other-'));
    const secret = join(other, 'fake.env'); writeFileSync(secret, 'ANIMA_FAKE=FAKE-file-secret');
    // %TEMP% é gravável por desenho no perfil :workspace; o 'fora do escopo' do teste fica no perfil do usuário.
    const outsideDir = mkdtempSync(join(homedir(), 'anima-gate-outside-')); const outside = join(outsideDir, 'planted.txt');
    try {
      execFileSync('icacls', [secret, '/deny', 'CodexSandboxUsers:(R)'], { stdio: 'ignore' });
      expect(readFileSync(secret, 'utf8')).toContain('FAKE-file-secret'); // Host lê
      await withEnv({ ...FAKE, ANIMA_GATE_SANDBOX: 'codex-windows', ANIMA_GATE_SANDBOX_CODEX_PATH: SANDBOX_EXE }, async () => {
        const env = await runIsolated(NODE, ['-e', dump], { cwd: work, timeoutMs: 120_000, shell: false });
        expect(env.exitCode).toBe(0); expect(JSON.parse(env.stdout)).toEqual([]); expect(env.stdout + env.stderr).not.toContain('FAKE-');
        const read = await runIsolated(NODE, ['-e', readIt(secret)], { cwd: work, timeoutMs: 120_000, shell: false });
        expect(read.stdout).toMatch(/^DENIED:(EPERM|EACCES)/); expect(read.stdout).not.toContain('FAKE-');
        const own = join(work, 'inside.txt');
        const inside = await runIsolated(NODE, ['-e', writeIt(own)], { cwd: work, timeoutMs: 120_000, shell: false });
        expect(inside.stdout).toBe('WROTE'); // o gate legítimo continua escrevendo no workspace
        const out = await runIsolated(NODE, ['-e', writeIt(outside)], { cwd: work, timeoutMs: 120_000, shell: false });
        expect(out.stdout).toMatch(/^DENIED:(EPERM|EACCES)/); expect(existsSync(outside)).toBe(false);
      });
    } finally { rmSync(work, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); rmSync(outsideDir, { recursive: true, force: true }); }
  }, 600_000);
  sandboxIt('sem a negação, o sandbox SOZINHO não esconde o arquivo (por isso o ACE é parte obrigatória do isolamento)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'anima-gate-ws-')); const other = mkdtempSync(join(tmpdir(), 'anima-gate-other-'));
    const secret = join(other, 'fake.env'); writeFileSync(secret, 'ANIMA_FAKE=FAKE-file-secret');
    try {
      await withEnv({ ANIMA_GATE_SANDBOX: 'codex-windows', ANIMA_GATE_SANDBOX_CODEX_PATH: SANDBOX_EXE }, async () => {
        const read = await runIsolated(NODE, ['-e', readIt(secret)], { cwd: work, timeoutMs: 120_000, shell: false });
        expect(read.stdout).toBe('READ:ANIMA_FAKE=FAKE-file-secret');
      });
    } finally { rmSync(work, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
  }, 300_000);
});
