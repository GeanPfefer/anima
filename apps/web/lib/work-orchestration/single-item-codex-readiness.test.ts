/** @jest-environment node */
import { singleItemCodexRefusal } from './single-item-codex-readiness';
import type { ExecutorReadinessDeps } from './executor-readiness';

const env = { ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04',
  ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/bin/codex' };
const intent = { execution_spec: { executor: 'worktree', coder_backend: 'codex-cli', model: 'default', base_sha: '1'.repeat(40) } };
function deps(login = 'Logged in using ChatGPT', changes: Record<string, string | undefined> = {}): ExecutorReadinessDeps {
  return { env: { ...env, ...changes }, platform: 'win32', cwd: 'G:/anima', fileExists: () => true,
    httpGet: jest.fn(), run: jest.fn(async (_file, args) => ({ exitCode: 0, timedOut: false,
      stdout: args.includes('--version') ? 'codex-cli 0.162.0' : login, stderr: '' })) };
}
test('base aprovada é nova execução, com readiness WSL e ChatGPT, sem coding', async () => {
  const d = deps(); expect(await singleItemCodexRefusal(intent, d)).toBeNull();
  expect(d.run).toHaveBeenCalledTimes(2);
  for (const call of (d.run as jest.Mock).mock.calls) {
    expect(call[0]).toMatch(/wsl.exe/i); expect(call[1]).not.toContain('exec');
  }
});
test.each(['Logged in using API key', 'unknown', 'ChatGPT API key'])('credencial %s recusada', async login => {
  expect(await singleItemCodexRefusal(intent, deps(login))).toBe('single_item_codex_authentication_unproved');
});
test.each(['ANIMA_CODEX_CLI_TRANSPORT', 'ANIMA_CODEX_WSL_DISTRO', 'ANIMA_CODEX_WSL_USER', 'ANIMA_CODEX_WSL_CLI_PATH'])('config explícita %s obrigatória', async field => {
  const d = deps(undefined, { [field]: '' }); expect(await singleItemCodexRefusal(intent, d)).toBe('single_item_codex_wsl_required');
  expect(d.run).not.toHaveBeenCalled();
});
test('perfil alternativo e runtime Linux direto não viram fallback', async () => {
  expect(await singleItemCodexRefusal(intent, deps(undefined, { ANIMA_CODEX_CLI_PROFILE: 'paid' }))).toBe('single_item_codex_wsl_required');
  expect(await singleItemCodexRefusal(intent, { ...deps(), platform: 'linux' })).toBe('single_item_codex_wsl_required');
});
test('checkpoint recusado antes do probe; outro modelo/executor também', async () => {
  for (const [override, expected] of [[{ resume_from_checkpoint: null }, 'single_item_resumption_unproved'],
    [{ model: 'other' }, 'single_item_codex_contract_invalid'], [{ executor: 'other' }, 'single_item_codex_contract_invalid']] as const) {
    const d = deps(); expect(await singleItemCodexRefusal({ execution_spec: { ...intent.execution_spec, ...override } }, d)).toBe(expected);
    expect(d.run).not.toHaveBeenCalled();
  }
});
test('timeout e erro de processo não admitem executor', async () => {
  const d = { ...deps(), run: jest.fn(async () => ({ exitCode: 0, timedOut: true, stdout: '', stderr: '' })) };
  expect(await singleItemCodexRefusal(intent, d)).toBe('single_item_codex_authentication_unproved');
});

describe('Claude Code no Single-Item (NOMAD-01-F)', () => {
  const claudeIntent = { execution_spec: { executor: 'worktree', coder_backend: 'claude-code', model: 'default', base_sha: '1'.repeat(40) } };
  const claudeDeps = (auth: unknown, changes: Record<string, string | undefined> = {}): ExecutorReadinessDeps => ({
    env: { Path: 'C:\\Program Files\\Git\\cmd', ...changes }, platform: 'win32', cwd: 'C:/dev/anima', fileExists: () => true, httpGet: jest.fn(),
    run: jest.fn(async (_file, args) => ({ exitCode: 0, timedOut: false, stderr: '',
      stdout: args.includes('--version') ? '2.1.322 (Claude Code)' : JSON.stringify(auth) })),
  });
  test('nativo Windows, sem WSL: assinatura claude.ai admite, sem coding', async () => {
    const d = claudeDeps({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' });
    expect(await singleItemCodexRefusal(claudeIntent, d)).toBeNull();
    const calls = (d.run as jest.Mock).mock.calls.map(c => [c[0], ...c[1]]);
    expect(calls).toEqual([['claude', '--version'], ['claude', 'auth', 'status']]);
    expect(calls.flat()).not.toContain('-p');
  });
  test.each([{ loggedIn: true, authMethod: 'api_key' }, { loggedIn: true, authMethod: 'oauth_token' }, { loggedIn: false, authMethod: 'none' }, 'texto'])(
    'sessão %j não comprovada', async auth => {
      expect(await singleItemCodexRefusal(claudeIntent, claudeDeps(auth))).toBe('single_item_claude_authentication_unproved');
    });
  test('executável wrapper de shell recusado antes de qualquer processo', async () => {
    const d = claudeDeps({ loggedIn: true, authMethod: 'claude.ai' }, { ANIMA_CLAUDE_CODE_PATH: 'C:\\npm\\claude.cmd' });
    expect(await singleItemCodexRefusal(claudeIntent, d)).toBe('single_item_claude_executable_invalid');
    expect(d.run).not.toHaveBeenCalled();
  });
  test('contrato fora do envelope recusado antes do probe; ANIMA_CLAUDE_CODE_MODEL não altera o contrato', async () => {
    for (const [override, expected] of [[{ model: 'opus' }, 'single_item_claude_contract_invalid'], [{ executor: 'other' }, 'single_item_claude_contract_invalid'],
      [{ resume_from_checkpoint: {} }, 'single_item_resumption_unproved']] as const) {
      const d = claudeDeps({ loggedIn: true, authMethod: 'claude.ai' });
      expect(await singleItemCodexRefusal({ execution_spec: { ...claudeIntent.execution_spec, ...override } }, d)).toBe(expected);
      expect(d.run).not.toHaveBeenCalled();
    }
    expect(await singleItemCodexRefusal(claudeIntent, claudeDeps({ loggedIn: true, authMethod: 'claude.ai' }, { ANIMA_CLAUDE_CODE_MODEL: 'opus' }))).toBeNull();
  });
  test('Codex continua exigindo WSL (o bloqueio nativo é preservado)', async () => {
    const d = claudeDeps('n/a');
    expect(await singleItemCodexRefusal({ execution_spec: { ...claudeIntent.execution_spec, coder_backend: 'codex-cli' } }, d)).toBe('single_item_codex_wsl_required');
    expect(d.run).not.toHaveBeenCalled();
  });
});
