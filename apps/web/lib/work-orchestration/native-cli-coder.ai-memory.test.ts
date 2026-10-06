/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, recoveryFailureCode, type WorkExecutorRequest } from '@anima/core';
import { renderCoderTaskSection, type CoderEditRequest, type CoderWorkspace } from './coder-backend';
import { CLAUDE_CODE_DEFAULT_MODEL, ClaudeCodeCoderBackend, buildClaudeCodeArgs } from './claude-code-coder';
import { CODEX_CLI_DEFAULT_MODEL, CodexCliCoderBackend, buildCodexExecArgs } from './codex-cli-coder';
import {
  aiMemoryTurnNotes,
  buildAiMemoryRunArgs,
  resolveAiMemoryWrapConfig,
  type AiMemoryWrapConfig,
  type NativeCliProcessRunner,
} from './native-cli-coder';
import { runProcess, type CommandResult } from './worktree';

jest.setTimeout(30_000);

const ROOT = join(tmpdir(), 'anima-aimem-fixture-worktree');
const CLAUDE_EXE = 'C:\\claude\\claude.exe';
const CODEX_EXE = 'C:\\codex\\codex.exe';
const AIM_EXE = 'C:\\aim\\ai-memory.exe';

const criteria: WorkExecutorRequest['validationCriteria'] = [{ label: 'testes', command: 'npm test -- src/added.test.ts', covers: ['aceite-1'] }];
const taskSpec = buildCoderTaskSpec({
  workItemId: 'item-1', approvedProposalVersion: 1,
  proposal: { summary: 'Parte A', objective: 'Fazer a parte A', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], expectedEffects: ['a'], risks: [] },
  spec: { validationCriteria: criteria }, verifierRequirement: 'advisory', contextReferences: [],
});
const editRequest = (overrides: Partial<CoderEditRequest> = {}): CoderEditRequest => ({
  objective: 'Fazer a parte A', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], taskSpec,
  validationCommands: [{ label: 'testes', program: 'npm', args: ['test', '--', 'src/added.test.ts'] }],
  deadlineAtMs: Date.now() + 60_000, ...overrides,
});
const workspace = (rootPath: string): CoderWorkspace => ({
  readFile: async () => null, writeFile: async () => false, rootPath,
});

const SUCCESS_JSON = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2 });
const result = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  command: 'x', exitCode: 0, stdout: SUCCESS_JSON, durationMs: 1000, timedOut: false, cancelled: false,
  stderr: 'INFO ai_memory_cli: ai-memory starting version="2.4.1" server_url=http://127.0.0.1:49374\nai-memory: workstream \'prova-xh\' saved 12 new event(s)\n',
  ...overrides,
});
interface Captured { file: string; args: readonly string[]; options: Parameters<NativeCliProcessRunner>[2] }
const capturing = (value: CommandResult = result()) => {
  const calls: Captured[] = [];
  const run: NativeCliProcessRunner = async (file, args, options) => { calls.push({ file, args, options }); return value; };
  return { run, calls };
};
const up = async () => true;
const down = async () => false;

let settingsFile: string;
let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'anima-aimem-'));
  settingsFile = join(tmp, 'claude-ai-memory-hooks.json');
  await writeFile(settingsFile, '{"hooks":{}}');
});
afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

const wrapConfig = (mode: 'new' | 'continue' = 'new', extra: Partial<AiMemoryWrapConfig> = {}): AiMemoryWrapConfig => ({
  executable: AIM_EXE, serverUrl: 'http://127.0.0.1:49374', dataDir: 'G:\\aim\\data', workstream: { mode, name: 'prova-xh' },
  claudeSettingsFile: settingsFile, ...extra,
});
const ENV_SOURCE = {
  PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\op', CODEX_HOME: 'G:\\homes\\codex',
  OPENAI_API_KEY: 'sk-nao', ANTHROPIC_API_KEY: 'sk-ant-nao', SUPABASE_SERVICE_ROLE_KEY: 'srk', AI_MEMORY_AUTH_TOKEN: 'nao-copiar',
};
const claude = (run: NativeCliProcessRunner, aiMemory?: AiMemoryWrapConfig, probe = up) =>
  new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: CLAUDE_CODE_DEFAULT_MODEL }, run, environmentSource: ENV_SOURCE, ...(aiMemory ? { aiMemory, aiMemoryProbe: probe } : {}) });
const codex = (run: NativeCliProcessRunner, aiMemory?: AiMemoryWrapConfig, probe = up, profile?: string) =>
  new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: CODEX_CLI_DEFAULT_MODEL, ...(profile ? { profile } : {}) }, run, environmentSource: ENV_SOURCE, ...(aiMemory ? { aiMemory, aiMemoryProbe: probe } : {}) });

const RUN_PREFIX = (mode: 'new' | 'continue', nativeExe: string, harness: string) => [
  'run', '--no-autowire', '--workspace', 'anima', '--project', 'anima',
  mode === 'new' ? '--new' : '--workstream', 'prova-xh', '--executable', nativeExe, harness,
];

describe('resolveAiMemoryWrapConfig — opt-in, default desligado, fail-closed se incompleto', () => {
  const full = {
    ANIMA_AI_MEMORY_PATH: AIM_EXE, ANIMA_AI_MEMORY_SERVER_URL: 'http://127.0.0.1:49374/', ANIMA_AI_MEMORY_DATA_DIR: 'G:\\aim\\data',
    ANIMA_AI_MEMORY_WORKSTREAM: 'prova-xh', ANIMA_AI_MEMORY_WORKSTREAM_MODE: 'new', ANIMA_AI_MEMORY_CLAUDE_SETTINGS: 'G:\\aim\\hooks.json',
  };
  test('sem ANIMA_AI_MEMORY_PATH ⇒ desligado (null), mesmo com outros campos', () => {
    expect(resolveAiMemoryWrapConfig({})).toEqual({ ok: true, value: null });
    expect(resolveAiMemoryWrapConfig({ ...full, ANIMA_AI_MEMORY_PATH: '  ' })).toEqual({ ok: true, value: null });
  });
  test('completo ⇒ config normalizada', () => {
    expect(resolveAiMemoryWrapConfig(full)).toEqual({ ok: true, value: {
      executable: AIM_EXE, serverUrl: 'http://127.0.0.1:49374', dataDir: 'G:\\aim\\data',
      workstream: { mode: 'new', name: 'prova-xh' }, claudeSettingsFile: 'G:\\aim\\hooks.json',
    } });
  });
  test.each([
    ['wrapper de shell', { ANIMA_AI_MEMORY_PATH: 'C:\\aim\\ai-memory.cmd' }],
    ['servidor não loopback', { ANIMA_AI_MEMORY_SERVER_URL: 'http://10.0.0.5:49374' }],
    ['servidor https/externo', { ANIMA_AI_MEMORY_SERVER_URL: 'https://memory.example.com' }],
    ['sem data dir', { ANIMA_AI_MEMORY_DATA_DIR: '' }],
    ['sem workstream', { ANIMA_AI_MEMORY_WORKSTREAM: '' }],
    ['workstream inválido', { ANIMA_AI_MEMORY_WORKSTREAM: 'a b;c' }],
    ['modo inválido', { ANIMA_AI_MEMORY_WORKSTREAM_MODE: 'auto' }],
  ])('%s ⇒ falha fechado', (_label, patch) => {
    expect(resolveAiMemoryWrapConfig({ ...full, ...patch })).toMatchObject({ ok: false });
  });
});

describe('wrap desligado: lançamento direto idêntico ao comportamento atual', () => {
  test('Claude: mesmos args de sempre, com --no-session-persistence e sem --settings', async () => {
    const { run, calls } = capturing();
    await claude(run).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.file).toBe(CLAUDE_EXE);
    expect(calls[0]!.args).toEqual([
      '-p', '--output-format', 'json', '--no-session-persistence', '--restricted',
      '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
      '--allowedTools', 'Bash(npm test:*),Bash(npm run typecheck:*),Bash(git status:*),Bash(git diff:*)',
      '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', calls[0]!.args.at(-1),
    ]);
    expect(Object.keys(calls[0]!.options.env ?? {}).filter(k => k.startsWith('AI_MEMORY'))).toEqual([]);
  });
  test('Codex: --json no caminho direto, preservando --sandbox/--cd e modelo/perfil', async () => {
    const { run, calls } = capturing();
    const req = editRequest();
    await codex(run).edit(req, workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.file).toBe(CODEX_EXE);
    expect(calls[0]!.options.cwd).toBe(ROOT);
    expect(Object.keys(calls[0]!.options.env ?? {}).filter(k => k.startsWith('AI_MEMORY'))).toEqual([]);
    expect(calls[0]!.args.filter(a => a === '--json')).toEqual(['--json']);
    expect(calls[0]!.args.slice(0, -1).filter(a => a !== '--json')).toEqual(['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', ROOT]);
    expect(calls[0]!.args.at(-1)).toContain(renderCoderTaskSection(req)!);
    const withModelAndProfile = buildCodexExecArgs({ executable: 'c', model: 'm', profile: 'p' }, ROOT, 'x');
    expect(withModelAndProfile.filter(a => a === '--json')).toEqual(['--json']);
    expect(withModelAndProfile.filter(a => a !== '--json'))
      .toEqual(['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', ROOT, '--model', 'm', '--profile', 'p', 'x']);
    expect(withModelAndProfile.at(-1)).toBe('x');
  });
});

test('F: Codex direto ignora item.completed(type=error) sem turn.failed como fonte causal', async () => {
  const providerMessage = "You've hit your usage limit. unexpected status 401 Unauthorized";
  const { run, calls } = capturing(result({
    exitCode: 2,
    stdout: [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread_f:isolado' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'error', message: providerMessage } }),
    ].join('\n'),
    stderr: '',
  }));
  const error: unknown = await codex(run).edit(editRequest(), workspace(ROOT), new AbortController().signal)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: 'Codex CLI terminou com exit 2' });
  expect(error).toHaveProperty('nativeCliFailure', {
    version: 1, category: 'unknown_native_cli_failure', exitCode: 2, threadId: 'thread_f:isolado',
  });
  expect(JSON.stringify(error)).not.toContain(providerMessage);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.file).toBe(CODEX_EXE);
});

describe('wrap Claude', () => {
  test('ai-memory é o processo pai; flags nativas preservadas sem --no-session-persistence e com --settings', async () => {
    const { run, calls } = capturing();
    const req = editRequest();
    const out = await claude(run, wrapConfig('new')).edit(req, workspace(ROOT), new AbortController().signal);
    const call = calls[0]!;
    expect(call.file).toBe(AIM_EXE);
    expect(call.options.cwd).toBe(ROOT);
    const prefix = RUN_PREFIX('new', CLAUDE_EXE, 'claude');
    expect(call.args.slice(0, prefix.length)).toEqual(prefix);
    const native = call.args.slice(prefix.length);
    expect(native).not.toContain('--no-session-persistence');
    expect(native.slice(0, 6)).toEqual(['-p', '--output-format', 'json', '--restricted', '--settings', settingsFile]);
    // Demais flags nativas idênticas às do lançamento direto (sem a de persistência).
    const direct = buildClaudeCodeArgs({ executable: CLAUDE_EXE, model: CLAUDE_CODE_DEFAULT_MODEL }, native.at(-1)!).filter(a => a !== '--no-session-persistence');
    expect(native.filter((a, i) => !(a === '--settings' || native[i - 1] === '--settings'))).toEqual(direct);
    expect(native.at(-1)).toContain(renderCoderTaskSection(req)!);
    // Env: só o adicional necessário; segredos continuam fora (inclusive token do ai-memory).
    expect(call.options.env).toMatchObject({ AI_MEMORY_SERVER_URL: 'http://127.0.0.1:49374', AI_MEMORY_DATA_DIR: 'G:\\aim\\data' });
    for (const secret of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_MEMORY_AUTH_TOKEN']) expect(call.options.env).not.toHaveProperty(secret);
    // Referências, nunca conteúdo.
    expect(out.notes).toEqual(expect.arrayContaining([
      'ai-memory:workstream:prova-xh', 'ai-memory:mode:new', 'ai-memory:harness:claude', 'ai-memory:version:2.4.1', 'ai-memory:saved-events:12',
    ]));
    expect(out.notes!.some(note => note.includes('ESPECIFICAÇÃO') || note.includes(ROOT))).toBe(false);
  });

  test('continue ⇒ --workstream; settings ausente/inexistente ⇒ falha fechado sem spawn', async () => {
    const { run, calls } = capturing();
    await claude(run, wrapConfig('continue')).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    expect(calls[0]!.args.slice(0, 11)).toEqual(RUN_PREFIX('continue', CLAUDE_EXE, 'claude'));
    const { run: run2, calls: calls2 } = capturing();
    const { claudeSettingsFile: _omit, ...withoutSettings } = wrapConfig();
    await expect(claude(run2, withoutSettings).edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/ANIMA_AI_MEMORY_CLAUDE_SETTINGS/);
    await expect(claude(run2, wrapConfig('new', { claudeSettingsFile: join(tmp, 'nao-existe.json') })).edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/ANIMA_AI_MEMORY_CLAUDE_SETTINGS/);
    expect(calls2).toHaveLength(0);
  });
});

describe('wrap Codex', () => {
  test('ai-memory pai; sandbox via -c (compatível com exec resume); sem --sandbox/--cd; approval never', async () => {
    const { run, calls } = capturing(result({ stdout: 'ok' }));
    const out = await codex(run, wrapConfig('continue')).edit(editRequest(), workspace(ROOT), new AbortController().signal);
    const call = calls[0]!;
    expect(call.file).toBe(AIM_EXE);
    expect(call.options.cwd).toBe(ROOT);
    const prefix = RUN_PREFIX('continue', CODEX_EXE, 'codex');
    expect(call.args.slice(0, prefix.length)).toEqual(prefix);
    const native = call.args.slice(prefix.length);
    expect(native.slice(0, -1)).toEqual(['exec', '-c', 'sandbox_mode=workspace-write', '-c', 'approval_policy=never']);
    expect(native).not.toContain('--json');
    for (const flag of ['--sandbox', '-s', '--cd', '-C', '--profile']) expect(native).not.toContain(flag);
    expect(native).not.toContain(ROOT);
    // Simula a reescrita do ai-memory na volta ao Codex: `exec resume <id> <resto>` só com flags que o resume aceita.
    const resumed = ['exec', 'resume', 'codex-id', ...native.slice(1)];
    const RESUME_FLAGS = new Set(['-c', '--config', '--model', '-m']);
    expect(resumed.slice(3, -1).filter(a => a.startsWith('-')).every(a => RESUME_FLAGS.has(a))).toBe(true);
    expect(buildCodexExecArgs({ executable: 'c', model: 'gpt-x' }, ROOT, 'p', true)).toEqual(['exec', '-c', 'sandbox_mode=workspace-write', '-c', 'approval_policy=never', '--model', 'gpt-x', 'p']);
    expect(out.notes).toEqual(expect.arrayContaining(['ai-memory:workstream:prova-xh', 'ai-memory:mode:continue', 'ai-memory:harness:codex']));
  });

  test('perfil explícito com wrap falha fechado (exec resume não aceita --profile)', async () => {
    const { run, calls } = capturing();
    await expect(codex(run, wrapConfig(), up, 'meu-perfil').edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/PROFILE/);
    expect(calls).toHaveLength(0);
  });
});

describe('fail-closed: servidor indisponível e exit ≠ 0', () => {
  test('servidor inacessível ⇒ não spawna (nem ai-memory, nem harness)', async () => {
    const { run, calls } = capturing();
    await expect(claude(run, wrapConfig(), down).edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/servidor ai-memory inacessível/);
    await expect(codex(run, wrapConfig(), down).edit(editRequest(), workspace(ROOT), new AbortController().signal)).rejects.toThrow(/servidor ai-memory inacessível/);
    expect(calls).toHaveLength(0);
  });
  test('ai-memory run com exit ≠ 0 (ex.: lease ativo 409) ⇒ falha fechado com diagnóstico sanitizado', async () => {
    const { run } = capturing(result({ exitCode: 1, stdout: '', stderr: `error: 409 workstream is already active: owned by goma:123 until … at ${ROOT}` }));
    const error = await codex(run, wrapConfig()).edit(editRequest(), workspace(ROOT), new AbortController().signal).then(() => null, (e: unknown) => e as Error);
    if (!(error instanceof Error)) throw new Error('esperava falha');
    expect(error.message).toMatch(/^Codex CLI \(via ai-memory\) terminou com exit 1: .*409 workstream is already active/);
    expect(error.message).not.toContain(ROOT);
  });
  test('notas descartam tokens fora do padrão seguro', () => {
    expect(aiMemoryTurnNotes(wrapConfig(), 'codex', 'ai-memory starting version="2.4.1; rm -rf"')).toEqual([
      'ai-memory:workstream:prova-xh', 'ai-memory:mode:new', 'ai-memory:harness:codex',
    ]);
    expect(buildAiMemoryRunArgs(wrapConfig('continue'), 'codex', CODEX_EXE, ['exec', 'x'])).toEqual([...RUN_PREFIX('continue', CODEX_EXE, 'codex'), 'exec', 'x']);
  });
});

// Processos REAIS (sem ai-memory, sem modelos): `ai-memory` falso = node + script, lançado pelo mesmo
// `runProcess` (sem shell; taskkill /T no Windows) da produção.
describe('processo falso real: árvore ai-memory → harness', () => {
  const fakeRun = (script: string): NativeCliProcessRunner => (_file, args, options) => runProcess(process.execPath, [script, ...args], options);
  const baseEnv = () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot });
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

  /** ai-memory falso: registra a invocação e lança um "harness" filho que fica pendurado. */
  const hangingTree = async (name: string) => {
    const pids = join(tmp, `${name}-pids.json`);
    const child = join(tmp, `${name}-child.js`);
    const parent = join(tmp, `${name}-aim.js`);
    await writeFile(child, 'setInterval(() => {}, 1000);');
    await writeFile(parent, [
      "const { spawn } = require('child_process'); const fs = require('fs');",
      `const c = spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore' });`,
      `fs.writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ parent: process.pid, child: c.pid }));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    return { parent, pids };
  };
  const waitDead = async (pid: number): Promise<boolean> => {
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise(r => setTimeout(r, 100));
    return !alive(pid);
  };

  test('deadline derruba a árvore inteira (ai-memory e harness)', async () => {
    const { parent, pids } = await hangingTree('deadline');
    await expect(new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run: fakeRun(parent), environmentSource: baseEnv(), aiMemory: wrapConfig(), aiMemoryProbe: up })
      .edit(editRequest({ deadlineAtMs: Date.now() + 1_500 }), workspace(tmp), new AbortController().signal)).rejects.toThrow(/\[runner_timeout\]/);
    const seen = JSON.parse(await readFile(pids, 'utf8')) as { parent: number; child: number };
    expect(await waitDead(seen.parent)).toBe(true);
    expect(await waitDead(seen.child)).toBe(true);
  });

  test('cancelamento derruba a árvore inteira', async () => {
    const { parent, pids } = await hangingTree('cancel');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_000);
    await expect(new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: 'default' }, run: fakeRun(parent), environmentSource: baseEnv(), aiMemory: wrapConfig(), aiMemoryProbe: up })
      .edit(editRequest(), workspace(tmp), controller.signal)).rejects.toThrow(/cancelado pelo host/);
    const seen = JSON.parse(await readFile(pids, 'utf8')) as { parent: number; child: number };
    expect(await waitDead(seen.parent)).toBe(true);
    expect(await waitDead(seen.child)).toBe(true);
  });

  // Prova fake cross-harness: SÓ wiring (args/env/cwd), sem simular memória.
  test('Claude (--new) → Codex (--workstream) → Claude (--workstream) na MESMA rootPath', async () => {
    const root = await mkdtemp(join(tmp, 'wt-'));
    const log = join(tmp, 'legs.jsonl');
    const aim = join(tmp, 'aim-recorder.js');
    await writeFile(aim, [
      "const fs = require('fs');",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: Object.keys(process.env).sort() }) + '\\n');`,
      'const harness = process.argv[2 + process.argv.slice(2).indexOf("--executable") + 2];',
      `process.stderr.write('INFO ai_memory_cli: ai-memory starting version="2.4.1"\\n');`,
      `if (harness === 'claude') process.stdout.write(${JSON.stringify(SUCCESS_JSON)});`,
    ].join('\n'));
    const env = { ...baseEnv(), OPENAI_API_KEY: 'sk-nao', ANTHROPIC_API_KEY: 'sk-ant-nao' };
    const legs = [
      new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run: fakeRun(aim), environmentSource: env, aiMemory: wrapConfig('new'), aiMemoryProbe: up }),
      new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: 'default' }, run: fakeRun(aim), environmentSource: env, aiMemory: wrapConfig('continue'), aiMemoryProbe: up }),
      new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run: fakeRun(aim), environmentSource: env, aiMemory: wrapConfig('continue'), aiMemoryProbe: up }),
    ];
    const notes: (readonly string[])[] = [];
    for (const backend of legs) notes.push((await backend.edit(editRequest(), workspace(root), new AbortController().signal)).notes ?? []);

    const seen = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { cwd: string; args: string[]; env: string[] });
    expect(seen).toHaveLength(3);
    // Mesma worktree física nos três legs.
    expect(new Set(seen.map(leg => leg.cwd.toLowerCase()))).toEqual(new Set([root.toLowerCase()]));
    expect(seen.map(leg => leg.args.slice(0, 11))).toEqual([
      RUN_PREFIX('new', CLAUDE_EXE, 'claude'),
      RUN_PREFIX('continue', CODEX_EXE, 'codex'),
      RUN_PREFIX('continue', CLAUDE_EXE, 'claude'),
    ]);
    expect(seen[0]!.args).not.toContain('--no-session-persistence');
    expect(seen[0]!.args).toContain('--settings');
    expect(seen[1]!.args).not.toContain('--cd');
    expect(seen[1]!.args).toContain('sandbox_mode=workspace-write');
    for (const leg of seen) {
      const names = leg.env.map(name => name.toUpperCase());
      expect(names).toEqual(expect.arrayContaining(['AI_MEMORY_SERVER_URL', 'AI_MEMORY_DATA_DIR']));
      expect(names).not.toContain('OPENAI_API_KEY');
      expect(names).not.toContain('ANTHROPIC_API_KEY');
    }
    expect(notes.map(n => n.filter(x => x.startsWith('ai-memory:')))).toEqual([
      ['ai-memory:workstream:prova-xh', 'ai-memory:mode:new', 'ai-memory:harness:claude', 'ai-memory:version:2.4.1'],
      ['ai-memory:workstream:prova-xh', 'ai-memory:mode:continue', 'ai-memory:harness:codex', 'ai-memory:version:2.4.1'],
      ['ai-memory:workstream:prova-xh', 'ai-memory:mode:continue', 'ai-memory:harness:claude', 'ai-memory:version:2.4.1'],
    ]);
  });
});

// Regressão (revisão): o deadline global precisa valer DEPOIS do await do health probe. Se ele
// vencer durante o `GET /healthz`, nem o ai-memory nem o harness podem ser lançados.
describe('deadline global atravessando o health probe do ai-memory', () => {
  const servers: import('node:http').Server[] = [];
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });

  /** `ai-memory serve` falso: `/healthz` responde 200 após `delayMs`. */
  const fakeServer = async (delayMs: number): Promise<string> => {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      setTimeout(() => { res.statusCode = req.url === '/healthz' ? 200 : 404; res.end('ok'); }, delayMs);
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as import('node:net').AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  };
  const withServer = (serverUrl: string) => wrapConfig('new', { serverUrl });

  test('A) deadline válido: probe real responde, ainda há tempo ⇒ lança com o restante RECALCULADO', async () => {
    const serverUrl = await fakeServer(400);
    for (const make of [
      (run: NativeCliProcessRunner) => new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: withServer(serverUrl) }),
      (run: NativeCliProcessRunner) => new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: withServer(serverUrl) }),
    ]) {
      const { run, calls } = capturing();
      const deadlineAtMs = Date.now() + 10_000;
      await make(run).edit(editRequest({ deadlineAtMs }), workspace(ROOT), new AbortController().signal);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.file).toBe(AIM_EXE);
      // O timeout entregue ao processo desconta o tempo gasto no probe (~400 ms).
      expect(calls[0]!.options.timeoutMs).toBeGreaterThan(0);
      expect(calls[0]!.options.timeoutMs).toBeLessThanOrEqual(10_000 - 350);
    }
  });

  test('B) deadline vence DURANTE o probe (servidor responde 200 depois) ⇒ NÃO lança; [runner_timeout]', async () => {
    const serverUrl = await fakeServer(700);
    for (const make of [
      (run: NativeCliProcessRunner) => new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: withServer(serverUrl) }),
      (run: NativeCliProcessRunner) => new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: withServer(serverUrl) }),
    ]) {
      const { run, calls } = capturing();
      const error = await make(run).edit(editRequest({ deadlineAtMs: Date.now() + 250 }), workspace(ROOT), new AbortController().signal)
        .then(() => null, (e: unknown) => e as Error);
      if (!(error instanceof Error)) throw new Error('esperava timeout');
      expect(error.message).toMatch(/^\[runner_timeout\] (Claude Code|Codex CLI) não iniciado: deadline global da tentativa esgotado\.$/);
      // Mesma classificação canônica de recovery do timeout do native CLI.
      expect(recoveryFailureCode({ code: 'execution_failed', safeMessage: `O backend de código falhou: ${error.message}` })).toBe('runner_timeout');
      expect(calls).toHaveLength(0);
    }
  });

  test('C) deadline esgota exatamente ao fim do probe (200) ⇒ NÃO lança; [runner_timeout]', async () => {
    const { run, calls } = capturing();
    const deadlineAtMs = Date.now() + 60_000;
    // Relógio pontual: o probe "termina" exatamente no instante do deadline (restante = 0).
    const probe = async () => { jest.spyOn(Date, 'now').mockReturnValue(deadlineAtMs); return true; };
    const backend = new ClaudeCodeCoderBackend({ config: { executable: CLAUDE_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: wrapConfig(), aiMemoryProbe: probe });
    await expect(backend.edit(editRequest({ deadlineAtMs }), workspace(ROOT), new AbortController().signal))
      .rejects.toThrow(/^\[runner_timeout\] Claude Code não iniciado: deadline global da tentativa esgotado\.$/);
    const codexBackend = new CodexCliCoderBackend({ config: { executable: CODEX_EXE, model: 'default' }, run, environmentSource: ENV_SOURCE, aiMemory: wrapConfig(), aiMemoryProbe: probe });
    jest.restoreAllMocks();
    await expect(codexBackend.edit(editRequest({ deadlineAtMs }), workspace(ROOT), new AbortController().signal))
      .rejects.toThrow(/^\[runner_timeout\] Codex CLI não iniciado/);
    expect(calls).toHaveLength(0);
  });

  test('D) wrap OFF: nenhum health probe (nenhum fetch) e lançamento direto inalterado', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { run, calls } = capturing();
    await claude(run).edit(editRequest({ deadlineAtMs: Date.now() + 5_000 }), workspace(ROOT), new AbortController().signal);
    await codex(run).edit(editRequest({ deadlineAtMs: Date.now() + 5_000 }), workspace(ROOT), new AbortController().signal);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.map(call => call.file)).toEqual([CLAUDE_EXE, CODEX_EXE]);
    for (const call of calls) {
      expect(call.options.timeoutMs).toBeGreaterThan(4_000);
      expect(call.options.timeoutMs).toBeLessThanOrEqual(5_000);
    }
  });
});
