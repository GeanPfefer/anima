/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, type WorkExecutorRequest } from '@anima/core';
import { renderCoderTaskSection, type CoderEditRequest, type CoderWorkspace } from './coder-backend';
import {
  CLAUDE_CODE_DEFAULT_MODEL,
  ClaudeCodeCoderBackend,
  buildClaudeCodeArgs,
  buildClaudeCodeEnvironment,
  resolveClaudeCodeConfig,
} from './claude-code-coder';
import { NATIVE_CLI_PROMPT_MAX_CHARS, type NativeCliProcessRunner } from './native-cli-coder';
import { runProcess, type CommandResult } from './worktree';

jest.setTimeout(30_000);

const ROOT = join(tmpdir(), 'anima-claude-fixture-worktree');

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
  readFile: async () => { throw new Error('o backend Claude Code não lê pelo host'); },
  writeFile: async () => { throw new Error('o backend Claude Code não escreve pelo host'); },
  ...(rootPath ? { rootPath } : {}),
});

const SUCCESS_JSON = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 7, result: `editei ${ROOT}`, modelUsage: { 'claude-test-model': { inputTokens: 1 } } });

const commandResult = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  command: 'claude', exitCode: 0, stdout: SUCCESS_JSON, stderr: '', durationMs: 1200, timedOut: false, cancelled: false, ...overrides,
});

interface Captured { file: string; args: readonly string[]; options: Parameters<NativeCliProcessRunner>[2] }
const capturingRunner = (result: CommandResult = commandResult()): { run: NativeCliProcessRunner; calls: Captured[] } => {
  const calls: Captured[] = [];
  return { calls, run: async (file, args, options) => { calls.push({ file, args, options }); return result; } };
};

const backend = (run: NativeCliProcessRunner, env: Record<string, string | undefined> = { PATH: '/usr/bin' }, model = CLAUDE_CODE_DEFAULT_MODEL) =>
  new ClaudeCodeCoderBackend({ config: { executable: 'claude-native', model }, run, environmentSource: env });

const EXPECTED_FLAGS = [
  '-p', '--output-format', 'json', '--no-session-persistence', '--restricted',
  '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
  '--allowedTools', 'Bash(npm test:*),Bash(npm run typecheck:*),Bash(git status:*),Bash(git diff:*)',
  '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
];

describe('ClaudeCodeCoderBackend — lançamento determinístico', () => {
  test('exige workspace.rootPath: sem worktree enraizada falha fechado e não spawna', async () => {
    const { run, calls } = capturingRunner();
    await expect(backend(run).edit(editRequest(), workspace(), new AbortController().signal)).rejects.toThrow(/rootPath ausente/);
    expect(calls).toHaveLength(0);
  });

  test('cwd é exatamente a worktree, sem shell, com -p restrito, acceptEdits e prompts negados', async () => {
    const { run, calls } = capturingRunner();
    await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.file).toBe('claude-native');
    expect(call!.options.cwd).toBe(ROOT);
    expect(call!.args.slice(0, EXPECTED_FLAGS.length)).toEqual(EXPECTED_FLAGS);
    // Modelo default ⇒ o Claude Code usa o próprio config; nenhum `--model` inventado.
    expect(call!.args).not.toContain('--model');
    // Nunca ignora permissões nem retoma sessão.
    expect(call!.args.join(' ')).not.toMatch(/dangerously|bypassPermissions|--resume|--continue/);
    expect(call!.options).not.toHaveProperty('shell');
  });

  test('CoderTaskSpecV1 aparece INTEGRALMENTE na instrução (último argumento), com includes/excludes e regras', async () => {
    const { run, calls } = capturingRunner();
    const req = editRequest();
    await backend(run).edit(req, workspace(ROOT), new AbortController().signal);
    const prompt = calls[0]!.args.at(-1)!;
    expect(prompt).toContain(renderCoderTaskSection(req)!);
    expect(prompt).toContain('- src/added.ts');
    expect(prompt).toContain('- src/other.ts');
    expect(prompt).toMatch(/Não faça commit, push, merge/);
    expect(prompt).toMatch(/A validação final, o commit e a integração são do host/);
    // A opção imediatamente anterior à instrução é de valor único (variádica não a engole).
    expect(calls[0]!.args.at(-3)).toBe('--permission-prompts');
  });

  test('modelo explícito vira --model antes da instrução; config recusa wrapper de shell', () => {
    expect(buildClaudeCodeArgs({ executable: 'claude', model: 'opus' }, 'p').slice(-3)).toEqual(['--model', 'opus', 'p']);
    expect(resolveClaudeCodeConfig(null, {})).toEqual({ ok: true, value: { executable: 'claude', model: CLAUDE_CODE_DEFAULT_MODEL } });
    expect(resolveClaudeCodeConfig('opus', { ANIMA_CLAUDE_CODE_PATH: ' C:\\bin\\claude.exe ', ANIMA_CLAUDE_CODE_MODEL: 'ignored' }))
      .toEqual({ ok: true, value: { executable: 'C:\\bin\\claude.exe', model: 'opus' } });
    expect(resolveClaudeCodeConfig(null, { ANIMA_CLAUDE_CODE_MODEL: 'sonnet' })).toMatchObject({ ok: true, value: { model: 'sonnet' } });
    for (const wrapper of ['claude.cmd', 'C:\\npm\\claude.CMD', 'claude.bat', 'claude.ps1']) {
      expect(resolveClaudeCodeConfig(null, { ANIMA_CLAUDE_CODE_PATH: wrapper })).toMatchObject({ ok: false });
    }
  });

  test('ambiente por allowlist: sistema/config passam; API keys, sessão hospedeira e segredos do ANIMA não', async () => {
    const source = {
      PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\op', CLAUDE_CONFIG_DIR: 'C:\\Users\\op\\.claude',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe', HTTPS_PROXY: 'http://proxy:3128',
      ANTHROPIC_API_KEY: 'sk-ant-secret', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CODE_MESSAGING_TOKEN: 'msg', CLAUDE_CODE_SESSION_ID: 'sess', CLAUDECODE: '1',
      OPENAI_API_KEY: 'sk-live-secret', SUPABASE_SERVICE_ROLE_KEY: 'srk', RUNPOD_API_KEY: 'rp', ANIMA_RESIDENT_PASSWORD: 'pw', EMPTY: '',
    };
    const { run, calls } = capturingRunner();
    await backend(run, source).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.options.env).toEqual({
      PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\op', CLAUDE_CONFIG_DIR: 'C:\\Users\\op\\.claude',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe', HTTPS_PROXY: 'http://proxy:3128', NO_COLOR: '1', DISABLE_AUTOUPDATER: '1',
    });
    expect(buildClaudeCodeEnvironment({ Path: 'x', windir: 'w' })).toEqual({ Path: 'x', windir: 'w', NO_COLOR: '1', DISABLE_AUTOUPDATER: '1' });
  });

  test('exit 0 com envelope success: só "turno terminou", sem arquivos atestados nem caminho no summary', async () => {
    const { run } = capturingRunner();
    const result = await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(result.touchedResources).toEqual([]);
    expect(result.summary).toMatch(/claude-code:default.*exit 0.*validação é dos gates do host/);
    expect(result.summary).not.toContain(ROOT);
    expect(result.notes).toEqual(['turn-outcome:exited-0', 'duration-s:1', 'result-subtype:success', 'num-turns:7', 'model:claude-test-model']);
    expect(JSON.stringify(result.notes)).not.toContain(ROOT);
  });

  test('exit 0 com erro declarado no envelope (is_error / subtype≠success) falha fechado', async () => {
    for (const stdout of [
      JSON.stringify({ type: 'result', subtype: 'success', is_error: true }),
      JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false }),
    ]) {
      await expect(backend(capturingRunner(commandResult({ stdout })).run).edit(editRequest(), workspace(ROOT), new AbortController().signal))
        .rejects.toThrow(/Claude Code encerrou o turno em erro/);
    }
  });

  test('envelope ilegível com exit 0 não inventa sucesso nem erro: o host julga pelo git/gates', async () => {
    const result = await backend(capturingRunner(commandResult({ stdout: 'texto livre' })).run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(result.notes).toContain('result-envelope:unparsed');
  });

  test('exit não-zero falha fechado com diagnóstico sanitizado e limitado', async () => {
    const noisy = [
      ...Array.from({ length: 50 }, (_, i) => `linha de ruído ${i} ${'x'.repeat(80)}`),
      `erro em ${ROOT}\\src\\added.ts`,
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'api_key=sk-ant-123456',
    ].join('\n');
    const { run } = capturingRunner(commandResult({ exitCode: 1, stdout: '', stderr: noisy }));
    const error = await backend(run).edit(editRequest(), workspace(ROOT), new AbortController().signal).then(() => null, (e: unknown) => e as Error);
    if (!(error instanceof Error)) throw new Error('esperava falha');
    expect(error.message).toMatch(/^Claude Code terminou com exit 1: /);
    expect(error.message).not.toContain(ROOT);
    expect(error.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(error.message).not.toContain('sk-ant-123456');
    expect(error.message.length).toBeLessThan(800);
  });

  test('timeout pelo deadline lança [runner_timeout]; cancelamento lança; deadline esgotado não spawna', async () => {
    await expect(backend(capturingRunner(commandResult({ timedOut: true, exitCode: -1 })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/^\[runner_timeout\] Claude Code/);
    await expect(backend(capturingRunner(commandResult({ cancelled: true, exitCode: -1 })).run)
      .edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/cancelado pelo host/);
    const { run, calls } = capturingRunner();
    await backend(run).edit(editRequest({ deadlineAtMs: Date.now() + 5_000 }), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.options.timeoutMs).toBeGreaterThan(4_000);
    expect(calls[0]!.options.timeoutMs).toBeLessThanOrEqual(5_000);
    await expect(backend(run).edit(editRequest({ deadlineAtMs: Date.now() - 1 }), workspace(ROOT), new AbortController().signal))
      .rejects.toThrow(/\[runner_timeout\].*não iniciado/);
    expect(calls).toHaveLength(1);
  });

  test('instrução acima do teto de linha de comando falha fechado antes de spawnar', async () => {
    const { run, calls } = capturingRunner();
    const huge = editRequest({ taskSpec: undefined, objective: 'x'.repeat(NATIVE_CLI_PROMPT_MAX_CHARS + 1) });
    await expect(backend(run).edit(huge, workspace(ROOT), new AbortController().signal)).rejects.toThrow(/excede/);
    expect(calls).toHaveLength(0);
  });
});

// Processo REAL (sem Claude): o executável falso é o node rodando um script gerado, lançado
// pelo mesmo `runProcess` (sem shell, taskkill da árvore no Windows) da produção.
describe('ClaudeCodeCoderBackend — processo falso real', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'anima-claude-fake-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const fakeRunner = (script: string): NativeCliProcessRunner =>
    (_file, args, options) => runProcess(process.execPath, [script, ...args], options);
  const baseEnv = () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot });

  test('o filho roda com cwd = worktree, recebe a instrução e não vê segredos', async () => {
    const root = await mkdtemp(join(dir, 'wt-'));
    const record = join(dir, 'record.json');
    const script = join(dir, 'record.js');
    await writeFile(script, `require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: Object.keys(process.env) })); process.stdout.write(${JSON.stringify(SUCCESS_JSON)});`);
    const result = await backend(fakeRunner(script), { ...baseEnv(), ANTHROPIC_API_KEY: 'sk-ant-nao', CLAUDE_CODE_OAUTH_TOKEN: 'nao' })
      .edit(editRequest(), workspace(root), new AbortController().signal);
    expect(result.notes).toContain('result-subtype:success');
    const seen = JSON.parse(await readFile(record, 'utf8')) as { cwd: string; args: string[]; env: string[] };
    expect(seen.cwd.toLowerCase()).toBe(root.toLowerCase());
    expect(seen.args.at(-1)).toContain(renderCoderTaskSection(editRequest())!);
    const names = seen.env.map(name => name.toUpperCase());
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  test('deadline encerra o processo pendurado', async () => {
    const script = join(dir, 'hang.js');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const started = Date.now();
    await expect(backend(fakeRunner(script), baseEnv())
      .edit(editRequest({ deadlineAtMs: Date.now() + 800 }), workspace(dir), new AbortController().signal)).rejects.toThrow(/\[runner_timeout\]/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test('cancelamento do host encerra o processo pendurado', async () => {
    const script = join(dir, 'hang2.js');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 400);
    const started = Date.now();
    await expect(backend(fakeRunner(script), baseEnv())
      .edit(editRequest(), workspace(dir), controller.signal)).rejects.toThrow(/cancelado pelo host/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test('exit não-zero real falha fechado', async () => {
    const script = join(dir, 'fail.js');
    await writeFile(script, "console.error('Not logged in · Please run /login'); process.exit(1);");
    await expect(backend(fakeRunner(script), baseEnv())
      .edit(editRequest(), workspace(dir), new AbortController().signal)).rejects.toThrow(/exit 1: Not logged in/);
  });
});
