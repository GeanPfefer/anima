/** @jest-environment node */
import { resolve } from 'node:path';
import { resolveExecutorRoute, type ExecutionContract } from './executor-selection';

const contract = (coderBackend: 'claude-code' | 'codex-cli'): ExecutionContract => ({
  executor: 'worktree', coderBackend, model: 'default',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  targetKind: 'project', targetReference: 'anima', resumeCheckpointCommitSha: null,
});
const repoRoot = resolve(__dirname, '../../../..');
const FULL = {
  ANIMA_AI_MEMORY_PATH: 'C:\\aim\\ai-memory.exe', ANIMA_AI_MEMORY_SERVER_URL: 'http://127.0.0.1:49374',
  ANIMA_AI_MEMORY_DATA_DIR: 'G:\\aim\\data', ANIMA_AI_MEMORY_WORKSTREAM: 'prova-xh', ANIMA_AI_MEMORY_WORKSTREAM_MODE: 'new',
};

describe('seleção com ai-memory (opt-in)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test.each(['claude-code', 'codex-cli'] as const)('%s: sem config de ai-memory continua selecionável como antes', kind => {
    for (const key of Object.keys(FULL)) delete process.env[key];
    const selection = resolveExecutorRoute(contract(kind), { repoRoot });
    expect(selection.ok && selection.route.candidate.modelRef).toBe(`${kind}:default`);
  });

  test.each(['claude-code', 'codex-cli'] as const)('%s: config completa seleciona; incompleta falha fechado', kind => {
    Object.assign(process.env, FULL);
    expect(resolveExecutorRoute(contract(kind), { repoRoot }).ok).toBe(true);
    process.env.ANIMA_AI_MEMORY_SERVER_URL = 'http://10.0.0.9:49374';
    expect(resolveExecutorRoute(contract(kind), { repoRoot })).toMatchObject({ ok: false, error: { code: 'coder_backend_invalid' } });
  });

  test('ollama/openai/deepseek não são afetados pela config de ai-memory inválida', () => {
    Object.assign(process.env, FULL, { ANIMA_AI_MEMORY_WORKSTREAM_MODE: 'auto' });
    const selection = resolveExecutorRoute({ ...contract('codex-cli'), coderBackend: 'deepseek-harness', model: 'qwen3-coder:latest' }, { repoRoot });
    expect(selection.ok).toBe(true);
  });
});
