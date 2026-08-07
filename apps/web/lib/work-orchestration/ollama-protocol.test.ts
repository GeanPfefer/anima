/** @jest-environment node */
import {
  OllamaProtocolError,
  assertNotTruncated,
  assertPromptWithinBudget,
  callOllamaChat,
  estimateTokens,
  parseProtocolResponse,
  resolveContextBudget,
  sha256,
  type OllamaChatInput,
} from './ollama-protocol';

const okFetch = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

const baseCall = (fetchImpl: typeof fetch, timeoutMs = 5000): OllamaChatInput => ({
  url: 'http://127.0.0.1:11434',
  model: 'qwen3-coder:latest',
  messages: [{ role: 'user', content: 'oi' }],
  budget: resolveContextBudget({ operationalCap: 8192, outputReserveTokens: 1024, numPredict: 512 }),
  timeoutMs,
  fetchImpl,
});

describe('ollama-protocol — Commit 1: orçamento e diagnóstico', () => {
  test('resolveContextBudget nunca ultrapassa o teto operacional', () => {
    const b = resolveContextBudget({ declaredContextLength: 131072, operationalCap: 8192, outputReserveTokens: 1024, numPredict: 512 });
    expect(b.numCtx).toBe(8192);
    expect(b.outputReserveTokens).toBe(1024);
    expect(b.inputBudgetTokens).toBe(8192 - 1024);
    expect(b.numPredict).toBe(512);
  });

  test('reserva de saída é limitada a metade do contexto', () => {
    const b = resolveContextBudget({ operationalCap: 2048, outputReserveTokens: 999999, numPredict: 999999 });
    expect(b.outputReserveTokens).toBe(1024);
    expect(b.numPredict).toBe(1024);
    expect(b.inputBudgetTokens).toBe(1024);
  });

  test('estimateTokens super-estima e é monotônico', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('a'.repeat(70))).toBeGreaterThan(estimateTokens('a'.repeat(35)));
  });

  test('prompt acima do orçamento é recusado ANTES da chamada', () => {
    const budget = resolveContextBudget({ operationalCap: 8192, outputReserveTokens: 1024, numPredict: 512 });
    const huge = 'x'.repeat(300_000);
    try {
      assertPromptWithinBudget(huge, budget);
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(OllamaProtocolError);
      expect((e as OllamaProtocolError).code).toBe('ollama_context_budget_exceeded');
    }
    expect(() => assertPromptWithinBudget('curto', budget)).not.toThrow();
  });

  test('truncamento é detectado pelos metadados do Ollama (caso real: 4098 de ~73k)', () => {
    const prompt = 'y'.repeat(291_819);
    try {
      assertNotTruncated(prompt, { promptEvalCount: 4098, evalCount: 31, doneReason: 'stop' });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as OllamaProtocolError).code).toBe('ollama_prompt_truncated');
    }
  });

  test('prompt pequeno avaliado por inteiro NÃO é considerado truncado', () => {
    const prompt = 'z'.repeat(2000); // ~571 tokens estimados
    expect(() => assertNotTruncated(prompt, { promptEvalCount: 500, evalCount: 40, doneReason: 'stop' })).not.toThrow();
    expect(() => assertNotTruncated(prompt, { promptEvalCount: null, evalCount: null, doneReason: null })).not.toThrow();
  });

  test('envelope válido: read e edit', () => {
    expect(parseProtocolResponse('{"action":"read","reads":[]}')).toEqual({ action: 'read', reads: [] });
    expect(parseProtocolResponse('texto antes {"action":"edit","operations":[]} texto depois'))
      .toEqual({ action: 'edit', operations: [] });
  });

  test('JSON válido mas de schema errado (o caso observado) vira erro específico', () => {
    for (const bad of ['{"status":"completed","reviewed_by":"Gean"}', '{"files":[]}', '{"action":"delete"}', 'não é json', '{"action":"read"}']) {
      try {
        parseProtocolResponse(bad);
        throw new Error(`deveria ter lançado para: ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(OllamaProtocolError);
        expect((e as OllamaProtocolError).code).toBe('ollama_invalid_response_schema');
      }
    }
  });

  test('callOllamaChat devolve conteúdo e metadados seguros', async () => {
    const call = baseCall(okFetch({ message: { content: '{"action":"read","reads":[]}' }, prompt_eval_count: 123, eval_count: 45, done_reason: 'stop' }));
    const r = await callOllamaChat(call);
    expect(r.content).toContain('"action":"read"');
    expect(r.meta).toEqual({ promptEvalCount: 123, evalCount: 45, doneReason: 'stop' });
  });

  test('resposta não-ok do servidor vira ollama_transport_error', async () => {
    const call = baseCall((async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch);
    await expect(callOllamaChat(call)).rejects.toMatchObject({ code: 'ollama_transport_error' });
  });

  test('exceção de transporte vira ollama_transport_error', async () => {
    const call = baseCall((async () => { throw new Error('sem rota'); }) as unknown as typeof fetch);
    await expect(callOllamaChat(call)).rejects.toMatchObject({ code: 'ollama_transport_error' });
  });

  test('timeout vira ollama_timeout', async () => {
    const hanging: typeof fetch = ((_url: unknown, init: { signal?: AbortSignal } = {}) => new Promise((_resolve, reject) => {
      const sig = init.signal;
      if (sig) sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    await expect(callOllamaChat(baseCall(hanging, 10))).rejects.toMatchObject({ code: 'ollama_timeout' });
  });

  test('sha256 é determinístico e sensível a mudança', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    expect(sha256('abc')).toMatch(/^[a-f0-9]{64}$/);
  });
});
