// ============================================================
// Research Web V1 — composição search → select → open/extract (read-only).
//
// SearXNG descobre candidatos; o ANIMA escolhe a fonte por heurística explícita;
// o agent-browser abre e extrai com allowlist = SÓ o domínio escolhido. A
// proveniência citável é a página aberta (`WebPageRefV1.contentHash`); o
// resultado de busca fica como trilha de "por que esta fonte".
//
// Sem crawler e sem loop: uma consulta, no máximo uma abertura. compare/cite/
// persist/reuse_discovery NÃO estão implementados aqui.
// ============================================================

import {
  selectWebSource,
  type ExternalObservationErrorV1,
  type WebPageExtractionV1,
  type WebSearchObservationV1,
  type WebSourceHintsV1,
  type WebSourceSelectionV1,
} from '@anima/core';
import { openAndExtractWebPage, type OpenWebPageDeps } from './agent-browser-page';
import type { ResearchWebConfig } from './config';
import { searchWeb, type SearchWebDeps } from './searxng-search';

export interface ResearchWebRequest {
  readonly query: string;
  readonly sourceHints: WebSourceHintsV1;
  readonly allowSecondarySource?: boolean;
}

export interface ResearchWebRunV1 {
  readonly search: WebSearchObservationV1;
  readonly selection: WebSourceSelectionV1 | null;
  readonly page: WebPageExtractionV1 | null;
  readonly error: ExternalObservationErrorV1 | null;
}

export interface ResearchWebDeps {
  readonly config: ResearchWebConfig;
  readonly search?: Omit<SearchWebDeps, 'config'>;
  readonly browser?: Omit<OpenWebPageDeps, 'config'>;
}

export async function researchWeb(request: ResearchWebRequest, deps: ResearchWebDeps): Promise<ResearchWebRunV1> {
  const search = await searchWeb({ query: request.query }, { config: deps.config, ...deps.search });
  if (search.envelope.error && search.results.length === 0) {
    return { search, selection: null, page: null, error: search.envelope.error };
  }

  const selection = selectWebSource(search.results, request.sourceHints, { allowSecondary: request.allowSecondarySource === true });
  if (!selection) {
    return {
      search,
      selection: null,
      page: null,
      error: { kind: 'invalid_request', message: 'nenhum candidato abrível corresponde às fontes declaradas' },
    };
  }

  const host = new URL(selection.result.url).hostname;
  const opened = await openAndExtractWebPage(
    { url: selection.result.url, allowedDomains: [host] },
    { config: deps.config, ...deps.browser },
  );
  if (!opened.ok) return { search, selection, page: null, error: opened.error };
  return { search, selection, page: opened.extraction, error: null };
}
