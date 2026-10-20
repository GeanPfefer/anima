/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

import { GET } from './route';
import { createClient } from '@/lib/supabase/server';
import type { CatalogBuilder } from '@/lib/work-orchestration/work-catalog';

const createClientMock = createClient as jest.Mock;
const request = (query = ''): Request => new Request(`http://localhost/api/work-orchestration/catalog${query}`);

interface Seen { filters: string[]; eq: [string, string][] }
function clientWith(user: { id: string } | null, options: { fail?: boolean; rows?: unknown[]; total?: number } = {}) {
  const seen: Seen = { filters: [], eq: [] };
  let heads = 0;
  const builder = (head: boolean): CatalogBuilder => {
    const self: CatalogBuilder = {
      eq: (column, value) => { seen.eq.push([column, value]); return self; },
      in: () => self,
      or: filters => { seen.filters.push(filters); return self; },
      order: () => self,
      range: () => self,
      then: (onfulfilled, onrejected) => {
        if (options.fail) return Promise.resolve({ data: null, count: null, error: { message: 'segredo-interno' } }).then(onfulfilled, onrejected);
        if (head) { heads += 1; return Promise.resolve({ data: null, count: heads === 1 ? 2 : options.total ?? 1, error: null }).then(onfulfilled, onrejected); }
        return Promise.resolve({ data: options.rows ?? [], count: null, error: null }).then(onfulfilled, onrejected);
      },
    };
    return self;
  };
  return { seen, client: { auth: { getUser: async () => ({ data: { user } }) }, from: () => ({ select: (_c: string, o?: { head?: boolean }) => builder(Boolean(o?.head)) }) } };
}

beforeEach(() => jest.clearAllMocks());

test('sem autenticação → 401 e nenhuma consulta ao catálogo', async () => {
  const { client, seen } = clientWith(null);
  createClientMock.mockResolvedValue(client);
  const res = await GET(request());
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ ok: false, error: { code: 'authentication_required' } });
  expect(seen.eq).toEqual([]);
});

test.each(['?estado=nope', '?pagina=0', '?tamanho=500', '?ordem=x'])('consulta inválida %s → 400 sem tocar no banco', async query => {
  const { client, seen } = clientWith({ id: 'u1' });
  createClientMock.mockResolvedValue(client);
  const res = await GET(request(query));
  expect(res.status).toBe(400);
  expect((await res.json()).error.code).toBe('invalid_catalog_query');
  expect(seen.eq).toEqual([]);
});

test('200: devolve a página leve, escopada ao usuário autenticado e com a busca global no banco', async () => {
  const { client, seen } = clientWith({ id: 'u1' }, { total: 1, rows: [{
    id: '11111111-1111-4111-8111-111111111111', state: 'review', proposal_version: 1, created_at: '2026-10-20T19:00:00+00:00',
    updated_at: '2026-10-20T20:00:00+00:00', ref: 'PROOF-01', canonical_title: 'Título', summary: 'Resumo', inv_ref: null, question: null,
  }] });
  createClientMock.mockResolvedValue(client);
  const res = await GET(request('?q=PROOF-01&estado=review'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.value).toMatchObject({ page: 1, pageSize: 25, total: 1, totalPages: 1, pendingTotal: 2 });
  expect(body.value.items[0]).toMatchObject({ reference: 'PROOF-01', needsHuman: true, humanAction: 'Revisar resultado' });
  expect(Object.keys(body.value.items[0]).sort()).toEqual(
    ['createdAt', 'humanAction', 'href', 'id', 'needsHuman', 'proposalVersion', 'reference', 'state', 'stateLabel', 'summary', 'title', 'updatedAt'].sort());
  expect(seen.eq.every(([column, value]) => column === 'user_id' && value === 'u1')).toBe(true);
  expect(seen.filters.some(filter => filter.includes('ilike.*PROOF-01*'))).toBe(true);
});

test('falha de leitura → 503 sem vazar a mensagem interna', async () => {
  const { client } = clientWith({ id: 'u1' }, { fail: true });
  createClientMock.mockResolvedValue(client);
  const res = await GET(request());
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(text).toContain('catalog_unavailable');
  expect(text).not.toContain('segredo-interno');
});
