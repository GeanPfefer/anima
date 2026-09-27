# Research Web V1 — busca e leitura web governadas (read-only)

**Status:** implementado (V1, read-only) · **Data:** 2026-09-27
**Base empírica:** POCs isolados de SearXNG e agent-browser e a arquitetura reuse-first consolidada.
Os relatórios vivem fora deste repo (`G:\anima-labs\…`); a prova real está em
[`docs/registros/2026-09-27b-research-web-v1.md`](../registros/2026-09-27b-research-web-v1.md).

## Decisão: não construir browser nem buscador próprios

| Capacidade | Quem fornece | O que o ANIMA NÃO escreve |
|---|---|---|
| `research.web.search` | **SearXNG** (self-hosted, AGPL-3.0, serviço separado) | metabuscador, adapters Google/Brave/Bing, scraping de SERP |
| `research.web.open` / `navigate` / `extract` | **agent-browser** (vercel-labs, Apache-2.0, CLI `--json`) | automação de browser, cliente CDP/Playwright |
| governança, privacidade, seleção de fonte, contratos, proveniência | **ANIMA** | — |

Princípio ADOPT → WRAP → FORK → BUILD: ambas as ferramentas são **WRAP**. A camada própria é
só a que pertence ao ANIMA.

## O que foi implementado

**Core puro** (`packages/core/src/research-web/`):
- `external-observation.ts`: `ExternalObservationEnvelopeV1` (source, version, observedAt/queriedAt,
  `status observed|degraded|unavailable|error`, `degraded[]`, erro estruturado),
  `ExternalExecutionPolicyV1` (só os campos usados) e o rótulo `untrusted_external_content`.
- `query-privacy.ts`: `classifyWebQuery` → `public | project_public | private_blocked`, com motivos explicáveis.
- `web-target-policy.ts`: `evaluateWebTarget` (só http/https, sem credencial, porta, IP literal ou host local/interno),
  `isPublicIpAddress` e `normalizeAllowedDomains`.
- `web-search.ts`: `WebSearchObservationV1`, engines default explícitas e `normalizeSearxngResponse`.
- `web-page.ts`: `WebPageRefV1`, `WebExtractedFindingV1` (contrato futuro), `buildResearchWebBrowserPolicy`
  e a allowlist de ações com os **nomes reais** do agent-browser.
- `source-selection.ts`: `selectWebSource`, com heurística explícita e motivo registrado.

**Borda Node** (`apps/web/lib/research-web/`):
- `config.ts`: configuração por env; sem configuração ⇒ indisponível.
- `searxng-search.ts`: `searchWeb` → `WebSearchObservationV1`; nunca lança.
- `json-cli.ts`: executor de CLI com JSON, env mínimo, stdout limitado e resolução no `exit`.
- `agent-browser-page.ts`: `openAndExtractWebPage` → `WebPageRefV1` + conteúdo não confiável.
- `research-web.ts`: `researchWeb`, a composição search → select → open/extract (uma consulta, no máximo uma abertura).
- `scripts/research-web-probe.ts`: prova manual read-only.

## Fronteira de privacidade (antes de qualquer rede)

Self-hosted ≠ privado: o SearXNG repassa a consulta inteira aos buscadores a partir do IP público do host.
Por isso toda consulta passa por `classifyWebQuery`, e `private_blocked` **nunca chama o SearXNG**.
São bloqueados:
- multilinha, vazio ou mais de 256 caracteres;
- padrões de segredo/token/chave (GitHub, OpenAI/Anthropic, AWS, Slack, JWT, bearer, `password=`, connection string, blobs hex/base64);
- atribuições estilo `.env`;
- URLs não públicas (localhost, IP, `file://`);
- IPs privados;
- caminhos locais, stack traces e e-mails.
`project_public` só marca termos públicos declarados (`ANIMA_RESEARCH_PROJECT_PUBLIC_TERMS`) e nunca "libera" conteúdo sensível.
Não é DLP universal: é conservador e explicável.

## Fronteira de prompt injection

Tudo que vem da web (título, snippet, URL, texto extraído) é `untrusted_external_content`: **dado, nunca instrução**.
- O agent-browser roda com `--content-boundaries` (nonce).
- O conteúdo volta rotulado.
- A escolha de fonte é feita por regra do ANIMA, não por texto da página ou do snippet.
- A allowlist da abertura é **só** o domínio escolhido.
Não há defesa semântica própria: a proteção é estrutural. O plano do ANIMA é quem decide ações; o conteúdo nunca dispara ferramenta.

## Política do browser (fail-closed)

- Pré-validação da URL e do DNS: um domínio público que resolve para rede local/privada é recusado.
- **Sessão efêmera** por operação: nome aleatório, socket dir temporário, sem profile, sem restore/state/CDP. Nunca é reutilizada.
- `--allowed-domains` com a allowlist da operação: bloqueia inclusive redirect.
  Redirect ou página "Blocked" ⇒ `blocked=true`, sem conteúdo.
- Action policy **default-deny** com nomes reais do daemon: `launch, navigate, waitforloadstate, url, title, read, close`.
  Ficam negados `evaluate`, `click`, `fill`, `download`, `upload`, `cookies_*`, `screenshot` e `scroll`.
  Dois comportamentos reais medidos: com `allow` vazio a policy **não restringe nada**; sem `close` a sessão **não fecha**.
- `--max-output` e stdout limitado; env mínimo (o filho não herda credenciais do processo web).
- `close` sempre; se falhar, o daemon é morto pelo PID. O diretório temporário é removido com retentativas.
  O daemon regrava arquivos ao encerrar no Windows.
- "navigate" na V1 = abrir outra URL validada numa **nova** sessão efêmera. Não há clique dentro da sessão.

## Configuração

| Variável | Default | Observação |
|---|---|---|
| `ANIMA_RESEARCH_SEARXNG_URL` | — (obrigatória) | ex. `http://127.0.0.1:8888`; o SearXNG precisa ter `formats: [html, json]` |
| `ANIMA_RESEARCH_SEARXNG_ENGINES` | `google,brave,github,stackoverflow,arxiv,docker hub` | lista explícita; bing/duckduckgo/qwant fora por evidência do POC |
| `ANIMA_RESEARCH_MAX_RESULTS` | `10` (máx. 20) | |
| `ANIMA_RESEARCH_TIMEOUT_MS` | `20000` | por chamada |
| `ANIMA_RESEARCH_AGENT_BROWSER_BIN` | — (obrigatória) | caminho do binário do agent-browser |
| `ANIMA_RESEARCH_BROWSER_RUNTIME` | `local` | outros valores são rejeitados na V1 |
| `ANIMA_RESEARCH_BROWSER_MAX_OUTPUT` | `20000` | caracteres |
| `ANIMA_RESEARCH_PROJECT_PUBLIC_TERMS` | vazio | termos públicos do projeto |

Serviço ou binário ausente ⇒ observação `unavailable`/`not_configured`. **Nunca** há fallback para outro buscador ou browser.

## Como rodar localmente

```bash
docker run -d --name searxng -p 127.0.0.1:8888:8080 -v <config>:/etc/searxng docker.io/searxng/searxng:latest
```
`<config>/settings.yml` precisa de `search.formats: [html, json]` e `server.limiter: false` (instância local).
agent-browser: `npm i agent-browser` + `agent-browser install` (Chrome for Testing).
Prova (de `apps/web`):
```bash
ANIMA_RESEARCH_SEARXNG_URL=http://127.0.0.1:8888 ANIMA_RESEARCH_AGENT_BROWSER_BIN=<bin> node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs scripts/research-web-probe.ts "SearXNG search API json documentation" docs.searxng.org
```

## Limitações conhecidas

- **Windows é ambiente de desenvolvimento**, não decisão permanente:
  - no Windows o daemon do agent-browser escuta em TCP `127.0.0.1` **sem autenticação** (issue upstream a abrir);
  - o isolamento de rede do processo não existe no modo `local`.
  O alvo é rodar SearXNG e agent-browser em contêiner Linux com egress controlado. A abstração (`browserRuntime`) já reserva isso.
- A pré-checagem de DNS tem TOCTOU (rebinding entre a checagem e a navegação). A defesa real é o egress do contêiner.
- SearXNG num IP residencial degrada sob carga (CAPTCHA/429). Engines "silenciosas" são marcadas `silent_empty` e `complete=false`.
  Ausência de resultado nunca prova inexistência.
- `publishedAt` só vem de algumas engines; `null` = data desconhecida.
- **Não implementados:** `research.web.compare`, `research.web.cite`, `research.web.persist_findings`, `selfdev.reuse_discovery`
  (o contrato `WebExtractedFindingV1` já aponta a citação para a página aberta).
  Também não há download, upload, login, formulário nem crawler.
- **Capability Map:** registrado na [Evolution Reconciliation V2](../registros/2026-09-27c-evolution-reconciliation-v2.md) (domínio `research`; search/open/extract comprovadas, navigate implementada, cite especificada).
