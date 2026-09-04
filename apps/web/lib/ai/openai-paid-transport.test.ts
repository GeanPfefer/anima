/** @jest-environment node */
import {
  fetchAdmittedOpenAIResponses,
  OpenAIAdmissionDenied,
  OPENAI_RESPONSES_URL,
  readOpenAIApiKey,
  type OpenAIAdmissionControl,
  type OpenAICallIntent,
} from './openai-paid-transport';

const intent: OpenAICallIntent = { consumer: 'chat', userId: 'u1', model: 'gpt-test' };
const grant: OpenAIAdmissionControl = { admit: async i => ({ consumer: i.consumer, authorizationRef: 'a1', reservationId: null }) };
const deny: OpenAIAdmissionControl = { admit: async i => { throw new OpenAIAdmissionDenied('no_authority', i.consumer); } };
const okResponse = { ok: true, status: 200, json: async () => ({}) } as Response;

describe('borda financeira única da OpenAI', () => {
  test('admissão recusada ⇒ ZERO fetch (fail-closed antes da rede)', async () => {
    const fetchImpl = jest.fn(async () => okResponse) as unknown as typeof fetch;
    await expect(fetchAdmittedOpenAIResponses({
      admission: deny, intent, body: {}, signal: new AbortController().signal, fetchImpl, apiKey: 'k',
    })).rejects.toBeInstanceOf(OpenAIAdmissionDenied);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('admitida ⇒ injeta a chave no header e chama a Responses API; devolve o grant', async () => {
    const calls: Array<{ url: unknown; init: RequestInit }> = [];
    const fetchImpl = (async (url: unknown, init: RequestInit) => { calls.push({ url, init }); return okResponse; }) as unknown as typeof fetch;
    const { grant: g } = await fetchAdmittedOpenAIResponses({
      admission: grant, intent, body: { input: 'oi' }, signal: new AbortController().signal, fetchImpl, apiKey: 'secret-key',
    });
    expect(g).toEqual({ consumer: 'chat', authorizationRef: 'a1', reservationId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(OPENAI_RESPONSES_URL);
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer secret-key' });
    expect(String(calls[0]!.init.body)).toContain('oi');
  });

  test('admitida mas sem chave ⇒ recusa e ZERO fetch', async () => {
    const fetchImpl = jest.fn(async () => okResponse) as unknown as typeof fetch;
    await expect(fetchAdmittedOpenAIResponses({
      admission: grant, intent, body: {}, signal: new AbortController().signal, fetchImpl, apiKey: '',
      env: {},
    })).rejects.toMatchObject({ reason: 'openai_key_missing' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('readOpenAIApiKey trata vazio/ausente como null', () => {
    expect(readOpenAIApiKey({ OPENAI_API_KEY: '  ' })).toBeNull();
    expect(readOpenAIApiKey({})).toBeNull();
    expect(readOpenAIApiKey({ OPENAI_API_KEY: 'k' })).toBe('k');
  });
});
