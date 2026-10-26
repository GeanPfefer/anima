/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseCodexExecutor } from './codex-executor-diagnostics';
import { resolveCodexCliConfig } from './codex-cli-coder';
import type { ExecutorObservation } from './executor-discovery';
import { probeExecutorReadiness, type ExecutorReadinessDeps, type ReadinessProcessResult } from './executor-readiness';
import { classifyWslProbeFailure } from './investigation-wsl-transport';
import { singleItemCodexRefusal } from './single-item-codex-readiness';

// V1-04 — prontidão operacional e diagnóstico do Codex via WSL. Tudo por doubles (nenhum processo real, nenhum WSL, nenhuma attempt).
const SECRET = 'sk-super-secret-token';
const WSL_EXE = String.raw`C:\Windows\System32\wsl.exe`;
const WSL_ENV = {
  PATH: '/usr/bin', SystemRoot: String.raw`C:\Windows`, OPENAI_API_KEY: SECRET, CODEX_API_KEY: SECRET,
  ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco',
  ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex',
};
const READY: ExecutorObservation = { provider: 'codex-cli', availability: 'ready', reasonUnavailable: null };

type Handler = (file: string, args: readonly string[]) => Partial<ReadinessProcessResult>;
function makeDeps(over: { env?: Record<string, string | undefined>; platform?: string; handler?: Handler; fileExists?: (p: string) => boolean } = {}): ExecutorReadinessDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls, platform: over.platform ?? 'win32', env: over.env ?? WSL_ENV, cwd: 'G:/anima', fileExists: over.fileExists ?? (() => true), httpGet: jest.fn(),
    run: async (file, args) => { calls.push([file, ...args]); return { exitCode: 0, stdout: 'codex-cli 0.162.0', stderr: '', timedOut: false, ...(over.handler?.(file, args) ?? {}) }; },
  };
}
const nul = (text: string): string => text.split('').join(String.fromCharCode(0)); // wsl.exe escreve em UTF-16

describe('diagnóstico: transporte WSL', () => {
  test('configuração válida: transporte, distro, usuário, binário, versão e perfil compatível — com UM --version e nada além', async () => {
    const deps = makeDeps();
    const d = await diagnoseCodexExecutor(deps, READY);
    expect(d).toEqual({ transport: 'wsl', configSource: 'ANIMA_CODEX_CLI_TRANSPORT', distro: 'Ubuntu-24.04', user: 'geanteco', binary: WSL_ENV.ANIMA_CODEX_WSL_CLI_PATH,
      version: 'codex-cli 0.162.0', profileCompatible: true, availability: 'ready', reason: null, cause: null, hint: null });
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]![0]).toBe(WSL_EXE);
    expect(deps.calls[0]!.at(-1)).toBe('--version');
    for (const call of deps.calls) { expect(call).not.toContain('login'); expect(call).not.toContain('exec'); expect(call).not.toContain('-c'); }
  });

  test('versão fora da linha 0.162.x: informa incompatibilidade com o perfil Single-Item', async () => {
    const d = await diagnoseCodexExecutor(makeDeps({ handler: () => ({ stdout: 'codex-cli 0.161.0' }) }), READY);
    expect(d).toMatchObject({ version: 'codex-cli 0.161.0', profileCompatible: false, cause: null });
    expect(d.hint).toContain('0.162.x');
  });

  test('transporte legado (ANIMA_INVESTIGATION_CODEX_TRANSPORT) é reconhecido; o novo tem precedência quando ambos existem', async () => {
    const { ANIMA_CODEX_CLI_TRANSPORT: _drop, ...rest } = WSL_ENV;
    const legacy = await diagnoseCodexExecutor(makeDeps({ env: { ...rest, ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'wsl' } }), READY);
    expect(legacy).toMatchObject({ transport: 'wsl', configSource: 'ANIMA_INVESTIGATION_CODEX_TRANSPORT', distro: 'Ubuntu-24.04' });
    const both = await diagnoseCodexExecutor(makeDeps({ env: { ...WSL_ENV, ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'wsl' } }), READY);
    expect(both.configSource).toBe('ANIMA_CODEX_CLI_TRANSPORT');
  });

  test.each([
    ['distro ausente', { ANIMA_CODEX_WSL_DISTRO: '' }, 'ANIMA_CODEX_WSL_DISTRO'],
    ['usuário inválido', { ANIMA_CODEX_WSL_USER: 'Gean Teco' }, 'ANIMA_CODEX_WSL_USER'],
    ['caminho do binário relativo', { ANIMA_CODEX_WSL_CLI_PATH: 'codex' }, 'ANIMA_CODEX_WSL_CLI_PATH'],
    ['caminho do binário com ..', { ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/../root/codex' }, 'ANIMA_CODEX_WSL_CLI_PATH'],
    ['ANIMA_CODEX_CLI_PATH coexistindo com o transporte WSL (conflito)', { ANIMA_CODEX_CLI_PATH: String.raw`C:\tools\codex.exe` }, 'ANIMA_CODEX_CLI_PATH'],
    ['transporte desconhecido', { ANIMA_CODEX_CLI_TRANSPORT: 'ssh' }, 'ANIMA_INVESTIGATION_CODEX_TRANSPORT'],
  ])('configuração inválida (%s) falha fechada: nomeia a variável e NÃO lança processo', async (_n, change, variable) => {
    const deps = makeDeps({ env: { ...WSL_ENV, ...change } });
    const d = await diagnoseCodexExecutor(deps, { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'codex_transport_invalid' });
    expect(d).toMatchObject({ transport: 'invalid', cause: 'codex_transport_invalid', version: null });
    expect(d.hint).toContain(variable);
    expect(deps.calls).toHaveLength(0);
  });

  test('WSL não instalado (wsl.exe ausente): causa específica sem lançar processo', async () => {
    const deps = makeDeps({ fileExists: p => p !== WSL_EXE });
    const d = await diagnoseCodexExecutor(deps, { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'wsl_version_check_failed' });
    expect(d).toMatchObject({ transport: 'wsl', cause: 'wsl_not_installed', version: null });
    expect(deps.calls).toHaveLength(0);
  });

  test.each([
    ['launcher não pôde ser lançado (processo não nasceu: sem saída nenhuma)', { exitCode: -1, stdout: '', stderr: '' }, 'wsl_launcher_unavailable'],
    ['sondagem expirou', { exitCode: -1, timedOut: true }, 'wsl_version_probe_timeout'],
    ['distribuição inexistente (UTF-16, inglês)', { exitCode: 1, stderr: nul('There is no distribution with the supplied name.') }, 'wsl_distro_not_found'],
    ['distribuição inexistente (português)', { exitCode: 1, stderr: nul('Não existe nenhuma distribuição com o nome fornecido.') }, 'wsl_distro_not_found'],
    ['usuário inexistente', { exitCode: 1, stderr: 'The user "geanteco" does not exist.' }, 'wsl_user_not_found'],
    // Saídas REAIS do wsl.exe medidas nesta máquina: mensagem em STDOUT, UTF-16 (NUL intercalado), localizada, exit code -1.
    ['distribuição inexistente (saída real do wsl.exe: stdout UTF-16, exit -1)', { exitCode: -1, stdout: nul('Não há distribuição com o nome fornecido. Código de erro: Wsl/Service/WSL_E_DISTRO_NOT_FOUND') }, 'wsl_distro_not_found'],
    ['usuário inexistente (saída real do wsl.exe: stdout UTF-16, exit -1)', { exitCode: -1, stdout: nul('Usuário não encontrado. Código de erro: Wsl/WSL_E_USER_NOT_FOUND'), stderr: '<3>WSL (612 - Relay) ERROR: getpwnam(naoexiste) failed 0' }, 'wsl_user_not_found'],
    ['só o código de erro, sem texto localizado', { exitCode: 4294967295, stdout: nul('WSL_E_DISTRO_NOT_FOUND') }, 'wsl_distro_not_found'],
    ['binário inexistente (exit 127)', { exitCode: 127, stderr: '' }, 'codex_binary_not_found'],
    ['binário inexistente (env)', { exitCode: 1, stderr: "env: '/home/geanteco/x/codex': No such file or directory" }, 'codex_binary_not_found'],
    ['falha genérica do version check', { exitCode: 2, stderr: 'boom' }, 'wsl_version_check_failed'],
  ])('%s ⇒ %s (diagnóstico e readiness concordam)', async (_n, outcome, cause) => {
    const deps = makeDeps({ handler: () => outcome });
    const observed = await probeExecutorReadiness('codex-cli', makeDeps({ handler: () => outcome }));
    expect(observed).toMatchObject({ availability: 'unavailable', reasonUnavailable: cause });
    const d = await diagnoseCodexExecutor(deps, observed);
    expect(d).toMatchObject({ transport: 'wsl', cause, reason: cause, version: null });
    expect(JSON.stringify(d)).not.toContain('does not exist'); // só códigos e configuração, nunca o texto do processo
  });

  test('login por API key / não logado: a causa vem da observação e a versão continua informada', async () => {
    const d = await diagnoseCodexExecutor(makeDeps(), { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'wsl_codex_not_logged_in' });
    expect(d).toMatchObject({ version: 'codex-cli 0.162.0', cause: 'wsl_codex_not_logged_in' });
    expect(d.hint).toContain('autenticado');
    const api = await diagnoseCodexExecutor(makeDeps(), { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'codex_login_not_subscription' });
    expect(api.cause).toBe('codex_login_not_subscription');
  });

  test('nenhum segredo do ambiente aparece no resultado nem no ambiente repassado ao processo', async () => {
    const seen: Record<string, string>[] = [];
    const deps: ExecutorReadinessDeps = { ...makeDeps(), run: async (_f, _a, o) => { seen.push(o.env); return { exitCode: 0, stdout: 'codex-cli 0.162.0', stderr: '', timedOut: false }; } };
    const d = await diagnoseCodexExecutor(deps, READY);
    expect(JSON.stringify(d)).not.toContain(SECRET);
    for (const env of seen) expect(JSON.stringify(env)).not.toContain(SECRET);
  });
});

describe('diagnóstico: transporte nativo', () => {
  const nativeEnv = { PATH: '/usr/bin' };
  test('sem configuração em Linux: usa "codex" do PATH', async () => {
    const deps = makeDeps({ platform: 'linux', env: nativeEnv });
    expect(await diagnoseCodexExecutor(deps, READY)).toMatchObject({ transport: 'native', configSource: 'default', binary: 'codex', version: 'codex-cli 0.162.0', distro: null, user: null });
    expect(deps.calls).toEqual([['codex', '--version']]);
  });
  test('executável ausente: em Windows sem WSL configurado, orienta o arquivo persistente', async () => {
    const d = await diagnoseCodexExecutor(makeDeps({ platform: 'win32', env: nativeEnv, handler: () => ({ exitCode: -1 }) }), { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'version_check_failed' });
    expect(d).toMatchObject({ transport: 'native', cause: 'executable_not_found', version: null });
    expect(d.hint).toContain('.env.codex-wsl.local');
  });
  test('caminho absoluto inexistente não lança processo; wrapper de shell é recusado', async () => {
    const deps = makeDeps({ platform: 'win32', env: { ...nativeEnv, ANIMA_CODEX_CLI_PATH: String.raw`C:\tools\codex.exe` }, fileExists: () => false });
    expect(await diagnoseCodexExecutor(deps, READY)).toMatchObject({ cause: 'executable_not_found' });
    expect(deps.calls).toHaveLength(0);
    const wrapper = makeDeps({ platform: 'win32', env: { ...nativeEnv, ANIMA_CODEX_CLI_PATH: String.raw`C:\tools\codex.cmd` } });
    expect(await diagnoseCodexExecutor(wrapper, READY)).toMatchObject({ transport: 'invalid', cause: 'executable_is_shell_wrapper' });
    expect(wrapper.calls).toHaveLength(0);
  });
  test('version check com exit ≠ 0 e timeout', async () => {
    expect(await diagnoseCodexExecutor(makeDeps({ platform: 'linux', env: nativeEnv, handler: () => ({ exitCode: 3 }) }), READY)).toMatchObject({ cause: 'version_check_failed' });
    expect(await diagnoseCodexExecutor(makeDeps({ platform: 'linux', env: nativeEnv, handler: () => ({ exitCode: -1, timedOut: true }) }), READY)).toMatchObject({ cause: 'version_probe_timeout' });
  });
});

describe('classifyWslProbeFailure (puro)', () => {
  const base = { exitCode: 1, stdout: '', stderr: '', timedOut: false };
  test('ordem: timeout, launcher, distro, usuário, binário, genérico', () => {
    expect(classifyWslProbeFailure({ ...base, exitCode: -1, timedOut: true })).toBe('wsl_version_probe_timeout');
    expect(classifyWslProbeFailure({ ...base, exitCode: -1 })).toBe('wsl_launcher_unavailable');
    expect(classifyWslProbeFailure({ ...base, stderr: 'no distribution; user missing' })).toBe('wsl_distro_not_found');
    expect(classifyWslProbeFailure({ ...base, stderr: 'user missing; not found' })).toBe('wsl_user_not_found');
    expect(classifyWslProbeFailure({ ...base, exitCode: 127 })).toBe('codex_binary_not_found');
    expect(classifyWslProbeFailure(base)).toBe('wsl_version_check_failed');
  });
});

describe('configuração persistente (arquivo .env.codex-wsl.local)', () => {
  const example = readFileSync(join(__dirname, '../../.env.codex-wsl.example'), 'utf8');
  const parse = (text: string): Record<string, string> => Object.fromEntries(text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

  test('o modelo é válido para esta máquina, sem segredos, e resolve para o transporte WSL', () => {
    const vars = parse(example);
    expect(Object.keys(vars).sort()).toEqual(['ANIMA_CODEX_CLI_TRANSPORT', 'ANIMA_CODEX_WSL_CLI_PATH', 'ANIMA_CODEX_WSL_DISTRO', 'ANIMA_CODEX_WSL_USER']);
    expect(example).not.toMatch(/(KEY|TOKEN|PASSWORD|SECRET)\s*=/i);
    const config = resolveCodexCliConfig('default', { SystemRoot: String.raw`C:\Windows`, ...vars }, 'win32');
    expect(config).toMatchObject({ ok: true, value: { wsl: { distro: 'Ubuntu-24.04', user: 'geanteco', cliPath: vars.ANIMA_CODEX_WSL_CLI_PATH } } });
  });

  test('o preflight do Single-Item aceita a configuração persistente e recusa sem ela — sem iniciar attempt', async () => {
    const intent = { execution_spec: { executor: 'worktree', coder_backend: 'codex-cli', model: 'default', base_sha: '1'.repeat(40) } };
    const withConfig = makeDeps({ env: { SystemRoot: String.raw`C:\Windows`, ...parse(example) }, handler: (_f, args) => ({ stdout: args.includes('--version') ? 'codex-cli 0.162.0' : 'Logged in using ChatGPT' }) });
    expect(await singleItemCodexRefusal(intent, withConfig)).toBeNull();
    for (const call of withConfig.calls) { expect(call[0]).toBe(WSL_EXE); expect(call).not.toContain('exec'); expect(call.at(-1)).toMatch(/^(--version|status)$/); }
    expect(withConfig.calls).toHaveLength(2);
    expect(await singleItemCodexRefusal(intent, makeDeps({ env: { SystemRoot: String.raw`C:\Windows` } }))).toBe('single_item_codex_wsl_required');
  });

  test('nova sessão: o Node carrega o arquivo persistente sem exportações; processo > arquivo; ausente é tolerado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v104-'));
    try {
      const first = join(dir, '.env.local'); const second = join(dir, '.env.codex-wsl.local');
      writeFileSync(first, 'ANIMA_CODEX_WSL_DISTRO=Debian\nOTHER=from-local\n'); writeFileSync(second, readFileSync(join(__dirname, '../../.env.codex-wsl.example'), 'utf8'));
      const script = 'console.log(JSON.stringify([process.env.ANIMA_CODEX_CLI_TRANSPORT, process.env.ANIMA_CODEX_WSL_DISTRO, process.env.OTHER]))';
      const flags = [`--env-file-if-exists=${first}`, `--env-file-if-exists=${second}`, `--env-file-if-exists=${join(dir, 'nao-existe')}`];
      const clean = { ...process.env }; for (const k of Object.keys(clean)) if (k.startsWith('ANIMA_CODEX') || k === 'OTHER') delete clean[k];
      const run = (env: NodeJS.ProcessEnv) => JSON.parse(execFileSync(process.execPath, [...flags, '-e', script], { env, encoding: 'utf8' }).trim()) as unknown[];
      // sem exportações: o arquivo do Codex WSL define o transporte; o último arquivo vence o anterior; variável fora dos arquivos permanece do primeiro
      expect(run(clean)).toEqual(['wsl', 'Ubuntu-24.04', 'from-local']);
      // variável do processo vence qualquer arquivo
      expect(run({ ...clean, ANIMA_CODEX_WSL_DISTRO: 'Fedora' })[1]).toBe('Fedora');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('o script "anima" carrega o arquivo persistente e o Git o ignora', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { scripts: Record<string, string> }; const script = pkg.scripts['anima'] ?? '';
    expect(script).toContain('--env-file-if-exists=.env.local');
    expect(script).toContain('--env-file-if-exists=.env.codex-wsl.local');
    expect(script.indexOf('.env.local')).toBeLessThan(script.indexOf('.env.codex-wsl.local')); // o específico vence o geral
    const ignore = readFileSync(join(__dirname, '../../../../.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env\.codex-wsl\.local$/m);
  });
});
