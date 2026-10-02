/** @jest-environment node */
import { resolve } from 'node:path';
import { declaredCoderBackendId } from './resource-governor';
import { gateRetryLimitForCoderBackend, resolveExecutorRoute, type ExecutionContract } from './executor-selection';
import type { WorkItem } from '@anima/core';

const claudeContract: ExecutionContract = {
  executor: 'worktree',
  coderBackend: 'claude-code',
  model: 'default',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  targetKind: 'project',
  targetReference: 'anima',
  resumeCheckpointCommitSha: null,
};
const repoRoot = resolve(__dirname, '../../../..');

describe('Claude Code executor routing (Akita Baseline V1)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('selecionável no fluxo real pela rota de worktree, com identidade claude-code:<modelo>', () => {
    const selection = resolveExecutorRoute(claudeContract, { repoRoot });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.modelRef).toBe('claude-code:default');
    }
    const pinned = resolveExecutorRoute({ ...claudeContract, model: 'opus' }, { repoRoot });
    expect(pinned.ok && pinned.route.candidate.modelRef).toBe('claude-code:opus');
  });

  test('executável configurado como wrapper de shell falha fechado na seleção', () => {
    process.env.ANIMA_CLAUDE_CODE_PATH = 'C:\\npm\\claude.cmd';
    const selection = resolveExecutorRoute(claudeContract, { repoRoot });
    expect(selection).toMatchObject({ ok: false, error: { code: 'coder_backend_invalid' } });
  });

  test('defaults intactos: sem coder_backend continua ollama; claude-code sem retry interno de gate', () => {
    const selection = resolveExecutorRoute({ ...claudeContract, coderBackend: null, model: 'qwen3-coder:latest' }, {
      repoRoot, ollamaRuntimeOverride: { url: 'http://127.0.0.1:11434', backendId: 'ollama:qwen3-coder:latest', locality: 'local', nodeId: null },
    });
    expect(selection.ok && selection.route.candidate.modelRef).toBe('ollama:qwen3-coder:latest');
    expect(gateRetryLimitForCoderBackend('claude-code')).toBe(0);
  });

  test('Resource Governor prevê a mesma identidade que o backend registrará', () => {
    const item = { intent: { execution_spec: { coder_backend: 'claude-code', model: 'default' } } } as unknown as WorkItem;
    expect(declaredCoderBackendId(item, {})).toBe('claude-code:default');
  });
});
