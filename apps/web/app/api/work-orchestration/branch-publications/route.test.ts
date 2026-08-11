/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createBearerClient: jest.fn(),
}));
jest.mock('@/lib/work-orchestration/branch-publication-http', () => ({ runAuthorizedBranchPublicationWithSupabase: jest.fn() }));

import { POST } from './route';
import { createClient } from '@/lib/supabase/server';
import { runAuthorizedBranchPublicationWithSupabase } from '@/lib/work-orchestration/branch-publication-http';
import { BRANCH_PUBLICATION_PROVIDER_ID } from '@/lib/work-orchestration/integration-target';

const createClientMock = createClient as jest.Mock;
const runMock = runAuthorizedBranchPublicationWithSupabase as jest.Mock;

const request = (body: unknown): Request => ({ json: async () => body, headers: { get: () => null }, signal: undefined } as unknown as Request);
const authed = (user: unknown) => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
const WID = '11111111-1111-4111-8111-111111111111';

const ENV = {
  ANIMA_INTEGRATION_REPOSITORY_ID: 'https://github.com/anima/anima',
  ANIMA_INTEGRATION_REMOTE_NAME: 'origin',
  ANIMA_INTEGRATION_BASE_BRANCH: 'main',
  ANIMA_INTEGRATION_REPO_ROOT: process.platform === 'win32' ? 'C:\\repo\\anima' : '/repo/anima',
};

const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => Object.keys(ENV).forEach(key => { delete (process.env as Record<string, unknown>)[key]; });

beforeEach(() => { jest.clearAllMocks(); setEnv(); runMock.mockResolvedValue({ status: 200, body: { ok: true, value: { status: 'published' } } }); });
afterEach(clearEnv);

test('sem autenticação → 401 e o runner não é chamado', async () => {
  createClientMock.mockResolvedValue(authed(null));
  const res = await POST(request({ workItemId: 'w' }));
  expect(res.status).toBe(401);
  expect(runMock).not.toHaveBeenCalled();
});

test('workItemId ausente, em branco ou não-UUID → 400 e o runner não é chamado', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  expect((await POST(request({}))).status).toBe(400);
  expect((await POST(request({ workItemId: '   ' }))).status).toBe(400);
  expect((await POST(request({ workItemId: 42 }))).status).toBe(400);
  expect((await POST(request({ workItemId: 'not-a-uuid' }))).status).toBe(400);
  expect((await POST(request({ workItemId: "11111111-1111-4111-8111-111111111111'; drop" }))).status).toBe(400);
  expect((await POST(request(null))).status).toBe(400);
  expect(runMock).not.toHaveBeenCalled();
});

test('alvo não configurado no servidor → 503 fail-closed, sem tocar o runner', async () => {
  clearEnv();
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'integration_target_not_configured' } });
  expect(runMock).not.toHaveBeenCalled();
});

test('autenticado + configurado → delega com o alvo do SERVIDOR e devolve o desfecho', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(200);
  expect(runMock).toHaveBeenCalledTimes(1);
  const [client, input] = runMock.mock.calls[0];
  expect(client).toBeTruthy(); // o cliente autenticado (RLS) é passado ao runner
  expect(input.workItemId).toBe(WID);
  expect(input.target).toEqual({ providerId: BRANCH_PUBLICATION_PROVIDER_ID, repositoryId: ENV.ANIMA_INTEGRATION_REPOSITORY_ID, remoteName: 'origin', baseBranch: 'main' });
  expect(input.provider.id).toBe(BRANCH_PUBLICATION_PROVIDER_ID);
});

test('o cliente NÃO escolhe remote/refspec/branch/SHA/provider: campos maliciosos são ignorados', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  await POST(request({
    workItemId: WID,
    target: { providerId: 'evil', repositoryId: 'evil/repo', remoteName: 'evil', baseBranch: 'main' },
    remoteName: 'evil', refspec: '+refs/heads/*:refs/heads/*', commitSha: 'c'.repeat(40), branch: 'main', provider: 'evil', idempotencyKey: 'evil',
  }));
  const input = runMock.mock.calls[0][1];
  expect(input.target.remoteName).toBe('origin');
  expect(input.target.repositoryId).toBe(ENV.ANIMA_INTEGRATION_REPOSITORY_ID);
  expect(input.target.providerId).toBe(BRANCH_PUBLICATION_PROVIDER_ID);
  // nada além de workItemId/target/provider/signal chega ao runner — nenhum campo do cliente
  expect(Object.keys(input).sort()).toEqual(['provider', 'signal', 'target', 'workItemId']);
});

test('desfecho de falha do runner é repassado com o mesmo status', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  runMock.mockResolvedValue({ status: 409, body: { ok: false, error: { code: 'publication_conflict' } } });
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'publication_conflict' } });
});
