/** @jest-environment node */
import { WORKTREE_CODER_BACKENDS, resolveConfiguredCoderBackend } from './coder-backend';

describe('resolveConfiguredCoderBackend — config de deploy do backend de código', () => {
  test('env ausente ⇒ default ollama (Harness NÃO é default)', () => {
    expect(resolveConfiguredCoderBackend({})).toBe('ollama');
  });

  test('valor permitido é respeitado (deepseek-harness selecionável no deploy)', () => {
    expect(resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: 'deepseek-harness' })).toBe('deepseek-harness');
    expect(resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: 'openai' })).toBe('openai');
    expect(resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: 'ollama' })).toBe('ollama');
    expect(resolveConfiguredCoderBackend({ ANIMA_CODER_PROVIDER: 'openai' })).toBe('openai');
  });

  test('trim de espaços em volta do valor', () => {
    expect(resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: '  deepseek-harness  ' })).toBe('deepseek-harness');
  });

  test('valor não reconhecido falha fechado; vazio preserva o default gratuito', () => {
    expect(() => resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: 'scripted' })).toThrow(/não é permitido/);
    expect(() => resolveConfiguredCoderBackend({ ANIMA_CODER_PROVIDER: 'gpt' })).toThrow(/não é permitido/);
    expect(resolveConfiguredCoderBackend({ ANIMA_WORKTREE_CODER_BACKEND: '' })).toBe('ollama');
  });

  test('o conjunto permitido espelha os backends do fluxo real (backendFor)', () => {
    expect([...WORKTREE_CODER_BACKENDS].sort()).toEqual(['deepseek-harness', 'ollama', 'openai']);
  });
});
