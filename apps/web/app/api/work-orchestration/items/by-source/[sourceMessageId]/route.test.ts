/**
 * @jest-environment node
 */
// Regressão da divergência backend×UI: o cartão INLINE do chat hidrata por
// `by-source`; se este endpoint não projetar `retryReadiness`, um Item `failed`
// RETRY_READY chega ao card sem a ação de retry (mostrando a mensagem genérica).
// A projeção autoritativa (mesma RPC de `items`/`items/[id]`) deve acompanhar cada
// apresentação reconstruída.
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/autonomous-readiness', () => ({ projectAutonomousReadiness: jest.fn() }));
jest.mock('@/lib/work-orchestration/retry-readiness', () => ({ readWorkRetryReadiness: jest.fn() }));
jest.mock('@/lib/work-orchestration/serialize', () => ({ serializeReconstructedWorkPresentation: jest.fn() }));

import { GET } from './route';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { projectAutonomousReadiness } from '@/lib/work-orchestration/autonomous-readiness';
import { readWorkRetryReadiness } from '@/lib/work-orchestration/retry-readiness';
import { serializeReconstructedWorkPresentation } from '@/lib/work-orchestration/serialize';

const createClientMock = createClient as jest.Mock;
const service = createWorkOrchestrationService as jest.Mock;
const autonomous = projectAutonomousReadiness as jest.Mock;
const retry = readWorkRetryReadiness as jest.Mock;
const serialize = serializeReconstructedWorkPresentation as jest.Mock;

const ctx = (sourceMessageId: string) => ({ params: Promise.resolve({ sourceMessageId }) });
const clientWith = (user: unknown) => ({ auth: { getUser: async () => ({ data: { user } }) } });
const RETRY_READY = { status: 'RETRY_READY', reason: null, attemptsUsed: 1, maxAttempts: 2, remainingAttempts: 1, sourceAttemptId: 'a1', failureEventId: 'f1', proposalVersion: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  autonomous.mockResolvedValue(new Map([['0cedae21', { eligible: false, blockingDependencyIds: [], reason: 'not_eligible' }]]));
  serialize.mockImplementation((item: { id: string }) => ({ item: { id: item.id, state: 'failed' } }));
});

test('sem autenticação → 401 e o serviço não é criado', async () => {
  createClientMock.mockResolvedValue(clientWith(null));
  const res = await GET({} as Request, ctx('m1'));
  expect(res.status).toBe(401);
  expect(service).not.toHaveBeenCalled();
});

test('cada apresentação reconstruída carrega a MESMA readiness autoritativa de retry', async () => {
  const findItemsBySourceMessageId = jest.fn().mockResolvedValue({ ok: true, value: [{ id: '0cedae21', intent: {} }] });
  const listEvents = jest.fn().mockResolvedValue({ ok: true, value: [] });
  const listContexts = jest.fn().mockResolvedValue({ ok: true, value: [] });
  service.mockReturnValue({ findItemsBySourceMessageId, listEvents, listContexts });
  retry.mockResolvedValue(RETRY_READY);
  createClientMock.mockResolvedValue(clientWith({ id: 'user-1' }));

  const res = await GET({} as Request, ctx('m1'));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.value[0].retryReadiness).toEqual(RETRY_READY);
  expect(retry).toHaveBeenCalledWith(expect.anything(), '0cedae21');
});
