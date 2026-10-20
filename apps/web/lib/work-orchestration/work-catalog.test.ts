/** @jest-environment node */
import {
  HUMAN_ATTENTION_STATES, WORK_STATES, buildCatalogHref, buildSearchFilter, mapCatalogRow, parseCatalogQuery, readCatalogPage,
  sanitizeSearchTerm, type CatalogBuilder, type CatalogClient, type CatalogQuery,
} from './work-catalog';

const baseQuery: CatalogQuery = { search: '', states: [], pendingOnly: false, order: 'updated_desc', page: 1, pageSize: 25 };

interface Call {
  columns: string; options: { count?: 'exact'; head?: boolean } | undefined;
  eq: [string, string][]; in: [string, readonly string[]][]; or: string[]; order: [string, boolean][]; range: [number, number] | null;
}
type Reply = { data: unknown[] | null; count: number | null; error: { message: string; code?: string } | null };

function fakeClient(reply: (call: Call) => Reply): { client: CatalogClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: CatalogClient = {
    from: () => ({
      select: (columns, options) => {
        const call: Call = { columns, options, eq: [], in: [], or: [], order: [], range: null };
        calls.push(call);
        const builder: CatalogBuilder = {
          eq: (column, value) => { call.eq.push([column, value]); return builder; },
          in: (column, values) => { call.in.push([column, values]); return builder; },
          or: filters => { call.or.push(filters); return builder; },
          order: (column, o) => { call.order.push([column, o.ascending]); return builder; },
          range: (from, to) => { call.range = [from, to]; return builder; },
          then: (onfulfilled, onrejected) => Promise.resolve(reply(call)).then(onfulfilled, onrejected),
        };
        return builder;
      },
    }),
  };
  return { client, calls };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', state: 'completed', proposal_version: 1,
  created_at: '2026-10-20T19:43:39.09595+00:00', updated_at: '2026-10-20T20:44:25.38836+00:00',
  ref: 'PROOF-01', inv_ref: null, canonical_title: 'L1-PROOF-01: teto de bônus de XP', question: null, summary: 'Resumo do trabalho', ...overrides,
});

describe('parseCatalogQuery', () => {
  test('padrões', () => {
    expect(parseCatalogQuery(new URLSearchParams())).toEqual({ ok: true, value: baseQuery });
  });
  test('aceita busca, estados repetidos ou por vírgula, pendentes, ordem, página e tamanho', () => {
    const params = new URLSearchParams('q=  PROOF-01 \n x&estado=review,failed&estado=review&pendentes=1&ordem=created_asc&pagina=3&tamanho=10');
    expect(parseCatalogQuery(params)).toEqual({ ok: true, value: {
      search: 'PROOF-01 x', states: ['review', 'failed'], pendingOnly: true, order: 'created_asc', page: 3, pageSize: 10,
    } });
  });
  test('aceita o formato do searchParams do Next (record)', () => {
    const parsed = parseCatalogQuery({ q: 'xp', estado: ['review', 'proposed'], pagina: '2' });
    expect(parsed.ok && parsed.value).toMatchObject({ search: 'xp', states: ['review', 'proposed'], page: 2 });
  });
  test.each([
    ['estado=nope'], ['ordem=nope'], ['pagina=0'], ['pagina=-1'], ['pagina=1.5'], ['pagina=abc'], ['tamanho=0'], ['tamanho=51'], ['pendentes=2'],
    [`q=${'x'.repeat(81)}`],
  ])('rejeita %s', query => {
    const parsed = parseCatalogQuery(new URLSearchParams(query));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('invalid_catalog_query');
  });
});

describe('buildCatalogHref', () => {
  test('omite os padrões e preserva os filtros', () => {
    expect(buildCatalogHref(baseQuery)).toBe('/trabalhos');
    expect(buildCatalogHref({ ...baseQuery, search: 'a b', states: ['review'], pendingOnly: true, order: 'created_desc', page: 2, pageSize: 10 }))
      .toBe('/trabalhos?q=a+b&estado=review&pendentes=1&ordem=created_desc&pagina=2&tamanho=10');
    expect(buildCatalogHref({ ...baseQuery, search: 'x' }, { page: 4 })).toBe('/trabalhos?q=x&pagina=4');
  });
});

describe('busca global', () => {
  test('sanitiza caracteres da sintaxe do filtro e escapa o curinga _', () => {
    expect(sanitizeSearchTerm('a,b(c)"d*e%f\\g:h')).toBe('a b c d e f g h');
    expect(sanitizeSearchTerm('execution_spec')).toBe('execution\\_spec');
    expect(sanitizeSearchTerm(',,()')).toBeNull();
  });
  test('cobre código canônico, de investigação, título e UUID exato', () => {
    const filter = buildSearchFilter('PROOF-01')!;
    for (const path of ['intent->canonical_provenance->>sourceId', 'intent->canonical_provenance->>canonicalObjective',
      'intent->investigation_provenance->>reference', 'intent->>investigation_question', 'proposal->data->>summary']) {
      expect(filter).toContain(`${path}.ilike.*PROOF-01*`);
    }
    expect(filter).not.toContain('id.eq.');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(buildSearchFilter(id)).toContain(`id.eq.${id}`);
    expect(buildSearchFilter(',,')).toBeNull();
  });
  test('uma tentativa de injetar filtros não vira condição nova', () => {
    const filter = buildSearchFilter('x),user_id.neq.0,(y')!;
    expect(filter.split(',')).toHaveLength(5);
    expect(filter).not.toContain('user_id.neq');
  });
});

describe('mapCatalogRow', () => {
  test('projeta código, título e ação humana', () => {
    expect(mapCatalogRow(row())).toMatchObject({
      reference: 'PROOF-01', title: 'L1-PROOF-01: teto de bônus de XP', summary: 'Resumo do trabalho', state: 'completed',
      stateLabel: 'Concluído', needsHuman: false, humanAction: null,
      href: '/trabalhos/PROOF-01?item=11111111-1111-4111-8111-111111111111',
    });
  });
  test.each([['proposed', 'Decidir proposta'], ['review', 'Revisar resultado'], ['changes_requested', 'Tratar mudanças pedidas']])('%s precisa de humano', (state, action) => {
    expect(mapCatalogRow(row({ state }))).toMatchObject({ needsHuman: true, humanAction: action });
  });
  test.each(['approved', 'in_progress', 'blocked', 'completed', 'failed', 'rejected', 'cancelled'])('%s não é decisão pendente', state => {
    expect(mapCatalogRow(row({ state }))?.needsHuman).toBe(false);
  });
  test('sem código: link por UUID, título pelo resumo; investigação usa a pergunta e o código próprio', () => {
    expect(mapCatalogRow(row({ ref: null, canonical_title: null }))).toMatchObject({ reference: null, title: 'Resumo do trabalho', href: '/trabalhos/11111111-1111-4111-8111-111111111111' });
    expect(mapCatalogRow(row({ ref: null, inv_ref: 'INV-03', canonical_title: null, question: 'Q'.repeat(300) }))).toMatchObject({ reference: 'INV-03' });
    expect(mapCatalogRow(row({ ref: null, inv_ref: 'INV-03', canonical_title: null, question: 'Q'.repeat(300) }))?.title).toHaveLength(160);
  });
  test('linhas malformadas ou com estado desconhecido são descartadas', () => {
    expect(mapCatalogRow(null)).toBeNull();
    expect(mapCatalogRow(row({ id: '' }))).toBeNull();
    expect(mapCatalogRow(row({ state: 'estranho' }))).toBeNull();
  });
  test('o critério pendente usa exatamente a governança existente', () => {
    expect([...HUMAN_ATTENTION_STATES].sort()).toEqual(['changes_requested', 'proposed', 'review']);
    expect(WORK_STATES).toHaveLength(10);
  });
});

describe('readCatalogPage', () => {
  const USER = 'user-1';
  // A primeira consulta de contagem é sempre a das pendências globais; a seguinte, a do total filtrado.
  const replyFor = (total: number, rows: unknown[], pending = 3) => {
    let pendingServed = false;
    return (call: Call): Reply => {
      if (call.options?.head) {
        if (!pendingServed) { pendingServed = true; return { data: null, count: pending, error: null }; }
        return { data: null, count: total, error: null };
      }
      return { data: rows, count: null, error: null };
    };
  };

  test('escopo por usuário, ordenação estável (updated_at + id), faixa da página e contagens globais', async () => {
    const { client, calls } = fakeClient(replyFor(60, [row(), row({ id: '22222222-2222-4222-8222-222222222222', state: 'review' })]));
    const result = await readCatalogPage(client, USER, { ...baseQuery, page: 2, pageSize: 25 });
    expect(result.ok && result.value).toMatchObject({ page: 2, pageSize: 25, total: 60, totalPages: 3, pendingTotal: 3 });
    expect(result.ok && result.value.items).toHaveLength(2);
    const rows = calls.find(call => !call.options?.head)!;
    expect(rows.eq).toEqual([['user_id', USER]]);
    expect(rows.order).toEqual([['updated_at', false], ['id', false]]);
    expect(rows.range).toEqual([25, 49]);
    expect(rows.in[0]![1]).toEqual(WORK_STATES);
    expect(calls.every(call => call.eq.some(([column, value]) => column === 'user_id' && value === USER))).toBe(true);
  });
  test.each([
    ['updated_asc', 'updated_at', true], ['created_desc', 'created_at', false], ['created_asc', 'created_at', true],
  ] as const)('ordem %s', async (order, column, ascending) => {
    const { client, calls } = fakeClient(replyFor(1, [row()]));
    await readCatalogPage(client, USER, { ...baseQuery, order });
    expect(calls.find(call => !call.options?.head)!.order).toEqual([[column, ascending], ['id', ascending]]);
  });
  test('busca e estado são filtros do banco, aplicados à contagem e à página', async () => {
    const { client, calls } = fakeClient(replyFor(1, [row()]));
    await readCatalogPage(client, USER, { ...baseQuery, search: 'PROOF-01', states: ['completed'] });
    const filtered = calls.filter(call => call.or.length > 0);
    expect(filtered).toHaveLength(2);
    for (const call of filtered) {
      expect(call.or[0]).toContain('ilike.*PROOF-01*');
      expect(call.in[0]![1]).toEqual(['completed']);
    }
  });
  test('"pendentes" restringe aos estados que aguardam o humano e interseta com o filtro de estado', async () => {
    const first = fakeClient(replyFor(2, [row({ state: 'review' })]));
    await readCatalogPage(first.client, USER, { ...baseQuery, pendingOnly: true });
    expect(first.calls.find(call => !call.options?.head)!.in[0]![1]).toEqual(['proposed', 'review', 'changes_requested'].sort((a, b) => WORK_STATES.indexOf(a as never) - WORK_STATES.indexOf(b as never)));
    const second = fakeClient(replyFor(1, [row({ state: 'review' })]));
    await readCatalogPage(second.client, USER, { ...baseQuery, pendingOnly: true, states: ['review', 'failed'] });
    expect(second.calls.find(call => !call.options?.head)!.in[0]![1]).toEqual(['review']);
  });
  test('interseção vazia ou busca só com símbolos: lista vazia sem consultar a página', async () => {
    const a = fakeClient(replyFor(5, [row()]));
    const empty = await readCatalogPage(a.client, USER, { ...baseQuery, pendingOnly: true, states: ['failed'] });
    expect(empty.ok && empty.value).toMatchObject({ items: [], total: 0, totalPages: 0, pendingTotal: 3 });
    expect(a.calls.every(call => call.options?.head)).toBe(true);
    const b = fakeClient(replyFor(5, [row()]));
    const symbols = await readCatalogPage(b.client, USER, { ...baseQuery, search: ',,()' });
    expect(symbols.ok && symbols.value.total).toBe(0);
    expect(b.calls.every(call => call.options?.head)).toBe(true);
  });
  test('página além do fim é limitada à última; total zero devolve vazio', async () => {
    const { client, calls } = fakeClient(replyFor(30, [row()]));
    const result = await readCatalogPage(client, USER, { ...baseQuery, page: 99 });
    expect(result.ok && result.value.page).toBe(2);
    expect(calls.find(call => !call.options?.head)!.range).toEqual([25, 49]);
    const none = await readCatalogPage(fakeClient(replyFor(0, [])).client, USER, baseQuery);
    expect(none.ok && none.value).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });
  test('erro de leitura vira catalog_unavailable (contagem, página ou pendências)', async () => {
    for (const failing of ['pending', 'count', 'rows'] as const) {
      let n = 0;
      const { client } = fakeClient(call => {
        n += 1;
        const fail = (failing === 'pending' && n === 1) || (failing === 'count' && n === 2) || (failing === 'rows' && n === 3);
        if (fail) return { data: null, count: null, error: { message: 'boom' } };
        return call.options?.head ? { data: null, count: 10, error: null } : { data: [row()], count: null, error: null };
      });
      const result = await readCatalogPage(client, USER, baseQuery);
      expect(result).toMatchObject({ ok: false, code: 'catalog_unavailable' });
      expect(JSON.stringify(result)).not.toContain('boom');
    }
  });
  test('não pede eventos nem a intenção completa: só colunas leves', async () => {
    const { client, calls } = fakeClient(replyFor(1, [row()]));
    await readCatalogPage(client, USER, baseQuery);
    const columns = calls.find(call => !call.options?.head)!.columns;
    expect(columns).not.toMatch(/(^|,)(intent|proposal|payload)(,|$)/);
    expect(columns).toContain('ref:intent->canonical_provenance->>sourceId');
  });
});
