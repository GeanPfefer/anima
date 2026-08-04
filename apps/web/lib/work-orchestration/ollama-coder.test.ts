/** @jest-environment node */
import type { CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend } from './ollama-coder';

function memoryWorkspace(initial: Record<string, string> = {}): CoderWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
  };
}

const fakeFetch = (content: string, ok = true, status = 200): typeof fetch =>
  (async () => ({ ok, status, json: async () => ({ message: { content } }) })) as unknown as typeof fetch;

const request = { objective: 'Adicionar função', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'] };

describe('OllamaCoderBackend', () => {
  test('escreve os arquivos do escopo retornados pelo modelo', async () => {
    const workspace = memoryWorkspace();
    const backend = new OllamaCoderBackend({ model: 'x', fetchImpl: fakeFetch(JSON.stringify({ files: [{ path: 'src/a.ts', content: 'export const a = 1;\n' }] })) });
    const result = await backend.edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/a.ts']);
    expect(workspace.files.get('src/a.ts')).toContain('export const a = 1;');
    expect(backend.id).toBe('ollama:x');
  });

  test('descarta caminhos fora do escopo declarado', async () => {
    const workspace = memoryWorkspace();
    const backend = new OllamaCoderBackend({ model: 'x', fetchImpl: fakeFetch(JSON.stringify({ files: [{ path: 'src/b.ts', content: 'x' }, { path: 'src/a.ts', content: 'ok\n' }] })) });
    const result = await backend.edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/a.ts']);
    expect(workspace.files.has('src/b.ts')).toBe(false);
  });

  test('JSON inválido do modelo falha fechado', async () => {
    const backend = new OllamaCoderBackend({ model: 'x', fetchImpl: fakeFetch('desculpe, não consigo') });
    await expect(backend.edit(request, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  });

  test('resposta não-ok do servidor falha fechado', async () => {
    const backend = new OllamaCoderBackend({ model: 'x', fetchImpl: fakeFetch('', false, 503) });
    await expect(backend.edit(request, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  });
});
