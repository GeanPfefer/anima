import { readFile } from 'node:fs/promises';
import type { HostTurnOutcome, ResidentIdentity } from './resident-host';
import type { BacklogContinuation, BacklogHostStopReason } from '../work-orchestration/autonomous-backlog-host-turn';

// ============================================================
// Portos REAIS do resident host V0 (ADR-003), transporte HTTP para a rota provada.
//
// Estes portos NÃO importam `@anima/*` em runtime — só built-ins do Node e `fetch`.
// Assim o processo residente roda por `node` puro (Node 24, TS nativo) sem bundler,
// coerente com a metodologia das provas vivas (atingir a rota autenticada contra o
// stack local). Cada porto tem um NÚCLEO PURO (parsing/decisão) provável isoladamente
// e um invólucro impuro fino (fetch/fs). O `accessToken` é tratado como OPACO e nunca
// é logado.
//
// A autoridade do Resource Governor por-ciclo vive DENTRO da rota do host-turn
// (`hostPermitsAutonomousWork` → `readResourceAdmission`), inalterada. Por isso o
// pré-gate da engine, no transporte HTTP, é `permit` (o gate real roda por ciclo, mais
// fino que uma vez por host-turn); a engine ainda o consulta como seam (defesa em
// profundidade que fica ATIVA quando o transporte virar in-process). Ver ADR-003 §13.
// ============================================================

// ---------------------------------------------------------------------------
// Kill-switch (ADR-003 §9) — fail-closed.

/** Interpreta o valor do control-plane como habilitado/desabilitado — puro, fail-closed.
 * Só tokens afirmativos explícitos habilitam; ausência, ilegível, vazio ou qualquer outro
 * valor ⇒ desabilitado. */
export function parseAutonomyFlag(value: string | null | undefined): boolean {
  if (value == null) return false;
  const t = value.trim().toLowerCase();
  return t === 'enabled' || t === 'true' || t === '1' || t === 'on';
}

export interface KillSwitchConfig {
  /** Caminho de um arquivo de controle; presente ⇒ é a fonte autoritativa (ausente/
   * ilegível ⇒ desabilitado). Ignorado pelo Git. */
  readonly filePath?: string | null;
  /** Valor de env usado quando não há `filePath`. */
  readonly envValue?: string | null;
}

/** Kill-switch fail-closed: com `filePath`, o arquivo é a autoridade (missing/erro ⇒
 * desligado); sem ele, o valor de env. Lido FRESCO a cada consulta. */
export function createKillSwitch(config: KillSwitchConfig): () => Promise<boolean> {
  return async () => {
    if (config.filePath) {
      try {
        return parseAutonomyFlag(await readFile(config.filePath, 'utf8'));
      } catch {
        return false; // arquivo ausente/ilegível ⇒ desabilitado.
      }
    }
    return parseAutonomyFlag(config.envValue);
  };
}

// ---------------------------------------------------------------------------
// Identidade user-scoped via GoTrue (ADR-003 §11) — Bearer, sem service_role.

export interface GoTrueConfig {
  readonly supabaseUrl?: string | null;
  readonly anonKey?: string | null;
  readonly email?: string | null;
  readonly password?: string | null;
  /** Margem antes do vencimento para renovar (default 60s). */
  readonly refreshSkewMs?: number;
}

interface GoTrueSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: string;
  readonly expiresAtMs: number;
}

/** A sessão precisa renovar? Puro dado o relógio e a margem. */
export function sessionNeedsRefresh(session: GoTrueSession, nowMs: number, skewMs: number): boolean {
  return nowMs >= session.expiresAtMs - skewMs;
}

/** Normaliza a resposta de token do GoTrue em sessão — puro, ou `null` se malformada. */
export function parseGoTrueSession(json: unknown, nowMs: number): GoTrueSession | null {
  const o = json as {
    access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; expires_at?: unknown;
    user?: { id?: unknown } | null;
  } | null;
  if (!o || typeof o.access_token !== 'string' || typeof o.refresh_token !== 'string') return null;
  const userId = typeof o.user?.id === 'string' ? o.user.id : null;
  if (!userId) return null;
  const expiresAtMs = typeof o.expires_at === 'number'
    ? o.expires_at * 1000
    : typeof o.expires_in === 'number'
      ? nowMs + o.expires_in * 1000
      : nowMs; // sem info de expiração ⇒ trata como já vencida (renova/reautentica na próxima).
  return { accessToken: o.access_token, refreshToken: o.refresh_token, userId, expiresAtMs };
}

const DEFAULT_REFRESH_SKEW_MS = 60_000;

/**
 * Provider de identidade user-scoped: cacheia a sessão, renova por refresh token e
 * reautentica por senha quando necessário. Fail-closed: config incompleta ou qualquer
 * falha de rede/parse ⇒ `null` (a engine não age sem identidade). NUNCA usa service_role.
 */
export function createGoTrueIdentityProvider(
  config: GoTrueConfig,
  deps: { readonly fetchImpl?: typeof fetch; readonly now?: () => number } = {},
): () => Promise<ResidentIdentity | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const skewMs = config.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let session: GoTrueSession | null = null;

  const ready = Boolean(config.supabaseUrl && config.anonKey && config.email && config.password);

  const tokenRequest = async (body: Record<string, string>, grant: string): Promise<GoTrueSession | null> => {
    try {
      const res = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.anonKey! },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return parseGoTrueSession(await res.json().catch(() => null), now());
    } catch {
      return null;
    }
  };

  return async (): Promise<ResidentIdentity | null> => {
    if (!ready) return null;
    if (session && !sessionNeedsRefresh(session, now(), skewMs)) {
      return { userId: session.userId, accessToken: session.accessToken };
    }
    if (session) {
      const refreshed = await tokenRequest({ refresh_token: session.refreshToken }, 'refresh_token');
      if (refreshed) { session = refreshed; return { userId: refreshed.userId, accessToken: refreshed.accessToken }; }
    }
    const signedIn = await tokenRequest({ email: config.email!, password: config.password! }, 'password');
    if (!signedIn) { session = null; return null; }
    session = signedIn;
    return { userId: signedIn.userId, accessToken: signedIn.accessToken };
  };
}

// ---------------------------------------------------------------------------
// Invocação do host-turn via HTTP para a rota provada (ADR-003, transporte V0).

/** Mapeia a resposta da rota `backlog-host-turn` no desfecho tipado da engine — puro.
 * Non-200/`ok:false`/shape inválida ⇒ `{ok:false}` (a engine faz backoff, nunca crasha). */
export function mapHostTurnResponse(status: number, json: unknown): HostTurnOutcome {
  if (status !== 200) return { ok: false, error: `http_${status}` };
  const body = json as { ok?: unknown; value?: unknown; error?: { code?: unknown } } | null;
  if (!body || body.ok !== true) {
    const code = (body?.error?.code);
    return { ok: false, error: typeof code === 'string' ? code : 'route_error' };
  }
  const v = body.value as {
    continuation?: unknown; stopReason?: unknown; moreWorkAvailable?: unknown; cyclesExecuted?: unknown;
    itemsTouched?: unknown; cycles?: unknown;
  } | null;
  if (!v || typeof v.continuation !== 'string' || typeof v.stopReason !== 'string') {
    return { ok: false, error: 'invalid_response' };
  }
  // Fronteira de confiança: a rota produz uniões válidas; validamos que são strings
  // não-vazias e as estreitamos para os tipos do vocabulário compartilhado (sem `any`).
  return {
    ok: true,
    continuation: v.continuation as BacklogContinuation,
    stopReason: v.stopReason as BacklogHostStopReason,
    moreWorkAvailable: v.moreWorkAvailable === true,
    cyclesExecuted: typeof v.cyclesExecuted === 'number' ? v.cyclesExecuted : 0,
    itemsTouched: typeof v.itemsTouched === 'number' ? v.itemsTouched : 0,
    workItemIds: extractWorkItemIds(v.cycles),
  };
}

/** Extrai IDs distintos de work_items das voltas do resultado da rota — lenient (a resposta
 * é JSON não tipado; entradas inválidas são ignoradas). */
function extractWorkItemIds(cycles: unknown): readonly string[] {
  if (!Array.isArray(cycles)) return [];
  const ids = new Set<string>();
  for (const cycle of cycles) {
    const turns = (cycle as { turns?: unknown } | null)?.turns;
    if (!Array.isArray(turns)) continue;
    for (const turn of turns) {
      const id = (turn as { workItemId?: unknown } | null)?.workItemId;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}

export interface HttpHostTurnConfig {
  readonly baseUrl: string;
  readonly maxTurnsPerCycle: number;
  readonly maxCycles: number;
}

/** Porto `runHostTurn` que POSTa à rota autenticada com Bearer. Nunca lança: erros de
 * rede/HTTP viram `{ok:false}` para a engine tratar com backoff. */
export function createHttpHostTurnPort(
  config: HttpHostTurnConfig,
  deps: { readonly fetchImpl?: typeof fetch } = {},
): (identity: ResidentIdentity, signal: AbortSignal) => Promise<HostTurnOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (identity, signal) => {
    try {
      const res = await fetchImpl(`${config.baseUrl}/api/work-orchestration/backlog-host-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.accessToken}` },
        body: JSON.stringify({ maxTurnsPerCycle: config.maxTurnsPerCycle, maxCycles: config.maxCycles }),
        signal,
      });
      const json = await res.json().catch(() => null);
      return mapHostTurnResponse(res.status, json);
    } catch (error) {
      if (signal.aborted) return { ok: false, error: 'cancelled' };
      return { ok: false, error: error instanceof Error ? error.message : 'fetch_failed' };
    }
  };
}
