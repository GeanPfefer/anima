// ============================================================
// Seleção de fonte (Research Web V1): heurística simples, explícita e auditável.
//
// Ordem de preferência: (1) documentação oficial, (2) repositório upstream,
// (3) fonte primária declarada, (4) fonte secundária. Nada de LLM "inventando"
// confiabilidade: cada escolha registra a regra que a produziu. Candidatos que o
// browser não poderia abrir (localhost, IP, esquema estranho) nunca são escolhidos.
// ============================================================

import { evaluateWebTarget } from './web-target-policy';
import type { WebSearchResultV1 } from './web-search';

export type WebSourceTierV1 = 'official_docs' | 'upstream_repo' | 'primary' | 'secondary';

export interface WebSourceHintsV1 {
  /** Domínios oficiais conhecidos do alvo (ex. `docs.searxng.org`, `searxng.org`). */
  readonly officialDomains?: readonly string[];
  /** Repositórios upstream conhecidos, `owner/repo` (ex. `searxng/searxng`). */
  readonly upstreamRepos?: readonly string[];
  /** Outros domínios considerados fonte primária (ex. registries oficiais). */
  readonly primaryDomains?: readonly string[];
}

export interface WebSourceSelectionV1 {
  readonly result: WebSearchResultV1;
  readonly tier: WebSourceTierV1;
  readonly reason: string;
}

const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'codeberg.org']);

function hostMatches(hostname: string, domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^\*\./, '');
  return d !== '' && (hostname === d || hostname.endsWith(`.${d}`));
}

function repoOf(url: URL): string | null {
  if (!REPO_HOSTS.has(url.hostname)) return null;
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
}

function classify(result: WebSearchResultV1, hints: WebSourceHintsV1): { tier: WebSourceTierV1; reason: string } | null {
  const decision = evaluateWebTarget(result.url);
  if (!decision.allowed) return null;
  const url = new URL(decision.url);
  const host = decision.hostname;

  const official = (hints.officialDomains ?? []).find(d => hostMatches(host, d));
  if (official) return { tier: 'official_docs', reason: `domínio oficial declarado (${official})` };

  const repo = repoOf(url);
  const upstream = (hints.upstreamRepos ?? []).map(r => r.toLowerCase()).find(r => r === repo);
  if (upstream) return { tier: 'upstream_repo', reason: `repositório upstream declarado (${upstream})` };

  const primary = (hints.primaryDomains ?? []).find(d => hostMatches(host, d));
  if (primary) return { tier: 'primary', reason: `fonte primária declarada (${primary})` };

  return { tier: 'secondary', reason: 'sem correspondência com fonte declarada; fonte secundária' };
}

const TIER_ORDER: readonly WebSourceTierV1[] = ['official_docs', 'upstream_repo', 'primary', 'secondary'];

/**
 * Escolhe a melhor fonte. Empate no mesmo nível: menor `rank` do buscador. `null`
 * quando nenhum candidato é abrível. `secondary` só é escolhido quando
 * `allowSecondary` for verdadeiro (default: falso, para não citar terceiros por acaso).
 */
export function selectWebSource(
  results: readonly WebSearchResultV1[],
  hints: WebSourceHintsV1,
  options: { readonly allowSecondary?: boolean } = {},
): WebSourceSelectionV1 | null {
  const ranked = results
    .map(result => ({ result, c: classify(result, hints) }))
    .filter((x): x is { result: WebSearchResultV1; c: { tier: WebSourceTierV1; reason: string } } => x.c !== null)
    .filter(x => options.allowSecondary === true || x.c.tier !== 'secondary')
    .sort((a, b) => TIER_ORDER.indexOf(a.c.tier) - TIER_ORDER.indexOf(b.c.tier) || a.result.rank - b.result.rank);
  const best = ranked[0];
  if (!best) return null;
  return {
    result: best.result,
    tier: best.c.tier,
    reason: `${best.c.reason}; rank ${best.result.rank} do buscador (engines: ${best.result.engines.join('+') || 'n/d'})`,
  };
}
