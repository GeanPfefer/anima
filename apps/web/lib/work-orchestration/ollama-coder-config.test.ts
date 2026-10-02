import { DEFAULT_LOCAL_CODER_CONTEXT_LENGTH, DEFAULT_REMOTE_CODER_CONTEXT_LENGTH, resolveLocalCoderContextLength, resolveOllamaCoderRuntimeConfig, resolveRemoteCoderContextLength } from './ollama-coder-config';

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

describe('resolveLocalCoderContextLength — ANIMA_LOCAL_CODER_CONTEXT_LENGTH', () => {
  test('ausente ou vazio ⇒ 8192 (comportamento histórico)', () => {
    expect(resolveLocalCoderContextLength({})).toEqual({ ok: true, value: 8192 });
    expect(resolveLocalCoderContextLength({ ANIMA_LOCAL_CODER_CONTEXT_LENGTH: '  ' })).toEqual({ ok: true, value: DEFAULT_LOCAL_CODER_CONTEXT_LENGTH });
  });

  test('inteiro decimal positivo >= 1024 é aceito', () => {
    expect(resolveLocalCoderContextLength({ ANIMA_LOCAL_CODER_CONTEXT_LENGTH: '16384' })).toEqual({ ok: true, value: 16384 });
  });

  test.each(['0', '-8192', '8192.5', '1e4', '0x2000', 'abc', 'Infinity', '512', '99999999999999999999'])(
    'valor inválido %s falha fechado (nunca outro valor silencioso)', raw => {
      expect(resolveLocalCoderContextLength({ ANIMA_LOCAL_CODER_CONTEXT_LENGTH: raw }).ok).toBe(false);
    });
});

describe('resolveRemoteCoderContextLength — ANIMA_REMOTE_CODER_CONTEXT_LENGTH', () => {
  test('ausente ⇒ 8192 (histórico); independente do knob LOCAL', () => {
    expect(resolveRemoteCoderContextLength({})).toEqual({ ok: true, value: DEFAULT_REMOTE_CODER_CONTEXT_LENGTH });
    expect(DEFAULT_REMOTE_CODER_CONTEXT_LENGTH).toBe(8192);
    expect(resolveRemoteCoderContextLength({ ANIMA_LOCAL_CODER_CONTEXT_LENGTH: '16384' })).toEqual({ ok: true, value: 8192 });
    expect(resolveLocalCoderContextLength({ ANIMA_REMOTE_CODER_CONTEXT_LENGTH: '32768' })).toEqual({ ok: true, value: 8192 });
  });
  test('32768 configurado é aceito', () => {
    expect(resolveRemoteCoderContextLength({ ANIMA_REMOTE_CODER_CONTEXT_LENGTH: '32768' })).toEqual({ ok: true, value: 32768 });
  });
  test.each(['0', '-1', '32768.5', 'abc', '512', '1e5'])('inválido %s falha fechado', raw => {
    const r = resolveRemoteCoderContextLength({ ANIMA_REMOTE_CODER_CONTEXT_LENGTH: raw });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ANIMA_REMOTE_CODER_CONTEXT_LENGTH');
  });
});
