/** @jest-environment node */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/paid-compute-authorization-store', () => ({ revokePaidComputeAuthorization: jest.fn() }));

import { DELETE } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { revokePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';

const authMock = authenticateRequest as jest.Mock;
const revokeMock = revokePaidComputeAuthorization as jest.Mock;

const req = (): Request => ({ headers: { get: () => null } } as unknown as Request);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ client: {}, userId: 'u1' });
  revokeMock.mockResolvedValue({ ok: true, authorizationId: UUID });
});

test('sem auth → 401, sem revogar', async () => {
  authMock.mockResolvedValue(null);
  expect((await DELETE(req(), ctx(UUID))).status).toBe(401);
  expect(revokeMock).not.toHaveBeenCalled();
});

test('id não-UUID → 400, sem revogar', async () => {
  expect((await DELETE(req(), ctx('nope'))).status).toBe(400);
  expect(revokeMock).not.toHaveBeenCalled();
});

test('id UUID válido → revoga e devolve 200', async () => {
  const res = await DELETE(req(), ctx(UUID));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, value: { authorizationId: UUID } });
  expect(revokeMock).toHaveBeenCalledWith({}, UUID);
});

test('autorização inexistente/alheia → 404', async () => {
  revokeMock.mockResolvedValue({ ok: false, code: 'not_found', message: 'not found' });
  expect((await DELETE(req(), ctx(UUID))).status).toBe(404);
});
