/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

import { POST } from './route';
import { createClient } from '@/lib/supabase/server';

const createClientMock = createClient as jest.Mock;

const request = (body: unknown): Request => ({ json: async () => body } as unknown as Request);
const clientWith = (user: unknown, rpc: jest.Mock) => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc });
const validBody = { workItemId: 'w', expectedProposalVersion: 1, acceptedResultEventId: 'e1', decision: 'authorize', decisionId: 'd1' };

beforeEach(() => jest.clearAllMocks());

// A rota exercita o caminho REAL route → service → repositório Supabase → rpc; só
// o client.rpc é mockado. A semântica profunda da RPC (idempotência, correlação,
// isolamento por RLS) é provada em pgTAP; aqui prova-se autenticação, o mapeamento
// exato dos argumentos e a propagação de cada desfecho para o HTTP.

test('sem autenticação → 401 e a RPC não é chamada', async () => {
  const rpc = jest.fn();
  createClientMock.mockResolvedValue(clientWith(null, rpc));
  const res = await POST(request(validBody));
  expect(res.status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});

test('authorize válido → 200 e a RPC recebe os argumentos exatos', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { action: 'recorded', decision: 'authorize', event_seq: 5 }, error: null });
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  const res = await POST(request(validBody));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: { action: 'recorded', decision: 'authorize', eventSeq: 5 } });
  expect(rpc).toHaveBeenCalledWith('decide_integration', {
    work_item_id: 'w', expected_proposal_version: 1, accepted_result_event_id: 'e1', decision: 'authorize', decision_id: 'd1',
  });
});

test('refuse válido → 200 com a decisão refuse', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { action: 'recorded', decision: 'refuse', event_seq: 6 }, error: null });
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  const res = await POST(request({ ...validBody, decision: 'refuse' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, value: { decision: 'refuse' } });
  expect(rpc.mock.calls[0][1].decision).toBe('refuse');
});

test('replay idempotente → 200 com action replayed', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { action: 'replayed', decision: 'authorize', event_seq: 5 }, error: null });
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  const res = await POST(request(validBody));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, value: { action: 'replayed' } });
});

test('conflito / resultado divergente (55000) → 409', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'integration decision conflict' } });
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  const res = await POST(request(validBody));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'version_conflict' } });
});

test('item ou resultado aceito não encontrado / isolamento por RLS (P0002) → 404', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: 'P0002', message: 'accepted result not found' } });
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  const res = await POST(request(validBody));
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'work_item_not_found' } });
});

test('entrada inválida → 400 e a RPC não é chamada (validação no serviço)', async () => {
  const rpc = jest.fn();
  createClientMock.mockResolvedValue(clientWith({ id: 'u' }, rpc));
  expect((await POST(request({ ...validBody, decisionId: '  ' }))).status).toBe(400);
  expect((await POST(request({ ...validBody, decision: 'maybe' }))).status).toBe(400);
  expect((await POST(request({ ...validBody, acceptedResultEventId: '' }))).status).toBe(400);
  expect((await POST(request({ ...validBody, expectedProposalVersion: 0 }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
