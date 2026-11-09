/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/work-orchestration/executor-readiness', () => ({ createNodeExecutorReadinessDeps: jest.fn(() => ({})), probeAllExecutors: jest.fn(async () => [{ provider: 'codex-cli', availability: 'ready', reasonUnavailable: null }]) }));
jest.mock('@/lib/work-orchestration/codex-executor-diagnostics', () => ({ diagnoseCodexExecutor: jest.fn(async () => ({ transport: 'wsl' })) }));

import { GET } from './route';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const clientWith = (user: unknown) => ({ auth: { getUser: async () => ({ data: { user } }) } });

beforeEach(() => jest.clearAllMocks());

test('401 sem usuário e sem sondar nada', async () => {
  (createClient as jest.Mock).mockResolvedValue(clientWith(null));
  const res = await GET(new Request('http://x'), ctx('a'));
  expect(res.status).toBe(401);
  expect(createWorkOrchestrationService).not.toHaveBeenCalled();
});

test('item inexistente propaga o erro do serviço', async () => {
  (createClient as jest.Mock).mockResolvedValue(clientWith({ id: 'u' }));
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({ getItem: async () => ({ ok: false, error: { code: 'not_found', message: 'x' } }) });
  const res = await GET(new Request('http://x'), ctx('a'));
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test('devolve a descoberta compartilhada e o comando governado, só lendo o item', async () => {
  const getItem = jest.fn(async () => ({ ok: true, value: { id: 'item-1', state: 'approved', proposalVersion: 3, intent: {} } }));
  (createClient as jest.Mock).mockResolvedValue(clientWith({ id: 'u' }));
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({ getItem });
  const res = await GET(new Request('http://x'), ctx('item-1'));
  const body = await res.json() as { ok: boolean; value: { candidates: { provider: string }[]; governedCommand: string; codex: unknown } };
  expect(res.status).toBe(200);
  expect(body.value.candidates.some(c => c.provider === 'codex-cli')).toBe(true);
  expect(body.value.governedCommand).toBe('npm run anima -- work execute-one item-1 --version 3');
  expect(body.value.codex).toEqual({ transport: 'wsl' });
  expect(getItem).toHaveBeenCalledWith('item-1');
});
