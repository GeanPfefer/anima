/** @jest-environment node */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/paid-compute-authorization-store', () => ({
  listPaidComputeAuthorizations: jest.fn(),
  grantPaidComputeAuthorization: jest.fn(),
}));

import { GET, POST } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { grantPaidComputeAuthorization, listPaidComputeAuthorizations } from '@/lib/work-orchestration/paid-compute-authorization-store';

const authMock = authenticateRequest as jest.Mock;
const grantMock = grantPaidComputeAuthorization as jest.Mock;
const listMock = listPaidComputeAuthorizations as jest.Mock;

const req = (body: unknown): Request => ({ json: async () => body, headers: { get: () => null } } as unknown as Request);
const authed = () => ({ client: {}, userId: 'u1' });

const validBody = {
  providerId: 'runpod', maxDurationMs: 1_800_000,
  maxCost: { currency: 'USD', amount: 1 },
  validFrom: '2026-08-31T00:00:00.000Z', validUntil: '2026-08-31T01:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue(authed());
  grantMock.mockResolvedValue({ ok: true, authorizationId: 'new-id' });
  listMock.mockResolvedValue({ ok: true, authorizations: [] });
});

describe('GET /paid-compute-authorizations', () => {
  test('sem auth → 401', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(null))).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
  test('autenticado → lista', async () => {
    listMock.mockResolvedValue({ ok: true, authorizations: [{ id: 'a' }] });
    const res = await GET(req(null));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, value: [{ id: 'a' }] });
  });
});

describe('POST /paid-compute-authorizations (concessão = ato humano explícito)', () => {
  test('sem auth → 401, sem conceder', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req(validBody))).status).toBe(401);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('providerId ausente → 400, sem conceder', async () => {
    expect((await POST(req({ ...validBody, providerId: '  ' }))).status).toBe(400);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('maxDurationMs não-positivo/não-inteiro → 400', async () => {
    expect((await POST(req({ ...validBody, maxDurationMs: 0 }))).status).toBe(400);
    expect((await POST(req({ ...validBody, maxDurationMs: 1.5 }))).status).toBe(400);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('workItemId não-UUID → 400', async () => {
    expect((await POST(req({ ...validBody, workItemId: 'nope' }))).status).toBe(400);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('validUntil <= validFrom → 400', async () => {
    expect((await POST(req({ ...validBody, validUntil: validBody.validFrom }))).status).toBe(400);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('maxCost ausente/malformado/não-positivo → 400', async () => {
    expect((await POST(req({ ...validBody, maxCost: null }))).status).toBe(400);
    expect((await POST(req({ ...validBody, maxCost: { currency: 'USD' } }))).status).toBe(400);
    expect((await POST(req({ ...validBody, maxCost: { currency: 'USD', amount: -1 } }))).status).toBe(400);
    expect((await POST(req({ ...validBody, maxCost: { currency: 'USD', amount: 0 } }))).status).toBe(400);
    expect(grantMock).not.toHaveBeenCalled();
  });

  test('corpo válido → concede com envelope normalizado (opcionais nulos)', async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, value: { authorizationId: 'new-id' } });
    expect(grantMock).toHaveBeenCalledTimes(1);
    expect(grantMock.mock.calls[0][1]).toMatchObject({ providerId: 'runpod', nodeId: null, resourceClass: null, workItemId: null, maxCost: { currency: 'USD', amount: 1 } });
  });

  test('corpo válido com custo e node → concede com envelope completo', async () => {
    await POST(req({ ...validBody, nodeId: 'm1', resourceClass: 'gpu', maxCost: { currency: 'USD', amount: 3 } }));
    expect(grantMock.mock.calls[0][1]).toMatchObject({ nodeId: 'm1', resourceClass: 'gpu', maxCost: { currency: 'USD', amount: 3 } });
  });

  test('erro forbidden do store (service_role/negado) → 403', async () => {
    grantMock.mockResolvedValue({ ok: false, code: 'forbidden', message: 'human required' });
    expect((await POST(req(validBody))).status).toBe(403);
  });
});
