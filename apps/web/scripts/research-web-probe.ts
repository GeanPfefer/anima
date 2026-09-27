// Prova read-only do Research Web V1: search (SearXNG) → seleção → open/extract (agent-browser).
// Sem mutação externa, sem Supabase, sem credenciais. Uso (de apps/web):
//   ANIMA_RESEARCH_SEARXNG_URL=http://127.0.0.1:8888 \
//   ANIMA_RESEARCH_AGENT_BROWSER_BIN=<caminho do agent-browser> \
//   node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//     scripts/research-web-probe.ts "SearXNG search API json documentation" docs.searxng.org
import { resolveResearchWebConfig } from '../lib/research-web/config';
import { researchWeb } from '../lib/research-web/research-web';

async function main(): Promise<void> {
  const [query = 'SearXNG search API json documentation', ...officialDomains] = process.argv.slice(2);
  const { config, issues } = resolveResearchWebConfig();
  const started = Date.now();
  const run = await researchWeb(
    { query, sourceHints: { officialDomains: officialDomains.length > 0 ? officialDomains : ['docs.searxng.org'] } },
    { config },
  );
  const summary = {
    configIssues: issues,
    elapsedMs: Date.now() - started,
    search: {
      query: run.search.query,
      queryClass: run.search.queryClass,
      privacyReasons: run.search.privacyReasons,
      status: run.search.envelope.status,
      sourceVersion: run.search.envelope.sourceVersion,
      degraded: run.search.envelope.degraded,
      complete: run.search.complete,
      engines: run.search.params.engines,
      observedAt: run.search.envelope.observedAt,
      top: run.search.results.slice(0, 5).map(r => ({ rank: r.rank, url: r.url, engines: r.engines, publishedAt: r.publishedAt })),
    },
    selection: run.selection && { rank: run.selection.result.rank, url: run.selection.result.url, tier: run.selection.tier, reason: run.selection.reason },
    page: run.page && {
      ...run.page.page,
      trust: run.page.content.trust,
      contentChars: run.page.content.text.length,
      truncated: run.page.content.truncated,
      excerpt: run.page.content.text.slice(0, 300),
    },
    error: run.error,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
