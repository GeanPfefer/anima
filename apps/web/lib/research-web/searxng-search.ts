// ============================================================
// research.web.search — borda Node sobre o SearXNG (reuse).
//
// Fluxo: validar → classificar privacidade → (bloquear) → GET /search?format=json
// → exigir JSON → normalizar → preservar degradação → marcar completude.
// Não há adapter de engine aqui: o SearXNG é o metabuscador. O ANIMA só governa.
// ============================================================

import {
  classifyWebQuery,
  externalError,
  normalizeSearxngResponse,
  UNTRUSTED_EXTERNAL_CONTENT,
  type ExternalObservationDegradationV1,
  type ExternalObservationErrorV1,
  type ExternalObservationStatusV1,
  type WebQueryPrivacyDecisionV1,
  type WebSearchObservationV1,
  type WebSearchParamsV1,
  type WebSearchResultV1,
} from '@anima/core';
import type { ResearchWebConfig } from './config';

export interface SearchWebRequest {
  readonly query: string;
  readonly timeRange?: WebSearchParamsV1['timeRange'];
}

export interface SearchWebDeps {
  readonly config: ResearchWebConfig;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function observation(input: {
  query: string;
  privacy: WebQueryPrivacyDecisionV1;
  params: WebSearchParamsV1;
  status: ExternalObservationStatusV1;
  queriedAt: string;
  observedAt: string;
  sourceVersion: string | null;
  degraded?: readonly ExternalObservationDegradationV1[];
  error?: ExternalObservationErrorV1 | null;
  results?: readonly WebSearchResultV1[];
  complete?: boolean;
}): WebSearchObservationV1 {
  return {
    schemaVersion: 1,
    envelope: {
      source: 'searxng',
      sourceVersion: input.sourceVersion,
      observedAt: input.observedAt,
      queriedAt: input.queriedAt,
      status: input.status,
      degraded: input.degraded ?? [],
      error: input.error ?? null,
    },
    query: input.query,
    queryClass: input.privacy.queryClass,
    privacyReasons: input.privacy.reasons,
    params: input.params,
    trust: UNTRUSTED_EXTERNAL_CONTENT,
    results: input.results ?? [],
    complete: input.complete ?? false,
  };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readSearxngVersion(fetchImpl: typeof fetch, base: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(fetchImpl, `${base}/config`, timeoutMs);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && typeof (body as { version?: unknown }).version === 'string'
      ? (body as { version: string }).version
      : null;
  } catch {
    return null;
  }
}

/** Busca governada. Nunca lança: toda falha vira observação com erro estruturado. */
export async function searchWeb(request: SearchWebRequest, deps: SearchWebDeps): Promise<WebSearchObservationV1> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const queriedAt = now().toISOString();
  const query = request.query.trim();
  const params: WebSearchParamsV1 = { engines: config.engines, maxResults: config.maxResults, timeRange: request.timeRange ?? null };
  const privacy = classifyWebQuery({ query: request.query, projectPublicTerms: config.projectPublicTerms });
  const base = { query, privacy, params, queriedAt, observedAt: queriedAt, sourceVersion: null };

  // 1. Privacidade ANTES de qualquer rede: private_blocked nunca chega ao buscador.
  if (privacy.queryClass === 'private_blocked') {
    return observation({
      ...base,
      status: 'error',
      error: externalError('blocked_by_policy', `consulta bloqueada pela classificação de privacidade: ${privacy.reasons.join(', ')}`),
    });
  }
  if (!config.searxngUrl) {
    return observation({ ...base, status: 'unavailable', error: externalError('not_configured', 'ANIMA_RESEARCH_SEARXNG_URL ausente ou inválida') });
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  // 2. Chamada ao SearXNG. Sem `timeout_limit`: no POC um cliente com timeout curto
  //    suspendeu engines para todos os consumidores da instância.
  const url = new URL(`${config.searxngUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('engines', config.engines.join(','));
  if (params.timeRange) url.searchParams.set('time_range', params.timeRange);

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url.toString(), config.timeoutMs);
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return observation({
      ...base,
      status: 'unavailable',
      error: externalError(aborted ? 'timeout' : 'network', aborted ? `SearXNG não respondeu em ${config.timeoutMs}ms` : 'SearXNG inacessível'),
    });
  }
  const observedAt = now().toISOString();
  const sourceVersion = await readSearxngVersion(fetchImpl, config.searxngUrl, config.timeoutMs);
  const at = { ...base, observedAt, sourceVersion };

  // 3. Só JSON. O SearXNG devolve HTML com 200 para formato não habilitado/inválido.
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    return observation({ ...at, status: 'error', error: externalError(response.status === 429 ? 'rate_limited' : 'tool_failed', `SearXNG respondeu HTTP ${response.status}`) });
  }
  if (!contentType.toLowerCase().includes('application/json')) {
    return observation({ ...at, status: 'error', error: externalError('schema', `SearXNG respondeu content-type inesperado (${contentType || 'ausente'}); o formato JSON está habilitado?`) });
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return observation({ ...at, status: 'error', error: externalError('schema', 'corpo do SearXNG não é JSON válido') });
  }

  // 4. Normalização + degradação explícita.
  const normalized = normalizeSearxngResponse(raw, config.engines, config.maxResults);
  if (!normalized.ok) return observation({ ...at, status: 'error', error: externalError('schema', normalized.message) });

  const allFailed = normalized.respondedEngines.length === 0;
  const status: ExternalObservationStatusV1 = allFailed ? 'unavailable' : normalized.degraded.length > 0 ? 'degraded' : 'observed';
  return observation({
    ...at,
    status,
    degraded: normalized.degraded,
    results: normalized.results,
    // Zero resultados com complete=false NÃO prova inexistência.
    complete: normalized.degraded.length === 0,
    error: allFailed ? externalError('tool_failed', 'nenhuma engine respondeu; ausência de resultados não prova inexistência') : null,
  });
}
