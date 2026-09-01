/** @jest-environment node */
jest.mock('@/lib/supabase/request-auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/work-orchestration/paid-compute-lease-reconciler-deps', () => ({ readPaidComputeAudit: jest.fn() }));
jest.mock('@/lib/work-orchestration/paid-compute-authorization-store', () => ({ listPaidComputeBudgetAudit: jest.fn() }));

import { GET } from './route';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { readPaidComputeAudit } from '@/lib/work-orchestration/paid-compute-lease-reconciler-deps';
import { listPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const authMock = authenticateRequest as jest.Mock;
const auditMock = readPaidComputeAudit as jest.Mock;
const budgetMock = listPaidComputeBudgetAudit as jest.Mock;
const req = (): Request => ({ headers: { get: () => null } } as unknown as Request);

beforeEach(() => { jest.clearAllMocks(); authMock.mockResolvedValue({ client: {}, userId: 'u' }); auditMock.mockResolvedValue({ ok: true, records: [] }); budgetMock.mockResolvedValue({ ok: true, budgets: [] }); });

test('sem auth → 401, não lê auditoria', async () => {
  authMock.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(401);
  expect(auditMock).not.toHaveBeenCalled();
});

test('autenticado → devolve os registros de auditoria', async () => {
  auditMock.mockResolvedValue({ ok: true, records: [{ nodeId: 'n', outcome: 'active', orphanRisk: true }] });
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, value: { leases: [{ nodeId: 'n', orphanRisk: true }], budgets: [] } });
});

test('auditoria indisponível → 503, não devolve "zero" silencioso', async () => {
  auditMock.mockResolvedValue({ ok: false, reason: 'paid_compute_audit_unavailable' });
  const res = await GET(req());
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body).toMatchObject({ ok: false, error: { code: 'paid_compute_audit_unavailable' } });
  expect(body.value).toBeUndefined();
});
