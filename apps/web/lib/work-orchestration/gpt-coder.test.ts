/** @jest-environment node */
import type { CoderWorkspace } from './coder-backend';
import { GptCoderBackend } from './gpt-coder';

function memoryWorkspace(initial: Record<string, string> = {}): CoderWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
  };
}

// Fakes da Responses API — nenhum teste chama a API paga da OpenAI.
const fakeText = (payload: string, ok = true, status = 200): typeof fetch =>
  (async () => ({ ok, status, json: async () => ({ output_text: payload }) })) as unknown as typeof fetch;
const fakeOutputArray = (payload: string): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: 'output_text', text: payload }] }] }) })) as unknown as typeof fetch;

const request = { objective: 'Adicionar função', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'] };

describe('GptCoderBackend', () => {
  test('escreve arquivos do escopo (output_text)', async () => {
    const workspace = memoryWorkspace();
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: 'k', fetchImpl: fakeText(JSON.stringify({ files: [{ path: 'src/a.ts', content: 'export const a = 1;\n' }] })) });
    const result = await backend.edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/a.ts']);
    expect(workspace.files.get('src/a.ts')).toContain('export const a = 1;');
    expect(backend.id).toBe('openai:gpt-x');
  });

  test('extrai JSON de output[].content[].text', async () => {
    const workspace = memoryWorkspace();
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: 'k', fetchImpl: fakeOutputArray(JSON.stringify({ files: [{ path: 'src/a.ts', content: 'ok\n' }] })) });
    const result = await backend.edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/a.ts']);
  });

  test('descarta caminhos fora do escopo declarado', async () => {
    const workspace = memoryWorkspace();
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: 'k', fetchImpl: fakeText(JSON.stringify({ files: [{ path: 'src/b.ts', content: 'x' }, { path: 'src/a.ts', content: 'ok\n' }] })) });
    const result = await backend.edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/a.ts']);
    expect(workspace.files.has('src/b.ts')).toBe(false);
  });

  test('sem chave da OpenAI falha fechado', async () => {
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: '', fetchImpl: fakeText('{}') });
    await expect(backend.edit(request, memoryWorkspace(), new AbortController().signal)).rejects.toThrow(/chave da OpenAI/);
  });

  test('resposta não-ok falha fechado', async () => {
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: 'k', fetchImpl: fakeText('', false, 500) });
    await expect(backend.edit(request, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  });

  test('JSON inválido falha fechado', async () => {
    const backend = new GptCoderBackend({ model: 'gpt-x', apiKey: 'k', fetchImpl: fakeText('desculpe, não posso') });
    await expect(backend.edit(request, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  });
});
