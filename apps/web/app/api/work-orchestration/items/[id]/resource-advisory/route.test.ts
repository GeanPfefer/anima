/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/resource-governor', () => ({ composeItemGateAdvisory: jest.fn(), declaredGateCommands: jest.fn() }));

import { GET } from './route';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { composeItemGateAdvisory, declaredGateCommands } from '@/lib/work-orchestration/resource-governor';

const createClientMock = createClient as jest.Mock;
const service = createWorkOrchestrationService as jest.Mock;
const compose = composeItemGateAdvisory as jest.Mock;
const declared = declaredGateCommands as jest.Mock;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const clientWith = (user: unknown) => ({ auth: { getUser: async () => ({ data: { user } }) } });

beforeEach(() => {
  jest.clearAllMocks();
  declared.mockReturnValue(['npm run typecheck']);
  compose.mockReturnValue({ snapshot: null, pressure: 'low', distribution: { count: 0, p50Ms: 0, p90Ms: 0, maxMs: 0 }, advisories: [] });
});

test('sem autenticação → 401 e o serviço não é criado', async () => {
  createClientMock.mockResolvedValue(clientWith(null));
  const res = await GET({} as Request, ctx('w'));
  expect(res.status).toBe(401);
  expect(service).not.toHaveBeenCalled();
});

test('autenticado → advisory dos gates DECLARADOS a partir da evidência MACHINE-WIDE', async () => {
  const getItem = jest.fn().mockResolvedValue({ ok: true, value: { id: 'w', intent: {} } });
  const listEventsByType = jest.fn().mockResolvedValue({ ok: true, value: [{ id: 'e1' }] });
  service.mockReturnValue({ getItem, listEventsByType });
  createClientMock.mockResolvedValue(clientWith({ id: 'user-1' }));
  const report = { snapshot: null, pressure: 'high', distribution: { count: 3, p50Ms: 1, p90Ms: 2, maxMs: 3 }, advisories: [{ key: { workloadKind: 'gate', command: 'npm run typecheck', repo: null }, advisory: { recommendation: 'safe_to_run', rationale: 'r', basis: { workloadClass: 'low', machinePressure: 'high', sampleCount: 3, reserveActive: false } } }] };
  compose.mockReturnValue(report);

  const res = await GET({} as Request, ctx('w'));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, value: { resourceGovernor: report } });
  expect(getItem).toHaveBeenCalledWith('w');
  expect(declared).toHaveBeenCalledWith({ id: 'w', intent: {} });          // gates do CONTRATO do item
  expect(listEventsByType).toHaveBeenCalledWith('host_observed_gate_evidence_recorded'); // machine-wide
  expect(compose).toHaveBeenCalledWith({ commands: ['npm run typecheck'], events: [{ id: 'e1' }] });
});

test('item inexistente/sem acesso → propaga o erro sem compor advisory nem ler eventos', async () => {
  const getItem = jest.fn().mockResolvedValue({ ok: false, error: { code: 'work_item_not_found', message: 'não encontrado', retryable: false } });
  const listEventsByType = jest.fn();
  service.mockReturnValue({ getItem, listEventsByType });
  createClientMock.mockResolvedValue(clientWith({ id: 'user-1' }));

  const res = await GET({} as Request, ctx('missing'));

  expect(res.status).not.toBe(200);
  expect((await res.json()).ok).toBe(false);
  expect(listEventsByType).not.toHaveBeenCalled();
  expect(compose).not.toHaveBeenCalled();
});
