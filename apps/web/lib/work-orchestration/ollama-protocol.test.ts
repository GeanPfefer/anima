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

  test('buildManifest mapeia blocos de teste (describe/test/it) além de exports, sem vazar corpo', () => {
    const ts = [
      "import x from 'y';",
      'export const helper = 1;',
      "describe('suite', () => {",
      "  test('caso A', () => {",
      '    const segredo = 42;',
      '  });',
      "  it.each([1])('caso B', () => {});",
      '});',
      'const interno = 2;',
    ].join('\n');
    const [entry] = buildManifest([{ path: 'lib/a.test.ts', content: ts }]);
    expect(entry!.kind).toBe('typescript');
    expect(entry!.structure).toEqual([
      'export const helper = 1;',
      "describe('suite', () => {",
      "test('caso A', () => {",
      "it.each([1])('caso B', () => {});",
    ]);
    // Corpo do teste e linhas não-estruturais (import, const interno) NÃO entram.
    expect(JSON.stringify(entry!.structure)).not.toContain('segredo');
    expect(JSON.stringify(entry!.structure)).not.toContain('const interno');
    expect(JSON.stringify(entry!.structure)).not.toContain('import x');
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
    expect(served[0]!.provenance).toEqual({
      search: 'A',
      contextBefore: 3,
      contextAfter: 3,
      maxLines: 60,
      effectiveMode: 'search',
    });
    expect(rejected).toHaveLength(1);
  });

  test('serveReadRequests: preserva a proveniência normalizada sem alterar o slice efetivo', () => {
    const content = Array.from({ length: 12 }, (_, i) => i === 7 ? 'alvo' : `L${i + 1}`).join('\n');
    const { requests } = parseReadRequests([
      {
        path: 'docs/a.md',
        search: ' alvo ',
        lineRange: [2.9, 999],
        contextBefore: 999,
        contextAfter: -1,
        maxLines: 2,
      },
      { path: 'docs/a.md', lineRange: [4.9, 5.9], contextBefore: 1, contextAfter: 2, maxLines: 999 },
      { path: 'docs/a.md' },
    ], SCOPE);

    const { served, rejected } = serveReadRequests(requests, () => content);

    expect(rejected).toEqual([]);
    expect(served.map(item => item.provenance)).toEqual([
      {
        search: 'alvo',
        lineRange: [2, 999],
        contextBefore: 20,
        contextAfter: 0,
        maxLines: 2,
        effectiveMode: 'search',
      },
      {
        lineRange: [4, 5],
        contextBefore: 1,
        contextAfter: 2,
        maxLines: 200,
        effectiveMode: 'lineRange',
      },
      {
        contextBefore: 3,
        contextAfter: 3,
        maxLines: 60,
        effectiveMode: 'head',
      },
    ]);
    expect(served.map(item => item.slice)).toEqual(requests.map(request => extractSlice(content, request)));
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

  const append = (content: string, s = sha): unknown =>
    ({ kind: 'append', path: FILE, expected_file_sha256: s, content });

  test('append: parse aceita válido; recusa sha inválido, content vazio e fora do escopo', () => {
    const ops = parseEditOperations([append('\nnova linha final\n')], new Set([FILE]));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('append');
    const bad: [unknown, string][] = [
      [{ kind: 'append', path: FILE, expected_file_sha256: 'nope', content: 'x' }, 'ollama_invalid_response_schema'],
      [{ kind: 'append', path: FILE, expected_file_sha256: sha, content: '' }, 'ollama_invalid_response_schema'],
      [{ kind: 'append', path: 'fora/y.md', expected_file_sha256: sha, content: 'x' }, 'ollama_edit_outside_scope'],
    ];
    for (const [op, code] of bad) {
      try { parseEditOperations([op], new Set([FILE])); throw new Error('deveria lançar'); }
      catch (e) { expect((e as { code?: string }).code).toBe(code); }
    }
  });

  test('append: concatena ao FIM preservando o resto byte a byte; sha desatualizado e arquivo inexistente são recusados', () => {
    const ops = parseEditOperations([append('// marcador-final\n')], new Set([FILE]));
    const changes = applyEditOperations(ops, contentOf({ [FILE]: original }));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.newContent).toBe(original + '// marcador-final\n');
    expect(changes[0]!.kind).toBe('replace');
    // sha desatualizado
    const stale = parseEditOperations([append('x', sha256('outro'))], new Set([FILE]));
    try { applyEditOperations(stale, contentOf({ [FILE]: original })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_stale_file_hash'); }
    // arquivo inexistente
    try { applyEditOperations(ops, contentOf({})); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_stale_file_hash'); }
  });

  test('append + replace no MESMO arquivo combinam numa única mudança (replace no meio, append no fim)', () => {
    const ops = parseEditOperations([
      replace('cria PR', 'é fronteira pura'),
      append('APENDICE\n'),
    ], new Set([FILE]));
    const changes = applyEditOperations(ops, contentOf({ [FILE]: original }));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.newContent).toBe('# Doc\nINT-03 é a ponte de aplicação e é fronteira pura.\nfim.\n' + 'APENDICE\n');
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

  test('CRLF: âncora multi-linha reproduzida com \\n casa e a saída preserva \\r\\n', () => {
    // Arquivo no disco (Windows) com CRLF. O trecho servido ao modelo é fatiado
    // por `\n`, então o modelo reproduz a âncora multi-linha com `\n`. Sem
    // tolerância a EOL, esse `before` correto ocorreria 0 vez(es) no conteúdo cru
    // (`ollama_ambiguous_replacement`) — a falha determinística observada ao vivo.
    const crlf = 'export function f() {\r\n  return x\r\n    .a()\r\n    .b();\r\n}\r\n';
    const shaCrlf = sha256(crlf);
    const beforeLf = '  return x\n    .a()\n    .b();';
    const afterLf = '  return unique(x\n    .a()\n    .b());';
    const ops = parseEditOperations(
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: shaCrlf, before: beforeLf, after: afterLf, expected_occurrences: 1 }],
      new Set([FILE]),
    );
    const changes = applyEditOperations(ops, contentOf({ [FILE]: crlf }));
    expect(changes).toHaveLength(1);
    const out = changes[0]!.newContent;
    // Bytes não editados preservados E o texto inserido reencodado para o EOL do arquivo.
    expect(out).toBe('export function f() {\r\n  return unique(x\r\n    .a()\r\n    .b());\r\n}\r\n');
    // Nenhum `\n` solto: todo LF continua precedido por CR.
    expect(/[^\r]\n/.test(out)).toBe(false);
  });

  test('LF: âncora com \\r\\n casa em arquivo LF e a saída permanece LF', () => {
    // Simetria: se por algum motivo o `before` trouxer `\r\n` mas o arquivo é LF,
    // o match ainda ocorre e a saída não injeta CR.
    const lf = 'a\nb\nc\n';
    const ops = parseEditOperations(
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha256(lf), before: 'a\r\nb', after: 'a\r\nB', expected_occurrences: 1 }],
      new Set([FILE]),
    );
    const changes = applyEditOperations(ops, contentOf({ [FILE]: lf }));
    expect(changes[0]!.newContent).toBe('a\nB\nc\n');
    expect(changes[0]!.newContent.includes('\r')).toBe(false);
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

describe('ollama-protocol — in_lines (desambiguação determinística por intervalo lido)', () => {
  const FILE = 'packages/core/src/project-intake.test.ts';
  const contentOf = (files: Record<string, string>) => (p: string): string | null => (p in files ? files[p]! : null);
  // Reprodução fiel da falha real (attempt 7802904a): um bloco de 3 linhas de
  // setup+asserção idêntico em DOIS testes (linhas 5-7 e 13-15). O `before` de 3
  // linhas ocorre 2×; sem desambiguador é `ollama_ambiguous_replacement`.
  const lines = [
    "import { validateProjectIdea, summarizeProjectIdeaIntake, draftProjectIdea } from './project-intake';", // 1
    '',                                                          // 2
    "describe('captura', () => {",                              // 3
    "  test('valida', () => {",                                 // 4
    '    const idea = draftProjectIdea(input);',                // 5  bloco A
    '    const summary = summarizeProjectIdeaIntake(idea);',    // 6
    "    expect(summary.status).toBe('captured');",             // 7
    '  });',                                                    // 8
    '});',                                                      // 9
    '',                                                         // 10
    "describe('estrutura', () => {",                            // 11
    "  test('resume', () => {",                                 // 12
    '    const idea = draftProjectIdea(input);',                // 13 bloco B (idêntico a 5-7)
    '    const summary = summarizeProjectIdeaIntake(idea);',    // 14
    "    expect(summary.status).toBe('captured');",             // 15
    '  });',                                                    // 16
    '});',                                                      // 17
    '',                                                         // 18
  ];
  const src = lines.join('\n');
  const sha = sha256(src);
  const block = [lines[4], lines[5], lines[6]].join('\n'); // linhas 5-7 == 13-15
  const rep = (extra: Record<string, unknown>): unknown =>
    ({ kind: 'replace_exact', path: FILE, expected_file_sha256: sha, before: block, after: block + "\n    expect(summary.title.length).toBeGreaterThan(0);", ...extra });

  test('2 ocorrências sem in_lines → recusado, com as linhas de cada ocorrência na mensagem', () => {
    const ops = parseEditOperations([rep({})], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) {
      expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement');
      expect((e as Error).message).toContain('linha 5');
      expect((e as Error).message).toContain('linha 13');
      expect((e as Error).message).toContain('in_lines');
    }
  });

  test('2 ocorrências + in_lines válido → exatamente UMA alterada (a do intervalo)', () => {
    const opsB = parseEditOperations([rep({ in_lines: [13, 15] })], new Set([FILE]));
    const [changeB] = applyEditOperations(opsB, contentOf({ [FILE]: src }));
    // O bloco A (linhas 5-7) permanece intacto; só o B (13-15) ganhou a asserção nova.
    const outB = changeB!.newContent;
    expect(outB.split('expect(summary.title.length).toBeGreaterThan(0);').length - 1).toBe(1);
    const idxNew = outB.indexOf('toBeGreaterThan');
    const idxSecondBlock = outB.indexOf('estrutura');
    expect(idxNew).toBeGreaterThan(idxSecondBlock); // a inserção ficou no bloco B, depois de 'estrutura'
    // in_lines apontando para o bloco A edita a OUTRA ocorrência.
    const opsA = parseEditOperations([rep({ in_lines: [5, 7] })], new Set([FILE]));
    const [changeA] = applyEditOperations(opsA, contentOf({ [FILE]: src }));
    const idxNewA = changeA!.newContent.indexOf('toBeGreaterThan');
    expect(idxNewA).toBeLessThan(changeA!.newContent.indexOf('estrutura'));
  });

  test('in_lines fora do arquivo → recusado (não desambigua)', () => {
    const ops = parseEditOperations([rep({ in_lines: [900, 950] })], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
  });

  test('in_lines apontando para região SEM a âncora (0 no intervalo) → recusado', () => {
    const ops = parseEditOperations([rep({ in_lines: [1, 3] })], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
  });

  test('in_lines abrangente demais (as 2 ocorrências caem no intervalo) → continua recusado', () => {
    const ops = parseEditOperations([rep({ in_lines: [1, 18] })], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
  });

  test('ocorrência única + in_lines correto → sucesso (in_lines não atrapalha o caso já unívoco)', () => {
    const uniq = 'const x = 1;\nconst y = 2;\n';
    const ops = parseEditOperations(
      [{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha256(uniq), before: 'const y = 2;', after: 'const y = 3;', in_lines: [2, 2] }],
      new Set([FILE]),
    );
    const [change] = applyEditOperations(ops, contentOf({ [FILE]: uniq }));
    expect(change!.newContent).toBe('const x = 1;\nconst y = 3;\n');
  });

  test('CRLF: 2 ocorrências, in_lines desambigua e a saída preserva \\r\\n', () => {
    const crlf = src.replace(/\n/g, '\r\n');
    const opsB = parseEditOperations([{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha256(crlf), before: block, after: block + "\n    expect(true).toBe(true);", in_lines: [13, 15] }], new Set([FILE]));
    const [change] = applyEditOperations(opsB, contentOf({ [FILE]: crlf }));
    expect(/[^\r]\n/.test(change!.newContent)).toBe(false); // nenhum LF solto
    expect(change!.newContent.split('expect(true).toBe(true);').length - 1).toBe(1);
  });

  test('in_lines + before===after continua no_effective_edits (in_lines não afrouxa nada)', () => {
    const ops = parseEditOperations([{ kind: 'replace_exact', path: FILE, expected_file_sha256: sha, before: block, after: block, in_lines: [13, 15] }], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_no_effective_edits'); }
  });

  test('in_lines + sha desatualizado continua recusado (staleness antes da desambiguação)', () => {
    const ops = parseEditOperations([rep({ in_lines: [13, 15], expected_file_sha256: sha256('outro') })], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_stale_file_hash'); }
  });

  test('parse recusa in_lines malformado (não-array, tamanho, não-int, início>fim, início<1)', () => {
    const bad: unknown[] = [
      rep({ in_lines: [13] }),
      rep({ in_lines: [13, 15, 20] }),
      rep({ in_lines: ['13', '15'] }),
      rep({ in_lines: [15, 13] }),
      rep({ in_lines: [0, 3] }),
      rep({ in_lines: 13 }),
    ];
    for (const op of bad) {
      try { parseEditOperations([op], new Set([FILE])); throw new Error('deveria lançar'); }
      catch (e) { expect((e as { code?: string }).code).toBe('ollama_invalid_response_schema'); }
    }
  });

  test('insert com anchor repetido: sem in_lines recusa, com in_lines insere em exatamente uma borda', () => {
    const anchor = lines[6]; // "    expect(summary.status).toBe('captured');" — ocorre 2× (linha 7 e 15)
    const ambiguous = parseEditOperations([{ kind: 'insert', path: FILE, expected_file_sha256: sha, anchor, position: 'after', content: "\n    expect(true).toBe(true);" }], new Set([FILE]));
    try { applyEditOperations(ambiguous, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
    const scoped = parseEditOperations([{ kind: 'insert', path: FILE, expected_file_sha256: sha, anchor, position: 'after', content: '\n    // marca-bloco-B', in_lines: [15, 15] }], new Set([FILE]));
    const [change] = applyEditOperations(scoped, contentOf({ [FILE]: src }));
    expect(change!.newContent.split('// marca-bloco-B').length - 1).toBe(1);
    expect(change!.newContent.indexOf('// marca-bloco-B')).toBeGreaterThan(change!.newContent.indexOf('estrutura'));
  });
});

describe('ollama-protocol — insert (âncora exata, before/after)', () => {
  const FILE = 'docs/a.md';
  const contentOf = (files: Record<string, string>) => (p: string): string | null => (p in files ? files[p]! : null);
  const insert = (anchor: string, position: string, content: string, s: string): unknown =>
    ({ kind: 'insert', path: FILE, expected_file_sha256: s, anchor, position, content });

  test('parse aceita insert válido; recusa position inválida, anchor/content vazios, sha inválido, fora do escopo', () => {
    const sha = sha256('linha1\nlinha2\n');
    const ops = parseEditOperations([insert('linha1', 'after', 'X\n', sha)], new Set([FILE]));
    expect(ops[0]!.kind).toBe('insert');
    const bad: [unknown, string][] = [
      [insert('linha1', 'ao-lado', 'X', sha), 'ollama_invalid_response_schema'],
      [insert('', 'after', 'X', sha), 'ollama_invalid_response_schema'],
      [insert('linha1', 'after', '', sha), 'ollama_invalid_response_schema'],
      [{ kind: 'insert', path: FILE, expected_file_sha256: 'nope', anchor: 'a', position: 'after', content: 'x' }, 'ollama_invalid_response_schema'],
      [{ kind: 'insert', path: 'fora/y.md', expected_file_sha256: sha, anchor: 'a', position: 'after', content: 'x' }, 'ollama_edit_outside_scope'],
    ];
    for (const [op, code] of bad) {
      try { parseEditOperations([op], new Set([FILE])); throw new Error('deveria lançar'); }
      catch (e) { expect((e as { code?: string }).code).toBe(code); }
    }
  });

  test('insert after/before posiciona ao redor da âncora única, preservando o resto byte a byte', () => {
    const src = 'a\nb\nc\n'; const sha = sha256(src);
    const after = applyEditOperations(parseEditOperations([insert('b\n', 'after', 'NOVO\n', sha)], new Set([FILE])), contentOf({ [FILE]: src }));
    expect(after[0]!.newContent).toBe('a\nb\nNOVO\nc\n');
    const before = applyEditOperations(parseEditOperations([insert('c\n', 'before', 'NOVO\n', sha)], new Set([FILE])), contentOf({ [FILE]: src }));
    expect(before[0]!.newContent).toBe('a\nb\nNOVO\nc\n');
  });

  test('adiciona um caso DENTRO de um bloco ancorando no último elemento (não no fim do arquivo, como o append faria)', () => {
    const src = "describe('s', () => {\n  test('a', () => { expect(1).toBe(1); });\n});\n";
    const anchor = "  test('a', () => { expect(1).toBe(1); });";
    const novo = "\n  test('b', () => { expect(2).toBe(2); });";
    const out = applyEditOperations(parseEditOperations([insert(anchor, 'after', novo, sha256(src))], new Set([FILE])), contentOf({ [FILE]: src }))[0]!.newContent;
    expect(out).toBe("describe('s', () => {\n  test('a', () => { expect(1).toBe(1); });\n  test('b', () => { expect(2).toBe(2); });\n});\n");
    // O novo caso fica ANTES do `});` que fecha o describe (dentro do bloco léxico).
    expect(out.indexOf("test('b'")).toBeLessThan(out.lastIndexOf('});'));
  });

  test('âncora ambígua (>1) e ausente (0) são recusadas; hash desatualizado é recusado; CRLF preservado', () => {
    const src = 'x\nx\n'; const sha = sha256(src);
    try { applyEditOperations(parseEditOperations([insert('x', 'after', 'Y', sha)], new Set([FILE])), contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
    try { applyEditOperations(parseEditOperations([insert('NÃO EXISTE', 'after', 'Y', sha)], new Set([FILE])), contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
    try { applyEditOperations(parseEditOperations([insert('x\n', 'after', 'Y', sha256('outro'))], new Set([FILE])), contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_stale_file_hash'); }
    const crlf = 'p\r\nq\r\n';
    const out = applyEditOperations(parseEditOperations([insert('p\n', 'after', 'R\n', sha256(crlf))], new Set([FILE])), contentOf({ [FILE]: crlf }))[0]!.newContent;
    expect(out).toBe('p\r\nR\r\nq\r\n');
  });

  test('insert que sobrepõe/toca um replace no mesmo arquivo é recusado (fail-closed)', () => {
    const src = 'INICIO meio FIM\n'; const sha = sha256(src);
    const ops = parseEditOperations([
      { kind: 'replace_exact', path: FILE, expected_file_sha256: sha, before: 'meio', after: 'X' },
      insert('meio', 'before', 'Y', sha),
    ], new Set([FILE]));
    try { applyEditOperations(ops, contentOf({ [FILE]: src })); throw new Error('deveria lançar'); }
    catch (e) { expect((e as { code?: string }).code).toBe('ollama_ambiguous_replacement'); }
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
