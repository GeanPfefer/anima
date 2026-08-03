jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
import { supabase } from './supabase';
import { callHostSupervisorTurn, HostConfigError, HostUnavailableError, resolveHostBaseUrl } from './mobile-host';

const getSession = supabase.auth.getSession as jest.Mock;
const HOST = 'http://100.68.239.78:3000';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_ANIMA_WEB_URL = HOST;
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } } });
  (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, value: { outcome: 'execution_completed' } }) });
});

describe('resolveHostBaseUrl', () => {
  test('aceita http/https e remove barra final', () => {
    expect(resolveHostBaseUrl('http://x:3000/')).toBe('http://x:3000');
    expect(resolveHostBaseUrl('https://anima.example')).toBe('https://anima.example');
  });
  test('recusa ausência (env limpo) e formato inválido', () => {
    delete process.env.EXPO_PUBLIC_ANIMA_WEB_URL;
    expect(resolveHostBaseUrl()).toBeNull();
    expect(resolveHostBaseUrl('')).toBeNull();
    expect(resolveHostBaseUrl('anima.example')).toBeNull();
    expect(resolveHostBaseUrl('ftp://x')).toBeNull();
  });
});

describe('callHostSupervisorTurn', () => {
  test('chama o host com bearer e corpo SEM identidade, e devolve o value', async () => {
    const value = await callHostSupervisorTurn('item-1', 3);
    expect(value).toEqual({ outcome: 'execution_completed' });
    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${HOST}/api/work-orchestration/supervisor-turn`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body)).toEqual({ workItemId: 'item-1', expectedProposalVersion: 3 });
    expect(JSON.parse(init.body)).not.toHaveProperty('user_id');
  });

  test('sem EXPO_PUBLIC_ANIMA_WEB_URL → HostConfigError (não chama fetch)', async () => {
    delete process.env.EXPO_PUBLIC_ANIMA_WEB_URL;
    await expect(callHostSupervisorTurn('item-1', 1)).rejects.toBeInstanceOf(HostConfigError);
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
  });

  test('sem sessão → HostUnavailableError (não chama fetch)', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(callHostSupervisorTurn('item-1', 1)).rejects.toBeInstanceOf(HostUnavailableError);
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
  });

  test('resposta não-ok → HostUnavailableError', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: { message: 'indisponível' } }) });
    await expect(callHostSupervisorTurn('item-1', 1)).rejects.toBeInstanceOf(HostUnavailableError);
  });

  test('body.ok=false → HostUnavailableError', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false, value: { refusal: { message: 'recusado' } } }) });
    await expect(callHostSupervisorTurn('item-1', 1)).rejects.toThrow('recusado');
  });
});
