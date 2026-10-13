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
