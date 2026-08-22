import {
  parseAutonomyFlag,
  createKillSwitch,
  sessionNeedsRefresh,
  parseGoTrueSession,
  createGoTrueIdentityProvider,
  mapHostTurnResponse,
  createHttpHostTurnPort,
} from './ports';

// Núcleos puros dos portos + comportamento por fetch injetado. Sem rede real.

const fakeFetch = (responses: readonly { status: number; ok?: boolean; body: unknown }[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)] ?? { status: 200, body: {} };
    i++;
    return { ok: r.ok ?? (r.status >= 200 && r.status < 300), status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('parseAutonomyFlag (fail-closed)', () => {
  test.each(['enabled', 'true', '1', 'on', 'ENABLED', ' On '])('%s → habilitado', (v) => {
    expect(parseAutonomyFlag(v)).toBe(true);
  });
  test.each(['disabled', 'false', '0', '', 'yes', 'enable', null, undefined])('%s → desabilitado', (v) => {
    expect(parseAutonomyFlag(v as string | null | undefined)).toBe(false);
  });
});

describe('createKillSwitch', () => {
  test('sem filePath usa envValue', async () => {
    expect(await createKillSwitch({ envValue: 'enabled' })()).toBe(true);
    expect(await createKillSwitch({ envValue: 'nope' })()).toBe(false);
    expect(await createKillSwitch({})()).toBe(false);
  });
  test('filePath ausente/ilegível ⇒ desabilitado (fail-closed)', async () => {
    expect(await createKillSwitch({ filePath: 'G:/definitely/missing/anima-autonomy.flag' })()).toBe(false);
  });
});

describe('sessionNeedsRefresh (puro)', () => {
  const s = { accessToken: 'a', refreshToken: 'r', userId: 'u', expiresAtMs: 100_000 };
  test('antes da margem → não renova', () => {
    expect(sessionNeedsRefresh(s, 100_000 - 60_001, 60_000)).toBe(false);
  });
  test('dentro da margem → renova', () => {
    expect(sessionNeedsRefresh(s, 100_000 - 60_000, 60_000)).toBe(true);
    expect(sessionNeedsRefresh(s, 100_000, 60_000)).toBe(true);
  });
});

describe('parseGoTrueSession (puro)', () => {
  test('com expires_at (epoch s) → ms', () => {
    const s = parseGoTrueSession({ access_token: 'a', refresh_token: 'r', expires_at: 2_000, user: { id: 'u1' } }, 1_000);
    expect(s).toEqual({ accessToken: 'a', refreshToken: 'r', userId: 'u1', expiresAtMs: 2_000_000 });
  });
  test('com expires_in → now + in', () => {
    const s = parseGoTrueSession({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1' } }, 1_000);
    expect(s?.expiresAtMs).toBe(1_000 + 3_600_000);
  });
  test('malformada ou sem user.id → null', () => {
    expect(parseGoTrueSession({ access_token: 'a' }, 0)).toBeNull();
    expect(parseGoTrueSession({ access_token: 'a', refresh_token: 'r' }, 0)).toBeNull();
    expect(parseGoTrueSession(null, 0)).toBeNull();
  });
});

describe('createGoTrueIdentityProvider (fail-closed, sem service_role)', () => {
  const config = { supabaseUrl: 'http://local', anonKey: 'anon', email: 'e@t.invalid', password: 'pw' };

  test('config incompleta → null, sem fetch', async () => {
    const f = fakeFetch([]);
    const provider = createGoTrueIdentityProvider({ supabaseUrl: 'http://local' }, { fetchImpl: f.impl });
    expect(await provider()).toBeNull();
    expect(f.calls.length).toBe(0);
  });

  test('primeira chamada autentica por senha; segunda usa cache dentro da validade', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'A', refresh_token: 'R', expires_in: 3600, user: { id: 'u1' } } }]);
    const provider = createGoTrueIdentityProvider(config, { fetchImpl: f.impl, now: () => 0 });
    expect(await provider()).toEqual({ userId: 'u1', accessToken: 'A' });
    expect(await provider()).toEqual({ userId: 'u1', accessToken: 'A' });
    expect(f.calls.length).toBe(1); // segunda veio do cache.
    expect(f.calls[0]!.url).toContain('grant_type=password');
    // O anon key vai no header apikey — nunca service_role.
    expect((f.calls[0]!.init!.headers as Record<string, string>).apikey).toBe('anon');
  });

  test('sessão vencida → tenta refresh_token', async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: 'A', refresh_token: 'R', expires_in: 1, user: { id: 'u1' } } },
      { status: 200, body: { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, user: { id: 'u1' } } },
    ]);
    let clock = 0;
    const provider = createGoTrueIdentityProvider(config, { fetchImpl: f.impl, now: () => clock });
    await provider();          // password grant, expira em 1s
    clock = 10_000;            // agora vencida
    expect(await provider()).toEqual({ userId: 'u1', accessToken: 'A2' });
    expect(f.calls[1]!.url).toContain('grant_type=refresh_token');
  });

  test('falha de autenticação → null (fail-closed)', async () => {
    const f = fakeFetch([{ status: 400, ok: false, body: { error: 'invalid_grant' } }]);
    const provider = createGoTrueIdentityProvider(config, { fetchImpl: f.impl });
    expect(await provider()).toBeNull();
  });
});

describe('mapHostTurnResponse (puro)', () => {
  test('200 ok:true → desfecho mapeado', () => {
    const out = mapHostTurnResponse(200, {
      ok: true,
      value: { continuation: 'continue', stopReason: 'max_cycles_reached', moreWorkAvailable: true, cyclesExecuted: 2 },
    });
    expect(out).toEqual({ ok: true, continuation: 'continue', stopReason: 'max_cycles_reached', moreWorkAvailable: true, cyclesExecuted: 2 });
  });
  test('200 ok:false → erro com código', () => {
    expect(mapHostTurnResponse(200, { ok: false, error: { code: 'authentication_required' } })).toEqual({ ok: false, error: 'authentication_required' });
  });
  test('non-200 → http_status', () => {
    expect(mapHostTurnResponse(500, null)).toEqual({ ok: false, error: 'http_500' });
    expect(mapHostTurnResponse(401, { ok: false })).toEqual({ ok: false, error: 'http_401' });
  });
  test('value inválido → invalid_response', () => {
    expect(mapHostTurnResponse(200, { ok: true, value: { continuation: 'continue' } })).toEqual({ ok: false, error: 'invalid_response' });
    expect(mapHostTurnResponse(200, { ok: true, value: null })).toEqual({ ok: false, error: 'invalid_response' });
  });
});

describe('createHttpHostTurnPort', () => {
  const identity = { userId: 'u1', accessToken: 'TKN' };
  test('POST com Bearer + bounds; resposta mapeada', async () => {
    const f = fakeFetch([{ status: 200, body: { ok: true, value: { continuation: 'stop', stopReason: 'no_eligible_work', moreWorkAvailable: false, cyclesExecuted: 1 } } }]);
    const port = createHttpHostTurnPort({ baseUrl: 'http://local:3000', maxTurnsPerCycle: 1, maxCycles: 2 }, { fetchImpl: f.impl });
    const out = await port(identity, new AbortController().signal);
    expect(out).toEqual({ ok: true, continuation: 'stop', stopReason: 'no_eligible_work', moreWorkAvailable: false, cyclesExecuted: 1 });
    expect(f.calls[0]!.url).toBe('http://local:3000/api/work-orchestration/backlog-host-turn');
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer TKN');
    expect(JSON.parse(f.calls[0]!.init!.body as string)).toEqual({ maxTurnsPerCycle: 1, maxCycles: 2 });
  });
  test('erro de rede → {ok:false} (nunca lança)', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const port = createHttpHostTurnPort({ baseUrl: 'http://local:3000', maxTurnsPerCycle: 1, maxCycles: 2 }, { fetchImpl: impl });
    const out = await port(identity, new AbortController().signal);
    expect(out.ok).toBe(false);
  });
});
