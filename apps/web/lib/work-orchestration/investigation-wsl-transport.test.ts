/** @jest-environment node */
import { buildWslCodexInvocation, buildWslLoginStatusInvocation, buildWslPathCheckInvocation, resolveInvestigationTransport, windowsPathToWsl } from './investigation-wsl-transport';

const env = { ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex', SystemRoot: 'C:\\Windows' };

describe('windowsPathToWsl', () => {
  test.each([
    ['C:\\Users\\Gean Teco\\AppData\\Local\\Temp\\anima-investigation-ab12\\snapshot', '/mnt/c/Users/Gean Teco/AppData/Local/Temp/anima-investigation-ab12/snapshot'],
    ['g:/anima/x', '/mnt/g/anima/x'],
    ['D:\\a\\\\b\\.\\c', '/mnt/d/a/b/c'],
  ])('translates %s', (input, expected) => expect(windowsPathToWsl(input)).toBe(expected));
  test.each(['\\\\server\\share\\x', 'relative\\path', '/mnt/c/x', 'C:relative', 'C:\\a\\..\\b', 'C:\\a\\b:stream', 'C:\\a\nb', 'C:\\a\0b', 'C:\\a|b', ''])('refuses %j', input =>
    expect(windowsPathToWsl(input)).toBeNull());
});

describe('resolveInvestigationTransport', () => {
  test.each([{}, { ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'native' }, { ANIMA_INVESTIGATION_CODEX_TRANSPORT: ' ' }])('defaults to native for %p', source =>
    expect(resolveInvestigationTransport(source, 'win32')).toEqual({ ok: true, value: null }));
  test('resolves an explicit configuration with wsl.exe under SystemRoot', () =>
    expect(resolveInvestigationTransport(env, 'win32')).toEqual({ ok: true, value: { wslExecutable: 'C:\\Windows\\System32\\wsl.exe', distro: 'Ubuntu-24.04', user: 'geanteco', cliPath: env.ANIMA_CODEX_WSL_CLI_PATH } }));
  test.each([
    { ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'docker' },
    { ANIMA_CODEX_WSL_DISTRO: undefined }, { ANIMA_CODEX_WSL_DISTRO: '-u root' }, { ANIMA_CODEX_WSL_DISTRO: 'a b' },
    { ANIMA_CODEX_WSL_USER: undefined }, { ANIMA_CODEX_WSL_USER: 'root;id' }, { ANIMA_CODEX_WSL_USER: 'Root' },
    { ANIMA_CODEX_WSL_CLI_PATH: undefined }, { ANIMA_CODEX_WSL_CLI_PATH: 'codex' }, { ANIMA_CODEX_WSL_CLI_PATH: '/home/x/../bin/codex' },
    { ANIMA_CODEX_WSL_CLI_PATH: '/home/x/codex; id' }, { ANIMA_CODEX_WSL_CLI_PATH: '/home/x/$(id)' }, { ANIMA_CODEX_WSL_CLI_PATH: '/home/x/bin/' },
  ])('fails closed for %p', override => expect(resolveInvestigationTransport({ ...env, ...override }, 'win32')).toMatchObject({ ok: false }));
  test('fails closed outside Windows', () => expect(resolveInvestigationTransport(env, 'linux')).toMatchObject({ ok: false }));
});

describe('WSL invocations', () => {
  const config = (() => { const r = resolveInvestigationTransport(env, 'win32'); if (!r.ok || !r.value) throw new Error('fixture'); return r.value; })();
  test('codex runs through --exec with env scrubbing, node dir on PATH and untouched argv', () => {
    const prompt = 'L1 "q" $(id) `id` ; & | \\ \nL2';
    const { file, args } = buildWslCodexInvocation(config, ['exec', '--sandbox', 'read-only', prompt], '/mnt/c/t/snapshot');
    expect(file).toBe('C:\\Windows\\System32\\wsl.exe');
    expect(args.slice(0, 7)).toEqual(['-d', 'Ubuntu-24.04', '-u', 'geanteco', '--cd', '/mnt/c/t/snapshot', '--exec']);
    expect(args.slice(7, 14)).toEqual(['/usr/bin/env', '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY', 'PATH=/home/geanteco/.nvm/versions/node/v22.23.3/bin:/usr/local/bin:/usr/bin:/bin', config.cliPath]);
    expect(args.at(-1)).toBe(prompt);
    expect(args).not.toContain('-c'); expect(args).not.toContain('bash'); expect(args).not.toContain('sh');
  });
  test('preflights use exec without shell', () => {
    expect(buildWslLoginStatusInvocation(config).args.slice(-3)).toEqual([config.cliPath, 'login', 'status']);
    expect(buildWslPathCheckInvocation(config, '/mnt/c/t/snapshot', '/mnt/c/t/schema.json', '/mnt/c/t').args).toEqual(
      ['-d', 'Ubuntu-24.04', '-u', 'geanteco', '--exec', '/usr/bin/test', '-d', '/mnt/c/t/snapshot', '-a', '-f', '/mnt/c/t/schema.json', '-a', '-d', '/mnt/c/t', '-a', '-w', '/mnt/c/t']);
  });
});
