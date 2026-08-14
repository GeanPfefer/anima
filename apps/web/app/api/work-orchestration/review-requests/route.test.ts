/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createBearerClient: jest.fn(),
}));
jest.mock('@/lib/work-orchestration/review-request-http', () => ({ runAuthorizedReviewRequestWithSupabase: jest.fn() }));

import { POST } from './route';
import { createClient } from '@/lib/supabase/server';
import { runAuthorizedReviewRequestWithSupabase } from '@/lib/work-orchestration/review-request-http';
import { BRANCH_PUBLICATION_PROVIDER_ID } from '@/lib/work-orchestration/integration-target';

const createClientMock = createClient as jest.Mock;
const runMock = runAuthorizedReviewRequestWithSupabase as jest.Mock;

const request = (body: unknown): Request => ({ json: async () => body, headers: { get: () => null }, signal: undefined } as unknown as Request);
const authed = (user: unknown) => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
const WID = '11111111-1111-4111-8111-111111111111';

const TARGET_ENV = {
  ANIMA_INTEGRATION_REPOSITORY_ID: 'https://github.com/anima/anima',
  ANIMA_INTEGRATION_REMOTE_NAME: 'origin',
  ANIMA_INTEGRATION_BASE_BRANCH: 'main',
  ANIMA_INTEGRATION_REPO_ROOT: process.platform === 'win32' ? 'C:\\repo\\anima' : '/repo/anima',
};
const GITHUB_ENV = { ANIMA_INTEGRATION_GITHUB_TOKEN: 'ghp_test_token' };
const ALL_ENV = { ...TARGET_ENV, ...GITHUB_ENV };

const setEnv = (env: Record<string, string>) => Object.assign(process.env, env);
const clearEnv = () => Object.keys(ALL_ENV).forEach(key => { delete (process.env as Record<string, unknown>)[key]; });

beforeEach(() => { jest.clearAllMocks(); clearEnv(); setEnv(ALL_ENV); runMock.mockResolvedValue({ status: 200, body: { ok: true, value: { status: 'created' } } }); });
afterEach(clearEnv);

test('sem autenticação → 401 e o runner não é chamado', async () => {
  createClientMock.mockResolvedValue(authed(null));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(401);
  expect(runMock).not.toHaveBeenCalled();
});

test('workItemId ausente ou não-UUID → 400 e o runner não é chamado', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  expect((await POST(request({}))).status).toBe(400);
  expect((await POST(request({ workItemId: '   ' }))).status).toBe(400);
  expect((await POST(request({ workItemId: 'not-a-uuid' }))).status).toBe(400);
  expect((await POST(request(null))).status).toBe(400);
  expect(runMock).not.toHaveBeenCalled();
});

test('token do GitHub ausente → 503 fail-closed, sem tocar o runner', async () => {
  clearEnv(); setEnv(TARGET_ENV); // alvo presente, token ausente
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'review_request_not_configured' } });
  expect(runMock).not.toHaveBeenCalled();
});

test('alvo do servidor ausente → 503 fail-closed, sem tocar o runner', async () => {
  clearEnv(); setEnv(GITHUB_ENV); // token presente, alvo ausente
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(503);
  expect(runMock).not.toHaveBeenCalled();
});

test('autenticado + totalmente configurado → delega com alvo do SERVIDOR e provider de id fixo', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(200);
  expect(runMock).toHaveBeenCalledTimes(1);
  const [client, input] = runMock.mock.calls[0];
  expect(client).toBeTruthy();
  expect(input.workItemId).toBe(WID);
  expect(input.target).toEqual({ providerId: BRANCH_PUBLICATION_PROVIDER_ID, repositoryId: TARGET_ENV.ANIMA_INTEGRATION_REPOSITORY_ID, remoteName: 'origin', baseBranch: 'main' });
  expect(input.provider.id).toBe(BRANCH_PUBLICATION_PROVIDER_ID);
});

test('o cliente NÃO escolhe alvo/provider/token: campos maliciosos são ignorados', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  await POST(request({ workItemId: WID, target: { providerId: 'evil', repositoryId: 'evil/repo', remoteName: 'evil', baseBranch: 'main' }, token: 'evil', provider: 'evil' }));
  const input = runMock.mock.calls[0][1];
  expect(input.target.repositoryId).toBe(TARGET_ENV.ANIMA_INTEGRATION_REPOSITORY_ID);
  expect(input.target.providerId).toBe(BRANCH_PUBLICATION_PROVIDER_ID);
  expect(Object.keys(input).sort()).toEqual(['provider', 'signal', 'target', 'workItemId']);
});

test('desfecho de falha do runner é repassado com o mesmo status', async () => {
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  runMock.mockResolvedValue({ status: 404, body: { ok: false, error: { code: 'not_reviewable' } } });
  const res = await POST(request({ workItemId: WID }));
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'not_reviewable' } });
});

test('cliente desconectado NÃO aborta a operação durável: signal desacoplado do request', async () => {
  // A autorização de integração já está persistida; criar o PR é efeito mutativo.
  // Abandonar a página / perder a conexão não pode abortar o POST /pulls no meio
  // (efeito possível + nada persistido = ambiguidade). Mesmo racional de
  // /supervisor-turn e /execute-commanded: o ciclo não herda o lifetime do HTTP.
  createClientMock.mockResolvedValue(authed({ id: 'u' }));
  const controller = new AbortController();
  controller.abort();
  const req = { json: async () => ({ workItemId: WID }), headers: { get: () => null }, signal: controller.signal } as unknown as Request;
  await POST(req);
  expect(runMock).toHaveBeenCalledTimes(1);
  const input = runMock.mock.calls[0][1];
  expect(input.signal).toBeDefined();
  expect((input.signal as AbortSignal).aborted).toBe(false);
});
