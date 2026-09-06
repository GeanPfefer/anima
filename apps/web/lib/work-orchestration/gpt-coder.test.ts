/** @jest-environment node */
import type { OpenAIAdmissionControl } from '@/lib/ai/openai-paid-transport';
import { OpenAIAdmissionDenied } from '@/lib/ai/openai-paid-transport';
import type { CoderWorkspace } from './coder-backend';
import { GptCoderBackend, resolveOpenAICoderContextCap, OPENAI_CODER_CONTEXT_CAP_DEFAULT, OPENAI_CODER_OUTPUT_RESERVE_TOKENS, OPENAI_CODER_NUM_PREDICT, type OpenAIUsage } from './gpt-coder';
import { OllamaCoderBackend } from './ollama-coder';
import { assertPromptWithinBudget, resolveContextBudget, sha256 } from './ollama-protocol';

const workspace = (initial: Record<string, string>): CoderWorkspace & { files: Map<string, string> } => {
  const files = new Map(Object.entries(initial));
  return { files, readFile: async p => files.get(p) ?? null, writeFile: async (p, c) => { files.set(p, c); return true; } };
};
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

// Admissão financeira EXPLÍCITA em memória: os testes nunca consomem dinheiro e
// nunca dependem de fail-open. `grant` admite; `deny` recusa a chamada paga.
const grant: OpenAIAdmissionControl = { admit: async intent => ({ consumer: intent.consumer, authorizationRef: 'test-auth', reservationId: 'r1' }) };
const deny: OpenAIAdmissionControl = { admit: async intent => { throw new OpenAIAdmissionDenied('authorization_missing', intent.consumer); } };

// Correlação paga real: sem ela o coder falha fechado ANTES de qualquer fetch.
const request = {
  objective: 'Trocar um valor', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'],
  workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2, maxDurationMs: 60_000,
};

describe('GptCoderBackend — mesmo protocolo host-mediated do Ollama, fail-closed por construção', () => {
  test('READ → EDIT, usage e request da Responses API (admitido)', async () => {
    const original = 'export const value = 1;\n'; const calls: Array<{ headers: HeadersInit; body: string }> = []; const usage: OpenAIUsage[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: init!.headers!, body: String(init!.body) });
      const content = calls.length === 1
        ? JSON.stringify({ action: 'read', reads: [{ path: 'src/a.ts', lineRange: [1, 1], maxLines: 10 }] })
        : JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: 'value = 1', after: 'value = 2', expected_occurrences: 1 }] });
      return response({ output_text: content, usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 4 } } });
    }) as typeof fetch;
    const ws = workspace({ 'src/a.ts': original });
    const backend = new GptCoderBackend({ model: 'gpt-test', apiKey: 'secret-test-key', fetchImpl, admission: grant, onUsage: value => usage.push(value) });
    const result = await backend.edit(request, ws, new AbortController().signal);
    expect(ws.files.get('src/a.ts')).toBe('export const value = 2;\n');
    expect(result.touchedResources).toEqual(['src/a.ts']); expect(backend.id).toBe('openai:gpt-test');
    expect(backend.observation).toEqual({ placement: 'remote', nodeId: 'openai-api', model: 'gpt-test' });
    expect(result.providerUsage).toEqual({ schemaVersion: 1, inputTokens: 40, outputTokens: 20, totalTokens: 60, cachedInputTokens: 8 });
    expect(result.providerCallCount).toBe(2);
    expect(usage).toEqual([{ inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 4 }, { inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 4 }]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ model: 'gpt-test', store: false });
    expect(JSON.stringify(JSON.parse(calls[0]!.body))).not.toContain('secret-test-key');
    expect(calls[0]!.headers).toMatchObject({ Authorization: 'Bearer secret-test-key' });
  });
  test('traduz function_call para o vocabulário interno sem autoridade direta', async () => {
    const original = 'x = 1\n';
    const fetchImpl = (async () => response({ output: [{ type: 'function_call', name: 'submit_coder_action', arguments: JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: '1', after: '2', expected_occurrences: 1 }] }) }] })) as typeof fetch;
    const ws = workspace({ 'src/a.ts': original });
    await new GptCoderBackend({ apiKey: 'x', fetchImpl, admission: grant }).edit(request, ws, new AbortController().signal);
    expect(ws.files.get('src/a.ts')).toBe('x = 2\n');
  });

  test.each([[401, 'openai_auth'], [403, 'openai_auth'], [429, 'openai_rate_limit'], [500, 'openai_api']] as const)('classifica HTTP %s', async (status, code) => {
    const backend = new GptCoderBackend({ apiKey: 'secret', fetchImpl: (async () => response({}, status)) as typeof fetch, admission: grant });
    await expect(backend.edit(request, workspace({ 'src/a.ts': 'x' }), new AbortController().signal)).rejects.toMatchObject({ code });
  });
  test('falha fechado sem chave e em resposta malformada', async () => {
    await expect(new GptCoderBackend({ apiKey: '', fetchImpl: jest.fn(), admission: grant }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_auth' });
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: (async () => response({ output: [] })) as typeof fetch, admission: grant }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_malformed_response' });
  });
  test('distingue timeout e cancelamento', async () => {
    const delayedFailure = (async () => { await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('aborted'); }) as typeof fetch;
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: delayedFailure, timeoutMs: 1, admission: grant }).edit(request, workspace({}), new AbortController().signal)).rejects.toMatchObject({ code: 'openai_timeout' });
    const controller = new AbortController(); controller.abort();
    const cancelled = (async () => { throw new Error('aborted'); }) as typeof fetch;
    await expect(new GptCoderBackend({ apiKey: 'x', fetchImpl: cancelled, admission: grant }).edit(request, workspace({}), controller.signal)).rejects.toMatchObject({ code: 'openai_cancelled' });
  });

  // REGRESSÃO OBRIGATÓRIA: admissão recusada ⇒ ZERO fetch ⇒ erro determinístico.
  test('admissão recusada bloqueia ANTES do fetch (0 chamadas)', async () => {
    const fetchImpl = jest.fn();
    const backend = new GptCoderBackend({ model: 'gpt-test', apiKey: 'x', fetchImpl, admission: deny });
    await expect(backend.edit(request, workspace({ 'src/a.ts': 'x' }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'openai_paid_authorization' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Fail-closed por construção: sem correlação de work item/attempt, nenhuma chamada
  // paga pode ser correlacionada ⇒ erro antes do fetch, mesmo com admissão que concede.
  test('sem correlação de trabalho bloqueia ANTES do fetch (0 chamadas)', async () => {
    const fetchImpl = jest.fn();
    const backend = new GptCoderBackend({ model: 'gpt-test', apiKey: 'x', fetchImpl, admission: grant });
    await expect(backend.edit(
      { objective: 'x', includedScope: ['src/a.ts'], excludedScope: [] },
      workspace({ 'src/a.ts': 'x' }), new AbortController().signal,
    )).rejects.toMatchObject({ code: 'openai_paid_authorization' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('preserva os ids de request do provider na usage (auditoria/idempotência)', async () => {
    const original = 'x = 1\n'; let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      const content = n === 1
        ? JSON.stringify({ action: 'read', reads: [{ path: 'src/a.ts', lineRange: [1, 1], maxLines: 10 }] })
        : JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: '1', after: '2', expected_occurrences: 1 }] });
      return response({ id: `resp_${n}`, output_text: content, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    }) as typeof fetch;
    const result = await new GptCoderBackend({ apiKey: 'x', fetchImpl, admission: grant })
      .edit(request, workspace({ 'src/a.ts': original }), new AbortController().signal);
    expect(result.providerUsage?.providerRequestIds).toEqual(['resp_1', 'resp_2']);
  });

  // A intenção passada à admissão carrega a correlação exata do attempt.
  test('correlaciona cada chamada paga com o envelope do attempt', async () => {
    const admit = jest.fn(grant.admit);
    const fetchImpl = (async () => response({ output_text: JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256('x'), before: 'x', after: 'y', expected_occurrences: 1 }] }) })) as typeof fetch;
    await new GptCoderBackend({ model: 'gpt-test', apiKey: 'x', fetchImpl, admission: { admit } })
      .edit(request, workspace({ 'src/a.ts': 'x' }), new AbortController().signal);
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({
      consumer: 'coder', workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
      model: 'gpt-test', callIndex: 1, maxDurationMs: 60_000,
    }));
  });
});

describe('orçamento de contexto provider-aware do coder OpenAI (não herda o 8192 local)', () => {
  const gptBudget = new GptCoderBackend({ model: 'gpt-5.6-terra', admission: grant }).contextBudget;
  const localBudget = new OllamaCoderBackend({ model: 'qwen3-coder' }).contextBudget;
  // ~7715 tokens (ceil(27000/3.5)): ACIMA do input local (6656), ABAIXO do input OpenAI.
  const midPrompt = 'a'.repeat(27_000);
  // Acima até do input OpenAI: o guard fail-closed deve permanecer.
  const hugePrompt = 'a'.repeat(400_000);

  test('teto do coder OpenAI é a janela do modelo, NÃO o 8192 local do Ollama', () => {
    expect(resolveOpenAICoderContextCap('gpt-5.6-terra')).toBe(OPENAI_CODER_CONTEXT_CAP_DEFAULT);
    expect(resolveOpenAICoderContextCap('gpt-5.6-terra')).not.toBe(8192);
    expect(OPENAI_CODER_CONTEXT_CAP_DEFAULT).toBeGreaterThan(8192);
  });

  test('env de operação ANIMA_OPENAI_CODER_CONTEXT_CAP tem precedência e é bounded (>=1024)', () => {
    expect(resolveOpenAICoderContextCap('m', { ANIMA_OPENAI_CODER_CONTEXT_CAP: '200000' })).toBe(200_000);
    expect(resolveOpenAICoderContextCap('m', { ANIMA_OPENAI_CODER_CONTEXT_CAP: '512' })).toBe(OPENAI_CODER_CONTEXT_CAP_DEFAULT);
    expect(resolveOpenAICoderContextCap('m', { ANIMA_OPENAI_CODER_CONTEXT_CAP: 'x' })).toBe(OPENAI_CODER_CONTEXT_CAP_DEFAULT);
  });

  test('GptCoderBackend expõe orçamento amplo (não herda 6656) com reserva de saída correta', () => {
    expect(gptBudget.numCtx).toBe(OPENAI_CODER_CONTEXT_CAP_DEFAULT);
    expect(gptBudget.outputReserveTokens).toBe(OPENAI_CODER_OUTPUT_RESERVE_TOKENS);
    expect(gptBudget.inputBudgetTokens).toBe(OPENAI_CODER_CONTEXT_CAP_DEFAULT - OPENAI_CODER_OUTPUT_RESERVE_TOKENS);
    expect(gptBudget.inputBudgetTokens).not.toBe(6656);
    expect(gptBudget.inputBudgetTokens).toBeGreaterThan(100_000);
  });

  test('backend local Ollama mantém a política bounded (num_ctx 8192, input 6656)', () => {
    expect(localBudget.numCtx).toBe(8192);
    expect(localBudget.inputBudgetTokens).toBe(6656);
  });

  test('prompt acima do antigo limite (6656) mas dentro do orçamento OpenAI é ADMITIDO', () => {
    // Sob o orçamento LOCAL o mesmo prompt era rejeitado — era a barreira real do seq2.
    expect(() => assertPromptWithinBudget(midPrompt, localBudget)).toThrow('excede o orçamento de input');
    // Sob o orçamento OpenAI provider-aware, passa ANTES de qualquer chamada.
    expect(() => assertPromptWithinBudget(midPrompt, gptBudget)).not.toThrow();
  });

  test('prompt realmente acima do orçamento OpenAI continua REJEITADO (fail-closed preservado)', () => {
    expect(() => assertPromptWithinBudget(hugePrompt, gptBudget)).toThrow('excede o orçamento de input');
  });

  test('declared context menor que operational cap usa o menor (bounded, sem crescer sem teto)', () => {
    const budget = resolveContextBudget({ declaredContextLength: 4096, operationalCap: 8192, outputReserveTokens: 1536, numPredict: 1536 });
    expect(budget.numCtx).toBe(4096);
    expect(budget.inputBudgetTokens).toBe(4096 - 1536);
  });
});

describe('contrato do transport OpenAI — reserva de saída real e ausência de campos Ollama', () => {
  const original = 'export const value = 1;\n';
  // Objetivo grande: o prompt da 1ª chamada supera o antigo input local (6656), mas cabe
  // no orçamento OpenAI provider-aware — prova que a barreira real (seq2) foi ultrapassada.
  const bigObjective = `Corrija a unidade mínima. ${'detalhe '.repeat(3_600)}`;
  const editReply = (calls: number): string => calls === 1
    ? JSON.stringify({ action: 'read', reads: [{ path: 'src/a.ts', lineRange: [1, 1], maxLines: 10 }] })
    : JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/a.ts', expected_file_sha256: sha256(original), before: 'value = 1', after: 'value = 2', expected_occurrences: 1 }] });

  test('prompt grande CHEGA ao fetch OpenAI, com max_output_tokens coerente e SEM num_ctx/num_predict', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init!.body));
      return response({ output_text: editReply(bodies.length) });
    }) as typeof fetch;
    const ws = workspace({ 'src/a.ts': original });
    await new GptCoderBackend({ model: 'gpt-test', apiKey: 'x', fetchImpl, admission: grant })
      .edit({ ...request, objective: bigObjective }, ws, new AbortController().signal);

    expect(bodies.length).toBeGreaterThanOrEqual(1); // passou a guarda de input e alcançou o transport
    const body = JSON.parse(bodies[0]!) as Record<string, unknown>;
    // Reserva de saída aplicada de verdade no request (equivalente ao num_predict do Ollama).
    expect(body.max_output_tokens).toBe(OPENAI_CODER_NUM_PREDICT);
    // Conceitos específicos do transport Ollama NÃO vazam para a OpenAI.
    expect(body).not.toHaveProperty('num_ctx');
    expect(body).not.toHaveProperty('num_predict');
    expect(body).not.toHaveProperty('options');
    expect(ws.files.get('src/a.ts')).toBe('export const value = 2;\n');
  });

  test('o MESMO prompt grande é rejeitado pelo backend LOCAL antes de qualquer chamada (fail-closed)', async () => {
    const fetchImpl = jest.fn(async () => response({ output_text: '{}' })) as unknown as typeof fetch;
    await expect(
      new OllamaCoderBackend({ model: 'qwen3-coder', fetchImpl })
        .edit({ ...request, objective: bigObjective }, workspace({ 'src/a.ts': original }), new AbortController().signal),
    ).rejects.toThrow('excede o orçamento de input');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
