// ============================================================
// Configuração do Research Web V1 (borda Node).
//
// Sem defaults que apontem para serviços ou binários: ausência de configuração ⇒
// capacidade INDISPONÍVEL (fail-closed), nunca fallback silencioso para outro
// buscador/browser. Defaults numéricos são conservadores.
// ============================================================

import { DEFAULT_RESEARCH_WEB_ENGINES, MAX_RESEARCH_WEB_RESULTS } from '@anima/core';

/** V1 só executa o agent-browser localmente; `container` fica reservado (rejeitado). */
export type ResearchWebBrowserRuntime = 'local';

export interface ResearchWebConfig {
  readonly searxngUrl: string | null;
  readonly engines: readonly string[];
  readonly maxResults: number;
  readonly timeoutMs: number;
  readonly agentBrowserPath: string | null;
  readonly browserRuntime: ResearchWebBrowserRuntime | null;
  readonly browserMaxOutputChars: number;
  readonly projectPublicTerms: readonly string[];
}

export type ResearchWebConfigIssue =
  | 'searxng_url_missing'
  | 'searxng_url_invalid'
  | 'agent_browser_missing'
  | 'browser_runtime_unsupported';

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(s => s !== '');
}

export function resolveResearchWebConfig(env: Record<string, string | undefined> = process.env): {
  readonly config: ResearchWebConfig;
  readonly issues: readonly ResearchWebConfigIssue[];
} {
  const issues: ResearchWebConfigIssue[] = [];

  let searxngUrl: string | null = null;
  const rawUrl = env.ANIMA_RESEARCH_SEARXNG_URL?.trim();
  if (!rawUrl) {
    issues.push('searxng_url_missing');
  } else {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
      searxngUrl = u.toString().replace(/\/+$/, '');
    } catch {
      issues.push('searxng_url_invalid');
    }
  }

  const agentBrowserPath = env.ANIMA_RESEARCH_AGENT_BROWSER_BIN?.trim() || null;
  if (!agentBrowserPath) issues.push('agent_browser_missing');

  const rawRuntime = env.ANIMA_RESEARCH_BROWSER_RUNTIME?.trim() || 'local';
  const browserRuntime: ResearchWebBrowserRuntime | null = rawRuntime === 'local' ? 'local' : null;
  if (browserRuntime === null) issues.push('browser_runtime_unsupported');

  const engines = list(env.ANIMA_RESEARCH_SEARXNG_ENGINES);

  return {
    config: {
      searxngUrl,
      engines: engines.length > 0 ? engines : DEFAULT_RESEARCH_WEB_ENGINES,
      maxResults: intIn(env.ANIMA_RESEARCH_MAX_RESULTS, 10, 1, MAX_RESEARCH_WEB_RESULTS),
      timeoutMs: intIn(env.ANIMA_RESEARCH_TIMEOUT_MS, 20_000, 1_000, 120_000),
      agentBrowserPath,
      browserRuntime,
      browserMaxOutputChars: intIn(env.ANIMA_RESEARCH_BROWSER_MAX_OUTPUT, 20_000, 1_000, 200_000),
      projectPublicTerms: list(env.ANIMA_RESEARCH_PROJECT_PUBLIC_TERMS),
    },
    issues,
  };
}
