/** @jest-environment node */
import {
  OllamaProtocolError,
  assertNotTruncated,
  assertPromptWithinBudget,
  applyEditOperations,
  buildManifest,
  callOllamaChat,
  estimateTokens,
  extractSlice,
  parseEditOperations,
  parseProtocolResponse,
  parseReadRequests,
  resolveContextBudget,
  resolveScopedPath,
  serveReadRequests,
  sha256,
  writeChangeSet,
  type AppliedChange,
  type EditOperation,
  type OllamaChatInput,
  type ReadRequest,
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

const SCOPE = new Set(['docs/a.md', 'docs/arquitetura/x.md']);

describe('ollama-protocol — Commit 2: leitura limitada', () => {
  test('resolveScopedPath normaliza o inequívoco e recusa o ambíguo/perigoso', () => {
    expect(resolveScopedPath('docs/a.md', SCOPE)).toBe('docs/a.md');
    expect(resolveScopedPath('docs\\arquitetura\\x.md', SCOPE)).toBe('docs/arquitetura/x.md'); // Windows
    expect(resolveScopedPath('./docs/a.md', SCOPE)).toBe('docs/a.md');
    expect(resolveScopedPath('/etc/passwd', SCOPE)).toBeNull(); // absoluto POSIX
    expect(resolveScopedPath('C:/anima/docs/a.md', SCOPE)).toBeNull(); // absoluto Windows
    expect(resolveScopedPath('docs/../secret.md', SCOPE)).toBeNull(); // traversal
    expect(resolveScopedPath('../a.md', SCOPE)).toBeNull();
    expect(resolveScopedPath('docs/b.md', SCOPE)).toBeNull(); // fora do escopo
    expect(resolveScopedPath('', SCOPE)).toBeNull();
  });

  test('buildManifest revela estrutura mas NUNCA conteúdo integral', () => {
    const md = '# Título\ntexto secreto que não pode vazar\n## Seção A\nmais texto\n### Sub';
    const [entry] = buildManifest([{ path: 'docs/a.md', content: md }]);
    expect(entry).toMatchObject({ path: 'docs/a.md', exists: true, kind: 'markdown' });
    expect(entry!.sha256).toBe(sha256(md));
    expect(entry!.byteSize).toBe(Buffer.byteLength(md, 'utf8'));
    expect(entry!.structure).toEqual(['# Título', '## Seção A', '### Sub']);
    // Nenhuma chave carrega o conteúdo, e o texto do corpo não aparece no manifesto.
    expect(Object.keys(entry!)).not.toContain('content');
    expect(JSON.stringify(entry)).not.toContain('texto secreto');
  });

  test('buildManifest marca arquivo inexistente sem inventar hash', () => {
    const [entry] = buildManifest([{ path: 'docs/a.md', content: null }]);
    expect(entry).toMatchObject({ exists: false, sha256: null, byteSize: 0, structure: [] });
  });

  test('parseReadRequests: teto de leituras é erro de schema', () => {
    const many = Array.from({ length: 9 }, () => ({ path: 'docs/a.md' }));
    expect(() => parseReadRequests(many, SCOPE)).toThrow(OllamaProtocolError);
    try { parseReadRequests(many, SCOPE); } catch (e) { expect((e as OllamaProtocolError).code).toBe('ollama_invalid_response_schema'); }
  });

  test('parseReadRequests: caminho fora do escopo é rejeitado (relatado), válidos seguem; limites aplicados', () => {
    const { requests, rejected } = parseReadRequests(
      [{ path: 'docs/a.md', maxLines: 99999, contextBefore: 999 }, { path: '/etc/passwd' }, { path: 'docs/b.md' }],
      SCOPE,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: 'docs/a.md', maxLines: 200, contextBefore: 20 });
    expect(rejected).toHaveLength(2);
  });

  test('extractSlice: busca em Markdown grande devolve trechos numerados e limitados', () => {
    const big = Array.from({ length: 600 }, (_, i) => i === 400 ? '## Marco alvo' : `linha ${i + 1}`).join('\n');
    const req: ReadRequest = { path: 'docs/a.md', search: 'Marco alvo', contextBefore: 2, contextAfter: 2, maxLines: 20 };
    const slice = extractSlice(big, req);
    expect(slice).toContain('Marco alvo');
    expect(slice).toMatch(/^\s*401\|/m); // linha numerada (1-based)
    expect(slice.split('\n').length).toBeLessThanOrEqual(6);
    expect(slice).not.toContain('linha 1\n'); // não vazou o arquivo inteiro
  });

  test('extractSlice: intervalo de linhas e limite de caracteres', () => {
    const big = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join('\n');
    const slice = extractSlice(big, { path: 'docs/a.md', lineRange: [10, 12], contextBefore: 0, contextAfter: 0, maxLines: 200 });
    expect(slice).toContain('L10'); expect(slice).toContain('L12'); expect(slice).not.toContain('L13');
    const huge = 'x'.repeat(20000);
    const clipped = extractSlice(huge, { path: 'docs/a.md', contextBefore: 0, contextAfter: 0, maxLines: 1 });
    expect(clipped).toContain('truncado por limite');
  });

  test('serveReadRequests: entrega trecho + sha256 atual; inexistente é rejeitado', () => {
    const files: Record<string, string> = { 'docs/a.md': '# A\nconteúdo' };
    const { requests } = parseReadRequests([{ path: 'docs/a.md', search: 'A' }, { path: 'docs/arquitetura/x.md' }], SCOPE);
    const { served, rejected } = serveReadRequests(requests, p => files[p] ?? null);
    expect(served).toHaveLength(1);
    expect(served[0]!.sha256).toBe(sha256(files['docs/a.md']!));
    expect(served[0]!.slice).toContain('# A');
    expect(rejected).toHaveLength(1);
  });
});

describe('ollama-protocol — Commit 3: edições exatas', () => {
  const FILE = 'docs/a.md';
  const original = '# Doc\nINT-03 é a ponte de aplicação e cria PR.\nfim.\n';
  const sha = sha256(original);
  const contentOf = (files: Record<string, string>) => (p: string): string | null => (p in files ? files[p]! : null);

  const replace = (before: string, after: string, s = sha): unknown =>
    ({ kind: 'replace_exact', path: FILE, expected_file_sha256: s, before, after, expected_occurrences: 1 });

  test('parse aceita replace_exact e create_file válidos', () => {
    const ops = parseEditOperations([replace('cria PR', 'é fronteira pura'), { kind: 'create_file', path: 'docs/arquitetura/x.md', content: '# novo' }], new Set([FILE, 'docs/arquitetura/x.md']));
    expect(ops).toHaveLength(2);
    expect(ops[0]!.kind).toBe('replace_exact');
    expect(ops[1]!.kind).toBe('create_file');
  });

  test('parse recusa: kind desconhecido, fora do escopo, sha inválido, before vazio, occurrences!=1, excesso', () => {
    const scope = new Set([FILE]);
    const bad: [unknown, string][] = [
      [{ kind: 'delete_file', path: FILE }, 'ollama_invalid_response_schema'],
      [{ kind: 'replace_exact', path: 'fora/y.md', expected_file_sha256: sha, before: 'x', after: 'y' }, 'ollama_edit_outside_scope'],
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: 'nope', before: 'x', after: 'y' }, 'ollama_invalid_response_schema'],
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha, before: '', after: 'y' }, 'ollama_invalid_response_schema'],
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha, before: 'x', after: 'y', expected_occurrences: 2 }, 'ollama_invalid_response_schema'],
    ];
    for (const [op, code] of bad) {
      try { parseEditOperations([op], scope); throw new Error('deveria lançar'); }
      catch (e) { expect((e as { code?: string }).code).toBe(code); }
    }
    const many = Array.from({ length: 21 }, () => replace('a', 'b'));
    expect(() => parseEditOperations(many, scope)).toThrow('operações');
  });

  test('aplica substituição exata e preserva o resto byte a byte', () => {
    const ops = parseEditOperations([replace('INT-03 é a ponte de aplicação e cria PR.', 'INT-03 é a fronteira pura de integração.')], new Set([FILE]));
    const changes = applyEditOperations(ops, contentOf({ [FILE]: original }));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.newContent).toBe('# Doc\nINT-03 é a fronteira pura de integração.\nfim.\n');
    expect(changes[0]!.newContent.startsWith('# Doc\n')).toBe(true);
    expect(changes[0]!.newContent.endsWith('\nfim.\n')).toBe(true);
  });

  test('hash desatualizado é recusado', () => {
    const ops = parseEditOperations([replace('cria PR', 'X', sha256('outro conteúdo'))], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: original })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_stale_file_hash'); }
  });

  test('zero ocorrências e múltiplas ocorrências são ambíguas', () => {
    const zero = parseEditOperations([replace('NÃO EXISTE', 'x')], new Set([FILE]));
    try { applyEditOperations(zero, contentOf({ [FILE]: original })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
    const multiSrc = 'aa\naa\n';
    const multi = parseEditOperations([replace('aa', 'bb', sha256(multiSrc))], new Set([FILE]));
    try { applyEditOperations(multi, contentOf({ [FILE]: multiSrc })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
  });

  test('operações sobrepostas no mesmo arquivo são recusadas', () => {
    const src = 'abcdef\n';
    const s = sha256(src);
    const ops = parseEditOperations([replace('abcd', 'X', s), replace('cdef', 'Y', s)], new Set([FILE]));
    // ambas casam 1x, mas [0,4) e [2,6) se sobrepõem
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
  });

  test('duas edições válidas não sobrepostas no mesmo arquivo aplicam ambas', () => {
    const src = 'INICIO meio FIM\n';
    const s = sha256(src);
    const ops = parseEditOperations([replace('INICIO', 'A', s), replace('FIM', 'B', s)], new Set([FILE]));
    const [change] = applyEditOperations(ops, contentOf({ [FILE]: src }));
    expect(change!.newContent).toBe('A meio B\n');
  });

  test('edição sem efeito (before === after) é no_effective_edits', () => {
    const ops = parseEditOperations([replace('fim.', 'fim.')], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: original })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_no_effective_edits'); }
  });

  test('lote vazio é no_effective_edits', () => {
    try { applyEditOperations([] as EditOperation[], contentOf({ [FILE]: original })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_no_effective_edits'); }
  });

  test('create_file sobre caminho existente é recusado; novo arquivo é criado', () => {
    const scope = new Set(['docs/novo.md', FILE]);
    const overExisting = parseEditOperations([{ kind: 'create_file', path: FILE, content: 'x' }], scope);
    expect(() => applyEditOperations(overExisting, contentOf({ [FILE]: original }))).toThrow();
    const create = parseEditOperations([{ kind: 'create_file', path: 'docs/novo.md', content: '# novo\n' }], scope);
    const [change] = applyEditOperations(create, contentOf({ [FILE]: original }));
    expect(change).toMatchObject({ path: 'docs/novo.md', kind: 'create', newContent: '# novo\n' });
  });

  test('múltiplos arquivos: cada um preserva o não tocado', () => {
    const f1 = 'um: X\n'; const f2 = 'dois: Y\n';
    const scope = new Set(['docs/f1.md', 'docs/f2.md']);
    const ops = parseEditOperations([
      { kind: 'replace_exact', path: 'docs/f1.md', expected_file_sha256: sha256(f1), before: 'X', after: 'Z', expected_occurrences: 1 },
      { kind: 'replace_exact', path: 'docs/f2.md', expected_file_sha256: sha256(f2), before: 'Y', after: 'W', expected_occurrences: 1 },
    ], scope);
    const changes = applyEditOperations(ops, contentOf({ 'docs/f1.md': f1, 'docs/f2.md': f2 }));
    expect(changes.map(c => c.newContent).sort()).toEqual(['dois: W\n', 'um: Z\n']);
  });
});

describe('ollama-protocol — escrita do lote (writeChangeSet)', () => {
  const FALSE = '<<FALSE>>';
  const THROW = '<<THROW>>';
  function harness() {
    const store: Record<string, string> = {};
    const writes: string[] = [];
    const writer = {
      writeFile: async (path: string, content: string): Promise<boolean> => {
        if (content === FALSE) return false;
        if (content === THROW) throw new Error('io fail');
        store[path] = content; writes.push(path); return true;
      },
    };
    return { store, writes, writer };
  }
  const rep = (path: string, newContent: string): AppliedChange => ({ path, newContent, kind: 'replace' });
  const cre = (path: string, newContent: string): AppliedChange => ({ path, newContent, kind: 'create' });

  test('caminho feliz multi-arquivo escreve tudo e devolve os caminhos', async () => {
    const h = harness();
    const touched = await writeChangeSet([rep('a.md', 'A1'), rep('b.md', 'B1')], h.writer);
    expect(touched).toEqual(['a.md', 'b.md']);
    expect(h.store).toEqual({ 'a.md': 'A1', 'b.md': 'B1' });
  });

  test('create é escrito como qualquer arquivo (rollback é da worktree)', async () => {
    const h = harness();
    const touched = await writeChangeSet([rep('a.md', 'A1'), cre('novo.md', '# novo')], h.writer);
    expect(touched).toEqual(['a.md', 'novo.md']);
    expect(h.store['novo.md']).toBe('# novo');
  });

  test('writeFile===false lança sem retornar sucesso parcial', async () => {
    await expect(writeChangeSet([rep('a.md', 'A1'), rep('b.md', FALSE)], harness().writer))
      .rejects.toMatchObject({ code: 'ollama_edit_outside_scope' });
  });

  test('exceção durante a escrita vira ollama_transport_error', async () => {
    await expect(writeChangeSet([rep('a.md', 'A1'), rep('b.md', THROW)], harness().writer))
      .rejects.toMatchObject({ code: 'ollama_transport_error' });
  });

  test('abort durante o lote lança ollama_aborted (nunca sucesso parcial)', async () => {
    const h = harness();
    const controller = new AbortController();
    const writer = { writeFile: async (p: string, c: string) => { const ok = await h.writer.writeFile(p, c); if (h.writes.length === 1) controller.abort(); return ok; } };
    await expect(writeChangeSet([rep('a.md', 'A1'), rep('b.md', 'B1')], writer, controller.signal))
      .rejects.toMatchObject({ code: 'ollama_aborted' });
  });

  test('lote vazio é no_effective_edits', async () => {
    await expect(writeChangeSet([], harness().writer)).rejects.toMatchObject({ code: 'ollama_no_effective_edits' });
  });
});
