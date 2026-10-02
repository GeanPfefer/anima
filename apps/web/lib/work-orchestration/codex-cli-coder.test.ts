/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, type WorkExecutorRequest } from '@anima/core';
import { renderCoderTaskSection, type CoderEditRequest, type CoderWorkspace } from './coder-backend';
import {
  CODEX_CLI_DEFAULT_MODEL,
  CODEX_CLI_PROMPT_MAX_CHARS,
  CodexCliCoderBackend,
  buildCodexCliEnvironment,
  buildCodexExecArgs,
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
      .toEqual(['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', ROOT, '--model', 'gpt-x', '--profile', 'anima', 'p']);
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
