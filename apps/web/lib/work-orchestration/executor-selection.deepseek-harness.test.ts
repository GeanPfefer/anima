import { resolve } from 'node:path';
import {
  gateRetryLimitForCoderBackend,
  resolveExecutorRoute,
  type ExecutionContract,
} from './executor-selection';

const harnessContract: ExecutionContract = {
  executor: 'worktree',
  coderBackend: 'deepseek-harness',
  model: 'qwen3-coder:latest',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  targetKind: 'project',
  targetReference: 'anima',
  resumeCheckpointCommitSha: null,
};

describe('DeepSeek Harness executor routing', () => {
  test('? selecion?vel no fluxo real preservando a identidade do modelo', () => {
    const selection = resolveExecutorRoute(
      harnessContract,
      { repoRoot: resolve(__dirname, '../../../..') },
    );

    expect(selection.ok).toBe(true);

    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.modelRef)
        .toBe('deepseek-harness:qwen3-coder:latest');
    }
  });

  test('recebe exatamente um retry interno de gate', () => {
    expect(gateRetryLimitForCoderBackend('deepseek-harness')).toBe(1);
    expect(gateRetryLimitForCoderBackend('ollama')).toBe(1);
    expect(gateRetryLimitForCoderBackend('openai')).toBe(0);
    expect(gateRetryLimitForCoderBackend(null)).toBe(0);
  });
});
