/** @jest-environment node */
import { resolve } from 'node:path';
import { declaredCoderBackendId } from './resource-governor';
import { gateRetryLimitForCoderBackend, resolveExecutorRoute, type ExecutionContract } from './executor-selection';
import type { WorkItem } from '@anima/core';

const codexContract: ExecutionContract = {
  executor: 'worktree',
  coderBackend: 'codex-cli',
  model: 'default',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  targetKind: 'project',
  targetReference: 'anima',
  resumeCheckpointCommitSha: null,
};
const repoRoot = resolve(__dirname, '../../../..');

describe('Codex CLI executor routing (Akita Baseline V1)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('selecionável no fluxo real pela rota de worktree, com identidade codex-cli:<modelo>', () => {
    const selection = resolveExecutorRoute(codexContract, { repoRoot });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.modelRef).toBe('codex-cli:default');
    }
    const pinned = resolveExecutorRoute({ ...codexContract, model: 'gpt-x' }, { repoRoot });
    expect(pinned.ok && pinned.route.candidate.modelRef).toBe('codex-cli:gpt-x');
  });

  test('executável configurado como wrapper de shell falha fechado na seleção', () => {
    process.env.ANIMA_CODEX_CLI_PATH = 'C:\npm\codex.cmd';
    const selection = resolveExecutorRoute(codexContract, { repoRoot });
    expect(selection).toMatchObject({ ok: false, error: { code: 'coder_backend_invalid' } });
  });

  test('defaults intactos: sem coder_backend continua ollama; codex-cli sem retry interno de gate', () => {
    const selection = resolveExecutorRoute({ ...codexContract, coderBackend: null, model: 'qwen3-coder:latest' }, {
      repoRoot, ollamaRuntimeOverride: { url: 'http://127.0.0.1:11434', backendId: 'ollama:qwen3-coder:latest', locality: 'local', nodeId: null },
    });
    expect(selection.ok && selection.route.candidate.modelRef).toBe('ollama:qwen3-coder:latest');
    expect(gateRetryLimitForCoderBackend('codex-cli')).toBe(0);
  });

  test('Resource Governor prevê a mesma identidade que o backend registrará', () => {
    const item = { intent: { execution_spec: { coder_backend: 'codex-cli', model: 'default' } } } as unknown as WorkItem;
    expect(declaredCoderBackendId(item, {})).toBe('codex-cli:default');
  });
});
