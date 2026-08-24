import { resolveOllamaCoderRuntimeConfig } from './ollama-coder-config';

describe('resolveOllamaCoderRuntimeConfig — endpoint dedicado do coder', () => {
  test('sem env preserva Ollama local e identidade compatível', () => {
    expect(resolveOllamaCoderRuntimeConfig('qwen3-coder:latest', {})).toEqual({
      ok: true,
      value: { url: 'http://127.0.0.1:11434', backendId: 'ollama:qwen3-coder:latest', locality: 'local', nodeId: null },
    });
  });

  test('override remoto usa somente loopback e distingue node/localidade', () => {
    expect(resolveOllamaCoderRuntimeConfig('qwen3-coder:latest', {
      ANIMA_WORKTREE_OLLAMA_URL: 'http://127.0.0.1:21434/',
      ANIMA_WORKTREE_OLLAMA_LOCALITY: 'remote',
      ANIMA_WORKTREE_OLLAMA_NODE_ID: 'runpod-a40',
    })).toEqual({
      ok: true,
      value: { url: 'http://127.0.0.1:21434', backendId: 'ollama:remote/runpod-a40:qwen3-coder:latest', locality: 'remote', nodeId: 'runpod-a40' },
    });
  });

  test.each([
    ['host remoto arbitrário', { ANIMA_WORKTREE_OLLAMA_URL: 'https://gpu.example:11434', ANIMA_WORKTREE_OLLAMA_LOCALITY: 'remote', ANIMA_WORKTREE_OLLAMA_NODE_ID: 'runpod-a40' }],
    ['credencial na URL', { ANIMA_WORKTREE_OLLAMA_URL: 'http://user:secret@127.0.0.1:21434', ANIMA_WORKTREE_OLLAMA_LOCALITY: 'remote', ANIMA_WORKTREE_OLLAMA_NODE_ID: 'runpod-a40' }],
    ['localidade ausente', { ANIMA_WORKTREE_OLLAMA_URL: 'http://127.0.0.1:21434', ANIMA_WORKTREE_OLLAMA_NODE_ID: 'runpod-a40' }],
    ['node ausente', { ANIMA_WORKTREE_OLLAMA_URL: 'http://127.0.0.1:21434', ANIMA_WORKTREE_OLLAMA_LOCALITY: 'remote' }],
  ])('%s falha fechado', (_label, env) => {
    expect(resolveOllamaCoderRuntimeConfig('qwen3-coder:latest', env)).toMatchObject({ ok: false });
  });
});
