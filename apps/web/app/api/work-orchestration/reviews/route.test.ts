/** @jest-environment node */
const reviewResult = jest.fn(async () => ({ ok: true, value: { id: 'w1', state: 'completed' } }));
const getUser = jest.fn(async (): Promise<{ data: { user: { id: string } | null } }> => ({ data: { user: { id: 'u' } } }));
const refusal = jest.fn();
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(async () => ({ auth: { getUser } })) }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn(() => ({ reviewResult })) }));
jest.mock('@/lib/work-orchestration/external-candidate-review', () => ({ createExternalReviewDeps: jest.fn(() => ({ deps: true })), externalAcceptanceRefusal: (...args: unknown[]) => refusal(...args) }));
jest.mock('@/lib/work-orchestration/http', () => ({ operationResponse: (result: { ok: boolean; value?: unknown }) => Response.json(result) }));
jest.mock('@/lib/work-orchestration/serialize', () => ({ serializeWorkItem: (x: unknown) => x }));

import { POST } from './route';

const call = (decision: unknown) => POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ workItemId: 'w1', expectedProposalVersion: 1, reviewedResultEventId: 'r1', decision }) }));
beforeEach(() => { jest.clearAllMocks(); getUser.mockResolvedValue({ data: { user: { id: 'u' } } }); });

describe('POST /api/work-orchestration/reviews — gate de trabalho externo (T4)', () => {
  test('aceite recusado pelo gate: 409 com o código, e reviewResult NÃO é chamado', async () => {
    refusal.mockResolvedValue({ code: 'external_human_review_missing', message: 'falta revisão' });
    const res = await call({ type: 'accept' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: { code: 'external_human_review_missing', message: 'falta revisão' } });
    expect(refusal).toHaveBeenCalledWith('w1', { deps: true });
    expect(reviewResult).not.toHaveBeenCalled();
  });
  test('gate sem recusa (interno, ou externo revisado): o fluxo antigo segue idêntico', async () => {
    refusal.mockResolvedValue(null);
    const res = await call({ type: 'accept' });
    expect(res.status).toBe(200);
    expect(reviewResult).toHaveBeenCalledTimes(1);
  });
  test('request_changes nunca passa pelo gate', async () => {
    const res = await call({ type: 'request_changes', requestedChanges: 'ajustar' });
    expect(res.status).toBe(200);
    expect(refusal).not.toHaveBeenCalled();
    expect(reviewResult).toHaveBeenCalledTimes(1);
  });
  test('sem sessão: 401 e nada acontece', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call({ type: 'accept' });
    expect(res.status).toBe(401);
    expect(refusal).not.toHaveBeenCalled(); expect(reviewResult).not.toHaveBeenCalled();
  });
});
