/** @jest-environment node */
import type { CoderWorkspace } from './coder-backend';
import { GptCoderBackend, type OpenAIUsage } from './gpt-coder';
import { sha256 } from './ollama-protocol';

const workspace = (initial: Record<string, string>): CoderWorkspace & { files: Map<string, string> } => {
  const files = new Map(Object.entries(initial));
  return { files, readFile: async p => files.get(p) ?? null, writeFile: async (p, c) => { files.set(p, c); return true; } };
};
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const request = { objective: 'Trocar um valor', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'] };

describe('GptCoderBackend — mesmo protocolo host-mediated do Ollama', () => {
  test('READ → EDIT, usage e request da Responses API', async () => {
    const original = 'export const value = 1;\n'; const calls: Array<{ headers: HeadersInit; body: string }> = []; const usage: OpenAIUsage[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: init!.headers!, body: String(init!.body) });
      const content = calls.length === 1
        ? JSON.stringify({ action: 'read', reads: [{ path: 'src/a.ts', lineRange: [1, 1], maxLines: 10 }] })
        : JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: 'value = 1', after: 'value = 2', expected_occurrences: 1 }] });
      return response({ output_text: content, usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 4 } } });
    }) as typeof fetch;
    const ws = workspace({ 'src/a.ts': original });
    const backend = new GptCoderBackend({ model: 'gpt-test', apiKey: 'secret-test-key', fetchImpl, onUsage: value => usage.push(value) });
    const result = await backend.edit(request, ws, new AbortController().signal);
    expect(ws.files.get('src/a.ts')).toBe('export const value = 2;\n');
    expect(result.touchedResources).toEqual(['src/a.ts']); expect(backend.id).toBe('openai:gpt-test');
    expect(backend.observation).toEqual({ placement: 'remote', nodeId: 'openai-api', model: 'gpt-test' });
    expect(result.providerUsage).toEqual({ schemaVersion: 1, inputTokens: 40, outputTokens: 20, totalTokens: 60, cachedInputTokens: 8 });
    expect(usage).toEqual([{ inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 4 }, { inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 4 }]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ model: 'gpt-test', store: false });
    expect(JSON.stringify(JSON.parse(calls[0]!.body))).not.toContain('secret-test-key');
    expect(calls[0]!.headers).toMatchObject({ Authorization: 'Bearer secret-test-key' });
  });
  test('traduz function_call para o vocabulário interno sem autoridade direta', async () => {
    const original = 'x = 1\n';
    const fetchImpl = (async () => response({ output: [{ type: 'function_call', name: 'submit_coder_action', arguments: JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: '1', after: '2', expected_occurrences: 1 }] }) }] })) as typeof fetch;
    const ws = workspace({ 'src/a.ts': original });
    await new GptCoderBackend({ apiKey: 'x', fetchImpl }).edit(request, ws, new AbortController().signal);
    expect(ws.files.get('src/a.ts')).toBe('x = 2\n');
  });

  test.each([[401, 'openai_auth'], [403, 'openai_auth'], [429, 'openai_rate_limit'], [500, 'openai_api']] as const)('classifica HTTP %s', async (status, code) => {
    const backend = new GptCoderBackend({ apiKey: 'secret', fetchImpl: (async () => response({}, status)) as typeof fetch });
    await expect(backend.edit(request, workspace({ 'src/a.ts': 'x' }), new AbortController().signal)).rejects.toMatchObject({ code });
  });
  test('falha fechado sem chave e em resposta malformada', async () => {
    await expect(new GptCoderBackend({ apiKey: '', fetchImpl: jest.fn() }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_auth' });
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: (async () => response({ output: [] })) as typeof fetch }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_malformed_response' });
  });
  test('distingue timeout e cancelamento', async () => {
    const delayedFailure = (async () => { await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('aborted'); }) as typeof fetch;
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: delayedFailure, timeoutMs: 1 }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_timeout' });
    const controller = new AbortController(); controller.abort();
    const cancelled = (async () => { throw new Error('aborted'); }) as typeof fetch;
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: cancelled }).edit(request, workspace({}), controller.signal)).rejects.toMatchObject({ code: 'openai_cancelled' });
  });
});
