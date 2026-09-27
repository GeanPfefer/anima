// ============================================================
// research.web.search — contrato e normalização (Research Web V1).
//
// O buscador é o SearXNG (reuse): o ANIMA NÃO implementa engine, adapter de
// Google/Brave/Bing nem scraping de SERP. Aqui só vive o que pertence ao ANIMA:
// o contrato `WebSearchObservationV1`, a lista explícita de engines e a
// normalização do JSON do SearXNG para esse contrato.
//
// Tudo o que vem do buscador (título, snippet, URL) é DADO EXTERNO NÃO CONFIÁVEL.
// ============================================================

import {
  type ExternalObservationDegradationV1,
  type ExternalObservationEnvelopeV1,
  type UntrustedExternalContentLabel,
} from './external-observation';
import type { WebQueryClassV1, WebQueryPrivacyReasonV1 } from './query-privacy';

/**
 * Engines da V1, escolhidas pela evidência do POC (2026-09-27): google + brave dão a
 * qualidade (consenso); github/stackoverflow/arxiv/docker hub são verticais técnicas
 * estáveis. Bing (lixo), DuckDuckGo e Qwant (CAPTCHA) ficam fora por padrão.
 */
export const DEFAULT_RESEARCH_WEB_ENGINES: readonly string[] = [
  'google',
  'brave',
  'github',
  'stackoverflow',
  'arxiv',
  'docker hub',
];

export const MAX_RESEARCH_WEB_RESULTS = 20;

export interface WebSearchResultV1 {
  readonly rank: number;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly engines: readonly string[];
  readonly score: number | null;
  /** `null` = data DESCONHECIDA (nunca "recente"). */
  readonly publishedAt: string | null;
}

export interface WebSearchParamsV1 {
  readonly engines: readonly string[];
  readonly maxResults: number;
  readonly timeRange: 'day' | 'week' | 'month' | 'year' | null;
}

export interface WebSearchObservationV1 {
  readonly schemaVersion: 1;
  readonly envelope: ExternalObservationEnvelopeV1;
  readonly query: string;
  readonly queryClass: WebQueryClassV1;
  readonly privacyReasons: readonly WebQueryPrivacyReasonV1[];
  readonly params: WebSearchParamsV1;
  readonly trust: UntrustedExternalContentLabel;
  readonly results: readonly WebSearchResultV1[];
  /**
   * `true` só quando TODAS as engines pedidas responderam. Zero resultados com
   * `complete=false` NÃO prova inexistência.
   */
  readonly complete: boolean;
}

export type SearxngNormalizationV1 =
  | {
      readonly ok: true;
      readonly results: readonly WebSearchResultV1[];
      readonly degraded: readonly ExternalObservationDegradationV1[];
      readonly respondedEngines: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function normalizeDate(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Normaliza o JSON do SearXNG. Falha (`ok:false`) quando o formato não é o
 * esperado — nunca inventa resultados a partir de um corpo desconhecido.
 */
export function normalizeSearxngResponse(
  raw: unknown,
  requestedEngines: readonly string[],
  maxResults: number,
): SearxngNormalizationV1 {
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    return { ok: false, message: 'resposta do SearXNG sem a lista `results`' };
  }
  const unresponsive = Array.isArray(raw.unresponsive_engines) ? raw.unresponsive_engines : [];
  const degraded: ExternalObservationDegradationV1[] = [];
  const failed = new Set<string>();
  for (const entry of unresponsive) {
    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      failed.add(entry[0]);
      degraded.push({ part: `engine:${entry[0]}`, reason: text(entry[1], 120) || 'unresponsive' });
    }
  }

  const cap = Math.max(0, Math.min(maxResults, MAX_RESEARCH_WEB_RESULTS));
  const results: WebSearchResultV1[] = [];
  const seen = new Set<string>();
  const contributing = new Set<string>();
  for (const item of raw.results) {
    if (!isRecord(item)) continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const engines = Array.isArray(item.engines)
      ? item.engines.filter((e): e is string => typeof e === 'string')
      : typeof item.engine === 'string'
        ? [item.engine]
        : [];
    for (const e of engines) contributing.add(e);
    if (results.length >= cap) continue;
    results.push({
      rank: results.length + 1,
      title: text(item.title, 300),
      url,
      snippet: text(item.content, 500),
      engines,
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null,
      publishedAt: normalizeDate(item.publishedDate),
    });
  }

  // Vazio silencioso (medido no POC: pypi/wikipedia devolviam 0 sem erro): engine
  // que não falhou e não contribuiu nada é cobertura DESCONHECIDA, não completa.
  for (const e of requestedEngines) {
    if (!failed.has(e) && !contributing.has(e)) {
      degraded.push({ part: `engine:${e}`, reason: 'silent_empty' });
    }
  }
  const respondedEngines = requestedEngines.filter(e => !failed.has(e));
  return { ok: true, results, degraded, respondedEngines };
}
