/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, type WorkExecutorRequest } from '@anima/core';
import { renderCoderTaskSection, type CoderEditRequest, type CoderWorkspace } from './coder-backend';
import {
  classifyCodexCliFailure,
  CODEX_CLI_DEFAULT_MODEL,
  CODEX_CLI_PROMPT_MAX_CHARS,
  CodexCliCoderBackend,
  buildCodexCliEnvironment,
  buildCodexExecArgs,
  codexAgentIsolationArgs,
  CODEX_AGENT_DISABLED_FEATURES,
  resolveCodexCliConfig,
  type CodexCliProcessRunner,
} from './codex-cli-coder';
import { runProcess, type CommandResult } from './worktree';

jest.setTimeout(30_000);

const ROOT = join(tmpdir(), 'anima-codex-fixture-worktree');

const criteria: WorkExecutorRequest['validationCriteria'] = [
  { label: 'testes', command: 'npm test -- src/added.test.ts', covers: ['aceite-1'] },
];
const taskSpec = buildCoderTaskSpec({
  workItemId: 'item-1', approvedProposalVersion: 3,
  proposal: {
    summary: 'Adicionar função pura', objective: 'Adicionar a função two()',
    includedScope: ['src/added.ts'], excludedScope: ['src/other.ts'],
    expectedEffects: ['two() devolve 2'], risks: ['nenhum'],
  },
  spec: { validationCriteria: criteria }, verifierRequirement: 'advisory', contextReferences: [],
});

const editRequest = (overrides: Partial<CoderEditRequest> = {}): CoderEditRequest => ({
  workItemId: 'item-1',
  attemptId: 'att-1',
  approvedProposalVersion: 3,
  objective: 'Adicionar a função two()',
  includedScope: ['src/added.ts'],
  excludedScope: ['src/other.ts'],
  taskSpec,
  validationCommands: [{ label: 'testes', program: 'npm', args: ['test', '--', 'src/added.test.ts'] }],
  deadlineAtMs: Date.now() + 60_000,
  ...overrides,
});

const workspace = (rootPath?: string): CoderWorkspace => ({
  readFile: async () => { throw new Error('o backend Codex não lê pelo host'); },
  writeFile: async () => { throw new Error('o backend Codex não escreve pelo host'); },
  ...(rootPath ? { rootPath } : {}),
});

const commandResult = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  command: 'codex', exitCode: 0, stdout: '', stderr: '', durationMs: 1200, timedOut: false, cancelled: false, ...overrides,
});

interface Captured { file: string; args: readonly string[]; options: Parameters<CodexCliProcessRunner>[2] }
const capturingRunner = (result: CommandResult = commandResult()): { run: CodexCliProcessRunner; calls: Captured[] } => {
  const calls: Captured[] = [];
  return { calls, run: async (file, args, options) => { calls.push({ file, args, options }); return result; } };
};

/** Runner que responde ao pré-voo de isolamento WSL (versão + canário) e ao login; o resto é o turno do agente. */
const provingRunner = (exec: CommandResult = commandResult(), over: { version?: string; canary?: Partial<CommandResult>; login?: string } = {}): { run: CodexCliProcessRunner; calls: Captured[]; execCalls: () => Captured[] } => {
  const calls: Captured[] = [];
  const run: CodexCliProcessRunner = async (file, args, options) => {
    calls.push({ file, args, options });
    if (args.includes('--version')) return commandResult({ stdout: over.version ?? 'codex-cli 0.162.0\n' });
    if (args.includes('sandbox')) return commandResult({ stdout: 'ANIMA_PROFILE_OK\n', ...over.canary });
    if (args.includes('status')) return commandResult({ stdout: over.login ?? 'Logged in using ChatGPT' });
    return exec;
  };
  return { run, calls, execCalls: () => calls.filter(c => c.args.includes('--json')) };
};

const backend = (run: CodexCliProcessRunner, env: Record<string, string | undefined> = { PATH: '/usr/bin' }, model = CODEX_CLI_DEFAULT_MODEL) =>
  new CodexCliCoderBackend({ config: { executable: 'codex-native', model }, run, environmentSource: env });

describe('CodexCliCoderBackend — lançamento determinístico', () => {
  test('exige workspace.rootPath: sem worktree enraizada falha fechado e não spawna', async () => {
    const { run, calls } = capturingRunner();
    await expect(backend(run).edit(editRequest(), workspace(), new AbortController().signal)).rejects.toThrow(/rootPath ausente/);
    expect(calls).toHaveLength(0);
  });

  test('cwd é exatamente a worktree, sem shell, com codex exec workspace-write e aprovação never', async () => {
    const { run, calls } = capturingRunner();
    await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.file).toBe('codex-native');
    expect(call!.options.cwd).toBe(ROOT);
    expect(call!.args.slice(0, 7)).toEqual(['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', ROOT]);
    // Modelo default ⇒ o Codex usa o próprio config; nenhum `--model` inventado.
    expect(call!.args).not.toContain('--model');
    expect(call!.options).not.toHaveProperty('shell');
  });

  test('CoderTaskSpecV1 aparece INTEGRALMENTE na instrução, com includes/excludes e regras operacionais', async () => {
    const { run, calls } = capturingRunner();
    const req = editRequest();
    await backend(run).edit(req, workspace(ROOT), new AbortController().signal);
    const prompt = calls[0]!.args.at(-1)!;
    expect(prompt).toContain(renderCoderTaskSection(req)!);
    expect(prompt).toContain('- src/added.ts');
    expect(prompt).toContain('- src/other.ts');
    expect(prompt).toMatch(/Não faça commit, push, merge/);
    expect(prompt).toMatch(/A validação final, o commit e a integração são do host/);
  });

  test('modelo e perfil explícitos viram flags; config do operador recusa wrapper de shell', () => {
    expect(buildCodexExecArgs({ executable: 'codex', model: 'gpt-x', profile: 'anima' }, ROOT, 'p'))
      .toEqual(['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', ROOT, '--json', '--model', 'gpt-x', '--profile', 'anima', ...codexAgentIsolationArgs({ executable: 'codex', model: 'gpt-x' }), 'p']);
    expect(resolveCodexCliConfig(null, {})).toEqual({ ok: true, value: { executable: 'codex', model: CODEX_CLI_DEFAULT_MODEL } });
    expect(resolveCodexCliConfig('gpt-x', { ANIMA_CODEX_CLI_PATH: ' C:\\bin\\codex.exe ', ANIMA_CODEX_CLI_MODEL: 'ignored', ANIMA_CODEX_CLI_PROFILE: 'p' }))
      .toEqual({ ok: true, value: { executable: 'C:\\bin\\codex.exe', model: 'gpt-x', profile: 'p' } });
    expect(resolveCodexCliConfig(null, { ANIMA_CODEX_CLI_MODEL: 'gpt-y' })).toMatchObject({ ok: true, value: { model: 'gpt-y' } });
    for (const wrapper of ['codex.cmd', 'C:\\npm\\codex.CMD', 'codex.bat', 'codex.ps1']) {
      expect(resolveCodexCliConfig(null, { ANIMA_CODEX_CLI_PATH: wrapper })).toMatchObject({ ok: false });
    }
  });

  test('ambiente por allowlist: autenticação/sistema passam; segredos do ANIMA/OpenAI/Supabase não', async () => {
    const source = {
      PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\op', CODEX_HOME: 'C:\\Users\\op\\.codex', HTTPS_PROXY: 'http://proxy:3128',
      OPENAI_API_KEY: 'sk-live-secret', SUPABASE_SERVICE_ROLE_KEY: 'srk', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      ANIMA_RESIDENT_PASSWORD: 'pw', RUNPOD_API_KEY: 'rp', DEEPSEEK_API_KEY: 'ds', CODEX_API_KEY: 'ck', EMPTY: '',
    };
    const { run, calls } = capturingRunner();
    await backend(run, source).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.options.env).toEqual({
      PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\op', CODEX_HOME: 'C:\\Users\\op\\.codex', HTTPS_PROXY: 'http://proxy:3128', NO_COLOR: '1',
    });
    expect(buildCodexCliEnvironment({ Path: 'x', windir: 'w' })).toEqual({ Path: 'x', windir: 'w', NO_COLOR: '1' });
  });

  test('exit 0 significa só "turno terminou": sem arquivos atestados, sem caminho absoluto no summary', async () => {
    const { run } = capturingRunner(commandResult({ stdout: `editei ${ROOT}\\src\\added.ts` }));
    const result = await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(result.touchedResources).toEqual([]);
    expect(result.summary).toMatch(/codex-cli:default.*exit 0.*validação é dos gates do host/);
    expect(result.summary).not.toContain(ROOT);
    expect(result.notes).toEqual(['turn-outcome:exited-0', 'duration-s:1']);
  });

  test('exit não-zero falha fechado com diagnóstico sanitizado e limitado', async () => {
    const noisy = [
      ...Array.from({ length: 50 }, (_, i) => `linha de ruído ${i} ${'x'.repeat(80)}`),
      `erro em ${ROOT}\\src\\added.ts`,
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'api_key=sk-live-123456',
    ].join('\n');
    const { run } = capturingRunner(commandResult({ exitCode: 2, stderr: noisy }));
    const error = await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal).then(() => null, (e: unknown) => e as Error);
    if (!(error instanceof Error)) throw new Error('esperava falha');
    expect(error.message).toMatch(/^Codex CLI terminou com exit 2: /);
    expect(error.message).not.toContain(ROOT);
    expect(error.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(error.message).not.toContain('sk-live-123456');
    expect(error.message.length).toBeLessThan(800);
  });

  test('timeout pelo deadline e cancelamento lançam (timeout com marcador [runner_timeout])', async () => {
    await expect(backend(capturingRunner(commandResult({ timedOut: true, exitCode: -1 })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/^\[runner_timeout\]/);
    await expect(backend(capturingRunner(commandResult({ cancelled: true, exitCode: -1 })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/cancelado pelo host/);
  });

  test('timeout entregue ao processo é o restante do deadline global; deadline esgotado não spawna', async () => {
    const { run, calls } = capturingRunner();
    await backend(run).edit(editRequest({ deadlineAtMs: Date.now() + 5_000 }), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.options.timeoutMs).toBeGreaterThan(4_000);
    expect(calls[0]!.options.timeoutMs).toBeLessThanOrEqual(5_000);
    await expect(backend(run).edit(editRequest({ deadlineAtMs: Date.now() - 1 }), workspace(ROOT), new AbortController().signal))
      .rejects.toThrow(/\[runner_timeout\].*não iniciado/);
    const aborted = new AbortController(); aborted.abort();
    await expect(backend(run).edit(editRequest(), workspace(ROOT), aborted.signal)).rejects.toThrow(/cancelada/);
    expect(calls).toHaveLength(1);
  });

  test('instrução acima do teto de linha de comando falha fechado antes de spawnar', async () => {
    const { run, calls } = capturingRunner();
    const huge = editRequest({ taskSpec: undefined, objective: 'x'.repeat(CODEX_CLI_PROMPT_MAX_CHARS + 1) });
    await expect(backend(run).edit(huge, workspace(ROOT), new AbortController().signal)).rejects.toThrow(/excede/);
    expect(calls).toHaveLength(0);
  });

  test('feedback do host (repair) entra na instrução sem ampliar escopo', async () => {
    const { run, calls } = capturingRunner();
    await backend(run).edit(editRequest({ hostValidationFeedback: {
      kind: 'gate-failure', retryIndex: 1, retryLimit: 1, changedFiles: ['src/added.ts'], diffSha256: 'abc',
      failedGate: { label: 'testes', command: 'npm test', exitCode: 1, timedOut: false, cancelled: false }, diagnostic: 'expected 2',
    } }), workspace(ROOT), new AbortController().signal);
    const prompt = calls[0]!.args.at(-1)!;
    expect(prompt).toContain('o gate "testes" (npm test) falhou com exit 1');
    expect(prompt).toContain('expected 2');
  });
});

// Processo REAL (sem Codex): o executável falso é o node rodando um script gerado. O
// lançador real `runProcess` (sem shell, taskkill da árvore no Windows) é o mesmo da produção.
describe('CodexCliCoderBackend — processo falso real', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'anima-codex-fake-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const fakeRunner = (script: string): CodexCliProcessRunner =>
    (_file, args, options) => runProcess(process.execPath, [script, ...args], options);

  test('o processo filho roda com cwd = worktree e recebe a instrução', async () => {
    const root = await mkdtemp(join(dir, 'wt-'));
    const record = join(dir, 'record.json');
    const script = join(dir, 'record.js');
    await writeFile(script, `require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: Object.keys(process.env) }));`);
    const result = await backend(fakeRunner(script), { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OPENAI_API_KEY: 'sk-nao' })
      .edit(editRequest(), workspace(root), new AbortController().signal);
    expect(result.touchedResources).toEqual([]);
    const seen = JSON.parse(await readFile(record, 'utf8')) as { cwd: string; args: string[]; env: string[] };
    expect(seen.cwd.toLowerCase()).toBe(root.toLowerCase());
    expect(seen.args.at(-1)).toContain(renderCoderTaskSection(editRequest())!);
    expect(seen.env.map(name => name.toUpperCase())).not.toContain('OPENAI_API_KEY');
  });

  test('deadline encerra o processo pendurado', async () => {
    const script = join(dir, 'hang.js');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const started = Date.now();
    await expect(backend(fakeRunner(script), { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot })
      .edit(editRequest({ deadlineAtMs: Date.now() + 800 }), workspace(dir), new AbortController().signal)).rejects.toThrow(/\[runner_timeout\]/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test('cancelamento do host encerra o processo pendurado', async () => {
    const script = join(dir, 'hang2.js');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 400);
    const started = Date.now();
    await expect(backend(fakeRunner(script), { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot })
      .edit(editRequest(), workspace(dir), controller.signal)).rejects.toThrow(/cancelado pelo host/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test('exit não-zero real falha fechado', async () => {
    const script = join(dir, 'fail.js');
    await writeFile(script, "console.error('falha simulada do codex'); process.exit(3);");
    await expect(backend(fakeRunner(script), { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot })
      .edit(editRequest(), workspace(dir), new AbortController().signal)).rejects.toThrow(/exit 3: falha simulada do codex/);
  });
});

describe('terminal JSONL diagnostics (closed textual heuristics, no public enum)', () => {
  const failed = (message: string) => JSON.stringify({ type: 'turn.failed', error: { message } });
  test.each([
    ["You've hit your usage limit. cf-ray=private-sentinel", 'usage_limit_exceeded'],
    ["You\u2019ve hit your usage limit. request id private-sentinel", 'usage_limit_exceeded'],
    ['unexpected status 401 Unauthorized: private-sentinel', 'unauthorized'],
    ['some usage limit', 'unknown_native_cli_failure'],
    ["prefix You've hit your usage limit.", 'unknown_native_cli_failure'],
    ['429 Too Many Requests', 'unknown_native_cli_failure'],
  ])('classifies ONLY terminal %s', (message, category) => {
    expect(classifyCodexCliFailure(failed(message), 1)).toEqual({ version: 1, category, exitCode: 1 });
  });
  test('thread, last terminal, malformed and intermediate events', () => {
    const stdout = [JSON.stringify({ type: 'thread.started', thread_id: 'thread_1:abc' }),
      '{bad JSON', JSON.stringify({ type: 'error', message: '401 Unauthorized' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'error', message: "You've hit your usage limit." } }),
      failed('401 Unauthorized'), failed('different terminal')].join('\n');
    expect(classifyCodexCliFailure(stdout, 2)).toEqual({ version: 1, exitCode: 2, threadId: 'thread_1:abc', category: 'unknown_native_cli_failure' });
    expect(classifyCodexCliFailure('{bad 401 Unauthorized', 1).category).toBe('unknown_native_cli_failure');
    expect(classifyCodexCliFailure(JSON.stringify({ type: 'error', message: '401 Unauthorized' }), 1).category).toBe('unknown_native_cli_failure');
    expect(classifyCodexCliFailure(JSON.stringify({ type: 'thread.started', thread_id: '/private/path' }), 1)).not.toHaveProperty('threadId');
  });
  test('known failure has stable short message, unknown never includes stdout', async () => {
    const error = await backend(capturingRunner(commandResult({ exitCode: 1, stdout: failed("You've hit your usage limit. cf-ray private-sentinel"), stderr: 'private-sentinel' })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'Codex CLI terminou com exit 1 [usage_limit_exceeded].', nativeCliFailure: { version: 1, category: 'usage_limit_exceeded', exitCode: 1 } });
    expect(JSON.stringify(error)).not.toContain('private-sentinel');
    await expect(backend(capturingRunner(commandResult({ exitCode: 1, stdout: failed('private-sentinel') })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/^Codex CLI terminou com exit 1$/);
  });
  test('wrapped args retain old protocol without json', () => {
    expect(buildCodexExecArgs({ executable: 'codex', model: 'default' }, ROOT, 'p', true))
      .toEqual(['exec', '-c', 'sandbox_mode=workspace-write', '-c', 'approval_policy=never', ...codexAgentIsolationArgs({ executable: 'codex', model: 'default' }), 'p']);
  });
});

describe('fronteira do agente Codex (E2)', () => {
  const base = { executable: 'codex', model: 'default' } as const;
  test('ignora config pessoal e regras, desliga as ferramentas nativas fora do sandbox e a busca web', () => {
    const args = codexAgentIsolationArgs(base, 'linux');
    expect(args.slice(0, 2)).toEqual(['--ignore-user-config', '--ignore-rules']);
    for (const feature of ['view_image', 'apps', 'plugins', 'browser_use', 'computer_use', 'hooks', 'multi_agent']) {
      const index = args.indexOf(feature);
      expect(index).toBeGreaterThan(0);
      expect(args[index - 1]).toBe('--disable');
    }
    expect(CODEX_AGENT_DISABLED_FEATURES).toContain('view_image');
    expect(args).toEqual(expect.arrayContaining(['-c', 'web_search="disabled"']));
    expect(args.some(arg => arg.startsWith('windows.sandbox'))).toBe(false);
  });
  test('no Windows nativo declara windows.sandbox (o config pessoal é ignorado); com WSL ou Linux não', () => {
    expect(codexAgentIsolationArgs(base, 'win32')).toEqual(expect.arrayContaining(['windows.sandbox="elevated"']));
    expect(codexAgentIsolationArgs({ ...base, windowsSandbox: 'unelevated' }, 'win32')).toEqual(expect.arrayContaining(['windows.sandbox="unelevated"']));
    expect(codexAgentIsolationArgs({ ...base, wsl: { distro: 'd', user: 'u', wslExecutable: 'w' } as never }, 'win32').some(arg => arg.startsWith('windows.sandbox'))).toBe(false);
  });
  test('ANIMA_CODEX_WINDOWS_SANDBOX valida o valor (fail-closed)', () => {
    expect(resolveCodexCliConfig(null, { ANIMA_CODEX_WINDOWS_SANDBOX: 'Unelevated' })).toMatchObject({ ok: true, value: { windowsSandbox: 'unelevated' } });
    expect(resolveCodexCliConfig(null, { ANIMA_CODEX_WINDOWS_SANDBOX: 'off' })).toMatchObject({ ok: false });
  });
});

test('wrapped Codex keeps legacy failure format and stdout protocol', async () => {
  const { run, calls } = capturingRunner(commandResult({ exitCode: 1, stdout: 'legacy diagnostic' }));
  const wrapped = new CodexCliCoderBackend({ config: { executable: 'fake', model: 'default' }, run,
    aiMemory: { executable: 'ai-memory', serverUrl: 'http://127.0.0.1:1234', dataDir: 'fixture', workstream: { mode: 'new', name: 'fixture' } },
    aiMemoryProbe: async () => true });
  const error = await wrapped.edit(editRequest(), workspace(ROOT), new AbortController().signal).catch((e: unknown) => e);
  expect(error).toMatchObject({ message: 'Codex CLI (via ai-memory) terminou com exit 1: legacy diagnostic' });
  expect(error).not.toHaveProperty('nativeCliFailure');
  expect(calls[0]!.args).not.toContain('--json');
  const isolation = codexAgentIsolationArgs({ executable: 'codex', model: 'default' });
  expect(calls[0]!.args.slice(-(5 + isolation.length + 1), -1)).toEqual(['exec', '-c', 'sandbox_mode=workspace-write', '-c', 'approval_policy=never', ...isolation]);
});
test('exit zero ignores terminal-looking stdout and does not expose a native cause', async () => {
  const result = await backend(capturingRunner(commandResult({ stdout: JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }) })).run)
    .edit(editRequest(), workspace(ROOT), new AbortController().signal);
  expect(result).not.toHaveProperty('nativeCliFailure');
  expect(result.touchedResources).toEqual([]);
  expect(result.notes).toEqual(['turn-outcome:exited-0', 'duration-s:1']);
});


describe('Codex coder WSL opt-in', () => {
  const env = { ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex', SystemRoot: 'C:/Windows', OPENAI_API_KEY: 'secret', WSLENV: 'OPENAI_API_KEY/u' };
  const config = () => { const r = resolveCodexCliConfig('default', env, 'win32'); if (!r.ok) throw Error(r.error); return r.value; };
  test('translates a drive path with spaces, scrubs keys and preserves execution bounds', async () => {
    const captured = provingRunner(); const controller = new AbortController();
    await new CodexCliCoderBackend({ config: config(), run: captured.run, environmentSource: env }).edit(editRequest(), workspace('G:/anima/work tree'), controller.signal);
    const call = captured.execCalls()[0]!;
    expect(call.file.toLowerCase()).toContain('wsl.exe');
    expect(call.args).toEqual(expect.arrayContaining(['Ubuntu-24.04', 'geanteco', '/mnt/g/anima/work tree', 'approval_policy=never', '--json', '-u', 'OPENAI_API_KEY']));
    expect(call.args).not.toContain('workspace-write');
    expect(call.args).not.toContain('--sandbox');
    expect(call.options).toMatchObject({ cwd: 'G:/anima/work tree', signal: controller.signal });
    expect(call.options.timeoutMs).toBeGreaterThan(0);
    expect(call.options.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(call.options.env).not.toHaveProperty('WSLENV');
  });
  test('rejects UNC and traversal before launch', async () => {
    for (const root of ['//server/share/tree', 'G:/anima/../outside']) {
      const captured = provingRunner();
      await expect(new CodexCliCoderBackend({ config: config(), run: captured.run }).edit(editRequest(), workspace(root), new AbortController().signal)).rejects.toThrow('traduz');
      expect(captured.calls).toHaveLength(0);
    }
  });
  test('abort before launch does not spawn; cancellation and timeout are not success', async () => {
    const controller = new AbortController(); controller.abort(); const captured = provingRunner();
    const coder = new CodexCliCoderBackend({ config: config(), run: captured.run });
    await expect(coder.edit(editRequest(), workspace('G:/tree'), controller.signal)).rejects.toThrow('cancelad');
    expect(captured.calls).toHaveLength(0);
    for (const result of [commandResult({ cancelled: true }), commandResult({ timedOut: true })]) {
      await expect(new CodexCliCoderBackend({ config: config(), run: provingRunner(result).run }).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow();
    }
  });
  test('invalid configuration never falls back to native', () => {
    expect(resolveCodexCliConfig(null, env, 'linux').ok).toBe(false);
    expect(resolveCodexCliConfig(null, { ...env, ANIMA_CODEX_WSL_USER: '' }, 'win32').ok).toBe(false);
  });
});


test('WSL forwards an in-flight abort to the existing process runner', async () => {
  const cfg = resolveCodexCliConfig('default', { ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex' }, 'win32');
  if (!cfg.ok) throw Error(cfg.error);
  const controller = new AbortController();
  const run: CodexCliProcessRunner = async (_file, _args, options) => {
    expect(options.signal).toBe(controller.signal);
    await new Promise<void>(resolve => { options.signal!.addEventListener('abort', () => resolve(), { once: true }); queueMicrotask(() => controller.abort()); });
    return commandResult({ cancelled: true });
  };
  await expect(new CodexCliCoderBackend({ config: cfg.value, run }).edit(editRequest(), workspace('G:/tree'), controller.signal)).rejects.toThrow('cancelado');
});


describe('Single-Item exige assinatura antes de cada edit', () => {
  const env = { ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex' };
  const config = () => { const c = resolveCodexCliConfig('default', env, 'win32'); if (!c.ok) throw Error(c.error); return c.value; };
  test('login e coding usam mesmo WSL; aprovação never, sandbox e cancelamento preservados', async () => {
    const { run, calls, execCalls } = provingRunner();
    const coder = new CodexCliCoderBackend({ config: config(), run, requireSubscription: true });
    const signal = new AbortController().signal;
    await coder.edit(editRequest(), workspace('G:/tree'), signal);
    await coder.edit(editRequest(), workspace('G:/tree'), signal);
    // por turno: login, versão, canário, agente
    expect(calls).toHaveLength(8);
    expect(calls[0]!.args).toContain('status'); expect(calls[4]!.args).toContain('status');
    expect(execCalls()).toHaveLength(2);
    expect(execCalls()[0]!.args).toEqual(expect.arrayContaining(['approval_policy=never', '/mnt/g/tree']));
    expect(calls.every(c => c.options.signal === signal)).toBe(true);
  });
  test.each(['API key', 'unknown'])('recusa %s antes de coding', async stdout => {
    const run = jest.fn(async () => commandResult({stdout}));
    await expect(new CodexCliCoderBackend({config:config(),run,requireSubscription:true}).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('authentication_unproved');
    expect(run).toHaveBeenCalledTimes(1);
  });
  test('timeout de autenticação não inicia coding ou fallback', async () => {
    const run = jest.fn(async () => commandResult({timedOut:true}));
    await expect(new CodexCliCoderBackend({config:config(),run,requireSubscription:true}).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('authentication_unproved');
    expect(run).toHaveBeenCalledTimes(1);
  });
  test('runtime Windows, modelo ou perfil alternativo recusados sem processo', async () => {
    for (const cfg of [{executable:'codex',model:'default'}, {...config(),model:'other'}, {...config(),profile:'other'}]) {
      const run = jest.fn();
      await expect(new CodexCliCoderBackend({config:cfg,run,requireSubscription:true}).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('contract_invalid');
      expect(run).not.toHaveBeenCalled();
    }
  });
});


test('pré-voo de assinatura respeita o deadline da attempt e não spawna após expiração', async () => {
  const cfg=resolveCodexCliConfig('default',{ANIMA_CODEX_CLI_TRANSPORT:'wsl',ANIMA_CODEX_WSL_DISTRO:'Ubuntu-24.04',ANIMA_CODEX_WSL_USER:'geanteco',ANIMA_CODEX_WSL_CLI_PATH:'/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex'},'win32');
  if(!cfg.ok)throw Error(cfg.error);
  const run=jest.fn<ReturnType<CodexCliProcessRunner>, Parameters<CodexCliProcessRunner>>(async()=>commandResult({stdout:'unknown'}));
  const coder=new CodexCliCoderBackend({config:cfg.value,run,requireSubscription:true});
  await expect(coder.edit(editRequest({deadlineAtMs:Date.now()-1}),workspace('G:/tree'),new AbortController().signal)).rejects.toThrow('deadline');
  expect(run).not.toHaveBeenCalled();
  await expect(coder.edit(editRequest({deadlineAtMs:Date.now()+500}),workspace('G:/tree'),new AbortController().signal)).rejects.toThrow('authentication_unproved');
  expect(run.mock.calls[0]![2].timeoutMs).toBeLessThanOrEqual(500);
});


describe('Codex WSL — perfil nativo de permissões (L1)', () => {
  const CLI = '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex';
  const wslEnv = { ANIMA_CODEX_CLI_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: 'Ubuntu-24.04', ANIMA_CODEX_WSL_USER: 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: CLI, SystemRoot: 'C:/Windows' };
  const wslConfig = () => { const r = resolveCodexCliConfig('default', wslEnv, 'win32'); if (!r.ok) throw Error(r.error); return r.value; };
  const ROOT_LINUX = '/mnt/g/tree';
  const DEPS = ['/mnt/g/anima/node_modules', '/mnt/g/anima/apps/web/node_modules'];
  const configValues = (args: readonly string[]) => args.filter((_, i) => args[i - 1] === '-c');
  const permissionValues = (args: readonly string[]) => configValues(args).filter(value => value.includes('permissions'));

  test('direto: perfil nativo por -c, sem --sandbox nem sandbox_mode; leitura só toolchain+deps, escrita só worktree, rede negada', () => {
    const args = buildCodexExecArgs(wslConfig(), ROOT_LINUX, 'p', false, DEPS);
    expect(args).not.toContain('--sandbox');
    expect(args.join(' ')).not.toContain('sandbox_mode');
    expect(args.join(' ')).not.toContain('workspace-write');
    const values = configValues(args);
    expect(values).toContain('default_permissions="anima_single_item"');
    expect(values).toContain('permissions.anima_single_item.filesystem={":minimal"="read", "/home/geanteco/.nvm/versions/node/v22.23.3"="read", "/mnt/g/anima/node_modules"="read", "/mnt/g/anima/apps/web/node_modules"="read", "/mnt/g/tree"="write"}');
    expect(values).toContain('permissions.anima_single_item.network.enabled=false');
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--cd', ROOT_LINUX, '--json']));
  });
  test('resume (wrap) carrega o MESMO perfil, também só por -c', () => {
    const direct = permissionValues(buildCodexExecArgs(wslConfig(), ROOT_LINUX, 'p', false, DEPS));
    const wrapped = buildCodexExecArgs(wslConfig(), ROOT_LINUX, 'p', true, DEPS);
    expect(permissionValues(wrapped)).toEqual(direct);
    expect(direct).toHaveLength(3);
    expect(wrapped).not.toContain('--sandbox');
    expect(wrapped.join(' ')).not.toContain('sandbox_mode');
    expect(wrapped).toEqual(expect.arrayContaining(['--ignore-user-config', '--disable', 'view_image']));
  });
  test('transportes não-WSL permanecem inalterados (sandbox legado)', () => {
    const native = buildCodexExecArgs({ executable: 'codex', model: CODEX_CLI_DEFAULT_MODEL }, ROOT, 'p', false, DEPS);
    expect(native).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']));
    expect(native.join(' ')).not.toContain('default_permissions');
  });
  test.each([
    ['toolchain raso', '/home/geanteco/bin/codex'],
    ['toolchain em /mnt', '/mnt/c/tools/node/v1/bin/codex'],
    ['toolchain no CODEX_HOME', '/home/geanteco/.codex/pkg/v1/bin/codex'],
    ['sem /bin/codex', '/home/geanteco/.nvm/versions/node/v22/lib/codex'],
  ])('falha fechado: %s', (_name, cli) => {
    const cfg = { ...wslConfig(), wsl: { ...wslConfig().wsl!, cliPath: cli } };
    expect(() => buildCodexExecArgs(cfg, ROOT_LINUX, 'p', false, [])).toThrow('toolchain_invalid');
  });
  test.each(['/mnt/g/a	b', '/mnt/g/a"b', '/mnt/g/a\b', '/mnt/g/a/../b', '/mnt/g/a}b={"/"="write"'])('falha fechado: dependência %j não vira TOML', dep => {
    expect(() => buildCodexExecArgs(wslConfig(), ROOT_LINUX, 'p', false, [dep])).toThrow('path_invalid');
  });
  test('worktree inválida também falha fechado', () => {
    expect(() => buildCodexExecArgs(wslConfig(), '/mnt/g/tre"e', 'p', false, [])).toThrow('path_invalid');
  });

  test('turno WSL: versão, canário (mesmo perfil, via codex sandbox), agente; deps do host viram leitura', async () => {
    const { run, calls, execCalls } = provingRunner();
    await new CodexCliCoderBackend({ config: wslConfig(), run }).edit(editRequest(), { ...workspace('G:/tree'), dependencyReadRoots: ['G:/anima/node_modules'] }, new AbortController().signal);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args).toContain('--version');
    const canary = calls[1]!.args;
    expect(canary).toEqual(expect.arrayContaining(['sandbox', '-P', 'anima_single_item', '-C', ROOT_LINUX]));
    expect(canary.join(' ')).not.toContain('default_permissions');
    expect(configValues(canary).find(value => value.includes('.filesystem='))).toContain('"/mnt/g/anima/node_modules"="read"');
    expect(execCalls()[0]!.args.join(' ')).toContain('"/mnt/g/anima/node_modules"="read"');
  });
  test.each(['codex-cli 0.161.9', 'codex-cli 0.163.0', 'codex-cli 1.0.0', 'garbage', ''])('versão %j não suportada: agente não sobe', async version => {
    const { run, execCalls } = provingRunner(commandResult(), { version });
    await expect(new CodexCliCoderBackend({ config: wslConfig(), run }).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('isolation_version_unsupported');
    expect(execCalls()).toHaveLength(0);
  });
  test.each([
    ['vazamento da credencial', { stdout: 'ANIMA_PROFILE_LEAK\n', exitCode: 3 }],
    ['sandbox indisponível', { stdout: '', exitCode: 1 }],
    ['canário sem marcador', { stdout: 'ok', exitCode: 0 }],
    ['marcador e vazamento', { stdout: 'ANIMA_PROFILE_OK ANIMA_PROFILE_LEAK', exitCode: 0 }],
    ['timeout', { stdout: 'ANIMA_PROFILE_OK', exitCode: 0, timedOut: true }],
  ])('canário reprova (%s): agente não sobe', async (_name, canary) => {
    const { run, execCalls } = provingRunner(commandResult(), { canary });
    await expect(new CodexCliCoderBackend({ config: wslConfig(), run }).edit(editRequest(), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('isolation_unproved');
    expect(execCalls()).toHaveLength(0);
  });
  test('dependência do host não traduzível para WSL: recusa antes de qualquer processo', async () => {
    const { run, calls } = provingRunner();
    await expect(new CodexCliCoderBackend({ config: wslConfig(), run }).edit(editRequest(), { ...workspace('G:/tree'), dependencyReadRoots: ['//server/share/node_modules'] }, new AbortController().signal)).rejects.toThrow('path_invalid');
    expect(calls).toHaveLength(0);
  });
  test('prova respeita o deadline: expirado, nenhum processo', async () => {
    const { run, calls } = provingRunner();
    await expect(new CodexCliCoderBackend({ config: wslConfig(), run }).edit(editRequest({ deadlineAtMs: Date.now() - 1 }), workspace('G:/tree'), new AbortController().signal)).rejects.toThrow('deadline');
    expect(calls).toHaveLength(0);
  });
});
