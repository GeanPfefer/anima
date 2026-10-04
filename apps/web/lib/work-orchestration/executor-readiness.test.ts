import { probeAllExecutors, probeExecutorReadiness, type ExecutorReadinessDeps, type ReadinessProcessResult } from './executor-readiness';

const SECRET = 'sk-super-secret-token';
const EMAIL = 'pessoa@example.com';

type Handler = (file: string, args: readonly string[], env: Record<string, string>) => Partial<ReadinessProcessResult>;

function makeDeps(overrides: Partial<ExecutorReadinessDeps> & { handler?: Handler } = {}): ExecutorReadinessDeps & { calls: string[][]; envs: Record<string, string>[]; urls: string[] } {
  const calls: string[][] = [];
  const envs: Record<string, string>[] = [];
  const urls: string[] = [];
  const handler: Handler = overrides.handler ?? (() => ({ exitCode: 0, stdout: '' }));
  return {
    calls, envs, urls,
    run: overrides.run ?? (async (file, args, options) => {
      calls.push([file, ...args]);
      envs.push(options.env);
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...handler(file, args, options.env) };
    }),
    fileExists: overrides.fileExists ?? (() => true),
    platform: overrides.platform ?? 'linux',
    env: overrides.env ?? { PATH: '/usr/bin' },
    cwd: '/work',
    httpGet: overrides.httpGet ?? (async url => { urls.push(url); return { status: 200 }; }),
  };
}

const codexOk: Handler = (_f, args) => args[0] === 'login' ? { stdout: `Logged in using ChatGPT ${EMAIL}` } : { stdout: 'codex 1.0.0' };
const claudeOk: Handler = (_f, args) => args[0] === 'auth' ? { stdout: JSON.stringify({ loggedIn: true, email: EMAIL }) } : { stdout: '2.0.0' };

describe('readiness: codex-cli', () => {
  test('ready com --version 0 e login por assinatura', async () => {
    const deps = makeDeps({ handler: codexOk });
    expect(await probeExecutorReadiness('codex-cli', deps)).toEqual({ provider: 'codex-cli', availability: 'ready', reasonUnavailable: null });
    expect(deps.calls).toEqual([['codex', '--version'], ['codex', 'login', 'status']]);
  });

  test('wrapper .cmd ⇒ indisponível, sem lançar processo', async () => {
    const deps = makeDeps({ env: { ANIMA_CODEX_CLI_PATH: 'C:\\tools\\codex.cmd' }, handler: codexOk });
    expect(await probeExecutorReadiness('codex-cli', deps)).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'executable_is_shell_wrapper' });
    expect(deps.calls).toEqual([]);
  });

  test('caminho configurado inexistente ⇒ executable_not_found', async () => {
    const deps = makeDeps({ env: { ANIMA_CODEX_CLI_PATH: '/opt/codex' }, fileExists: () => false });
    expect(await probeExecutorReadiness('codex-cli', deps)).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'executable_not_found' });
    expect(deps.calls).toEqual([]);
  });

  test('--version falha ⇒ version_check_failed; timeout ⇒ version_probe_timeout', async () => {
    expect(await probeExecutorReadiness('codex-cli', makeDeps({ handler: () => ({ exitCode: -1 }) }))).toMatchObject({ reasonUnavailable: 'version_check_failed' });
    expect(await probeExecutorReadiness('codex-cli', makeDeps({ handler: () => ({ exitCode: -1, timedOut: true }) }))).toMatchObject({ reasonUnavailable: 'version_probe_timeout' });
  });

  test('não logado ⇒ codex_not_logged_in; login por API key ⇒ não é assinatura', async () => {
    expect(await probeExecutorReadiness('codex-cli', makeDeps({ handler: (_f, a) => a[0] === 'login' ? { exitCode: 1 } : {} })))
      .toMatchObject({ availability: 'unavailable', reasonUnavailable: 'codex_not_logged_in' });
    expect(await probeExecutorReadiness('codex-cli', makeDeps({ handler: (_f, a) => a[0] === 'login' ? { stdout: 'Logged in using an API key' } : {} })))
      .toMatchObject({ availability: 'unavailable', reasonUnavailable: 'codex_login_not_subscription' });
  });

  test('saída de login irreconhecível ⇒ unknown', async () => {
    expect(await probeExecutorReadiness('codex-cli', makeDeps({ handler: (_f, a) => a[0] === 'login' ? { stdout: 'ok' } : {} })))
      .toMatchObject({ availability: 'unknown', reasonUnavailable: 'codex_login_mode_unrecognized' });
  });

  test('o filho recebe só o ambiente allowlisted (sem chaves de API)', async () => {
    const deps = makeDeps({ handler: codexOk, env: { PATH: '/bin', OPENAI_API_KEY: SECRET, CODEX_API_KEY: SECRET, CODEX_HOME: '/home/c' } });
    await probeExecutorReadiness('codex-cli', deps);
    for (const env of deps.envs) {
      expect(JSON.stringify(env)).not.toContain(SECRET);
      expect(env.CODEX_HOME).toBe('/home/c');
    }
  });
});

describe('readiness: claude-code', () => {
  test('ready em linux com loggedIn true', async () => {
    const deps = makeDeps({ handler: claudeOk });
    expect(await probeExecutorReadiness('claude-code', deps)).toEqual({ provider: 'claude-code', availability: 'ready', reasonUnavailable: null });
    expect(deps.calls).toEqual([['claude', '--version'], ['claude', 'auth', 'status']]);
  });

  test('win32 sem Git Bash ⇒ git_bash_not_found', async () => {
    const deps = makeDeps({ platform: 'win32', env: { PATH: 'C:\\Windows' }, handler: claudeOk, fileExists: () => false });
    expect(await probeExecutorReadiness('claude-code', deps)).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'git_bash_not_found' });
  });

  test('win32 com CLAUDE_CODE_GIT_BASH_PATH existente ⇒ ready', async () => {
    const deps = makeDeps({ platform: 'win32', env: { PATH: 'C:\\Windows', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe' }, handler: claudeOk, fileExists: p => p === 'C:\\Git\\bin\\bash.exe' });
    expect(await probeExecutorReadiness('claude-code', deps)).toMatchObject({ availability: 'ready' });
  });

  test('win32 com bash derivado do git no PATH ⇒ ready', async () => {
    const present = new Set(['C:\\Git\\cmd\\git.exe', 'C:\\Git\\bin\\bash.exe']);
    const deps = makeDeps({ platform: 'win32', env: { Path: 'C:\\Windows;C:\\Git\\cmd' }, handler: claudeOk, fileExists: p => present.has(p) });
    expect(await probeExecutorReadiness('claude-code', deps)).toMatchObject({ availability: 'ready' });
  });

  test('não logado, JSON inválido e JSON não-objeto', async () => {
    const withAuth = (stdout: string): Handler => (_f, a) => a[0] === 'auth' ? { stdout } : {};
    expect(await probeExecutorReadiness('claude-code', makeDeps({ handler: withAuth('{"loggedIn":false}') }))).toMatchObject({ reasonUnavailable: 'claude_not_logged_in' });
    expect(await probeExecutorReadiness('claude-code', makeDeps({ handler: withAuth('not json') }))).toMatchObject({ reasonUnavailable: 'auth_status_invalid' });
    expect(await probeExecutorReadiness('claude-code', makeDeps({ handler: withAuth('[]') }))).toMatchObject({ reasonUnavailable: 'auth_status_invalid' });
    expect(await probeExecutorReadiness('claude-code', makeDeps({ handler: withAuth('{"loggedIn":"true"}') }))).toMatchObject({ reasonUnavailable: 'claude_not_logged_in' });
  });

  test('o filho não recebe ANTHROPIC_API_KEY', async () => {
    const deps = makeDeps({ handler: claudeOk, env: { PATH: '/bin', ANTHROPIC_API_KEY: SECRET } });
    await probeExecutorReadiness('claude-code', deps);
    expect(JSON.stringify(deps.envs)).not.toContain(SECRET);
  });
});

describe('readiness: ollama', () => {
  test('GET /api/tags 200 ⇒ ready', async () => {
    const deps = makeDeps({ env: { OLLAMA_URL: 'http://127.0.0.1:11434/' } });
    expect(await probeExecutorReadiness('ollama', deps)).toMatchObject({ availability: 'ready' });
    expect(deps.urls).toEqual(['http://127.0.0.1:11434/api/tags']);
  });

  test('falha de rede ou status não-2xx ⇒ unavailable', async () => {
    expect(await probeExecutorReadiness('ollama', makeDeps({ httpGet: async () => { throw new Error('ECONNREFUSED'); } }))).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'ollama_unreachable' });
    expect(await probeExecutorReadiness('ollama', makeDeps({ httpGet: async () => ({ status: 500 }) }))).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'ollama_http_error' });
  });

  test('config inválida ⇒ unavailable sem tocar a rede', async () => {
    const deps = makeDeps({ env: { ANIMA_WORKTREE_OLLAMA_URL: 'http://example.com:1234' } });
    expect(await probeExecutorReadiness('ollama', deps)).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'ollama_config_invalid' });
    expect(deps.urls).toEqual([]);
  });
});

describe('readiness: openai e deepseek-harness', () => {
  test('openai sem chave ⇒ unavailable', async () => {
    expect(await probeExecutorReadiness('openai', makeDeps({ env: {} }))).toEqual({ provider: 'openai', availability: 'unavailable', reasonUnavailable: 'openai_api_key_absent' });
  });

  test('openai com chave ⇒ unknown, nunca chama rede nem processo, nem vaza a chave', async () => {
    const httpGet = jest.fn();
    const run = jest.fn();
    const deps = makeDeps({ env: { OPENAI_API_KEY: SECRET }, httpGet, run });
    const observation = await probeExecutorReadiness('openai', deps);
    expect(observation).toEqual({ provider: 'openai', availability: 'unknown', reasonUnavailable: 'paid_authority_required_per_item' });
    expect(httpGet).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(observation)).not.toContain(SECRET);
  });

  test('deepseek-harness estacionado', async () => {
    expect(await probeExecutorReadiness('deepseek-harness', makeDeps())).toEqual({ provider: 'deepseek-harness', availability: 'unavailable', reasonUnavailable: 'parked_not_operational' });
  });
});

describe('probeAllExecutors', () => {
  test('cinco observações em ordem do registry; nenhum segredo/e-mail na saída', async () => {
    const deps = makeDeps({
      env: { PATH: '/bin', OPENAI_API_KEY: SECRET },
      handler: (_f, a) => a[0] === 'auth' ? { stdout: JSON.stringify({ loggedIn: true, email: EMAIL }) } : a[0] === 'login' ? { stdout: `Logged in using ChatGPT ${EMAIL}` } : { stdout: 'v1' },
    });
    const observations = await probeAllExecutors(deps);
    expect(observations.map(o => o.provider)).toEqual(['ollama', 'openai', 'deepseek-harness', 'codex-cli', 'claude-code']);
    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(EMAIL);
  });

  test('exceção inesperada num probe vira probe_failed sem derrubar os demais', async () => {
    const deps = makeDeps({ run: async () => { throw new Error(`boom ${SECRET}`); }, env: {} });
    const observations = await probeAllExecutors(deps);
    expect(observations.find(o => o.provider === 'codex-cli')).toEqual({ provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'probe_failed' });
    expect(JSON.stringify(observations)).not.toContain(SECRET);
  });
});
