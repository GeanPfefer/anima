# 2026-09-27b — Research Web V1 (read-only) sobre SearXNG e agent-browser

- **Tipo:** desenvolvimento + prova viva controlada.
- **Objetivo:** primeira capacidade real da arquitetura reuse-first:
  `research.web.search` (SearXNG) e `research.web.open/navigate/extract` (agent-browser),
  governados pelo ANIMA e sem buscador ou browser próprios.
- **Branch:** `dev`. **HEAD inicial:** `47e6d9f`. **Commit de implementação:** `515ba65`.
  `main`/`origin/main` intocados (`99bec54`). Sem push.
- **Arquitetura:** [`docs/arquitetura/research-web-v1.md`](../arquitetura/research-web-v1.md).
  A base empírica (POCs e arquitetura reuse-first) vive fora do repo, em `G:\anima-labs\`.

## Mudanças
- `packages/core/src/research-web/`:
  - envelope de observação externa e política de execução;
  - `classifyWebQuery` (public / project_public / private_blocked);
  - `evaluateWebTarget` e `isPublicIpAddress`;
  - `WebSearchObservationV1` com normalização do SearXNG (degradação + `silent_empty`);
  - `WebPageRefV1`/`WebExtractedFindingV1` e policy do browser com nomes reais de ação;
  - `selectWebSource`.
- `apps/web/lib/research-web/`:
  - `searchWeb`;
  - `openAndExtractWebPage` (sessão efêmera, allowlist, boundaries, max-output, default-deny, close + kill por PID, limpeza com retentativa);
  - `runJsonCli` (env mínimo, stdout limitado, resolve no `exit`);
  - `researchWeb` (composição);
  - config por env, fail-closed.
- `apps/web/scripts/research-web-probe.ts`: prova read-only.

## Decisões
- Não construir buscador nem browser: SearXNG e agent-browser são WRAP.
- `private_blocked` nunca chama o SearXNG. Classificação conservadora e explicável (não é DLP universal).
- A allowlist da abertura é só o domínio escolhido. "navigate" na V1 = nova URL validada em nova sessão efêmera, sem clique.
- A citação futura aponta para a página aberta (`contentHash`), nunca para o resultado de busca.
- Capability Map **não** alterado: o registry não tem domínio `research`. Registrar essas capacidades é unidade separada.

## Bugs/armadilhas encontrados e tratados (medidos nesta sessão)
- Action policy do agent-browser 0.38.1:
  - com `"default":"deny"` e `allow` **vazio**, nada é bloqueado;
  - o nome real de `eval` é `evaluate`;
  - sem `close` na allowlist a sessão não fecha;
  - nomes reais medidos: `launch, navigate, url, title, gettext, read, snapshot, waitforloadstate, click, back, evaluate, scroll, screenshot, cookies_get, close`.
- Windows: o daemon herda o pipe de stdout ⇒ `runJsonCli` resolve no `exit`. Coberto por teste de regressão com processo real.
- Windows: o daemon regrava `.target` ao encerrar ⇒ o `rm` do socket dir falhava em silêncio. Corrigido com retentativas;
  a 2ª prova terminou com 0 diretórios temporários.

## Gates
- Testes focais: core `research-web` **45/45**; web `lib/research-web` **30/30**.
- Core completo: **101 suítes, 2080/2080**. Typecheck core e web: ok. `next build`: ok. `git diff --check`: ok.
- Web completo: 145/146 suítes, 1840/1842. As 2 falhas em `worktree-executor.test.ts` passam **isoladas (56/56)**:
  flake sob carga (git worktrees reais), sem relação com esta mudança.

## Prova viva controlada (read-only)
- SearXNG oficial `2026.9.25+12f8b6515` em contêiner descartável (`127.0.0.1:8888`, removido com volume ao final).
- agent-browser 0.38.1 local (binário do lab, Chrome for Testing 154).
- **Consulta:** `SearXNG search API json documentation` → `queryClass=public`.
  Engines `google,brave,github,stackoverflow,arxiv,docker hub`.
  `status=degraded` (`github`, `stackoverflow`: `silent_empty`) ⇒ `complete=false`.
- **Seleção:** rank 1 `https://docs.searxng.org/dev/search_api.html`, `official_docs`,
  motivo "domínio oficial declarado (docs.searxng.org); rank 1 do buscador (engines: google+brave)".
- **Página:** requested = final = mesma URL; título "Search API - SearXNG Documentation (2026.9.25+12f8b6515)".
  `contentHash sha256:4a88cfe90aee14b0c9f3130f9c6d085bbce1f1163eb3e1604dd0e57c3a45f065` (idêntico nas 2 execuções e ao do POC).
  `blocked=false`, `trust=untrusted_external_content`, 5614 chars, 2,6–3,5 s ponta a ponta.
- **Após a prova:** 0 processos agent-browser/Chrome, 0 diretórios temporários, contêiner e volume removidos, porta 8888 fechada.

## Efeitos externos
- Duas consultas públicas reais saíram, via SearXNG, para os buscadores configurados, a partir do IP do host.
- Duas aberturas de `docs.searxng.org`.
- Nenhum push, PR, credencial, custo pago, Supabase, work item ou Resident Host.

## Limitações
- Windows é só ambiente de desenvolvimento: daemon TCP sem auth e sem isolamento de rede no modo `local`.
  O alvo é contêiner Linux com egress controlado.
- A checagem de DNS tem TOCTOU.
- Não implementados: compare, cite, persist_findings, reuse_discovery, download, upload, login, formulários, crawler.

## Próximo ponto de retomada
Decidir a próxima unidade:
- (a) runtime `container` para SearXNG + agent-browser com egress restrito; ou
- (b) `research.web.cite`/`persist_findings` sobre `WebExtractedFindingV1`, alimentando `selfdev.reuse_discovery`.
Em paralelo, abrir issues upstream do agent-browser (auth do daemon no Windows; semântica de `allow` vazio; `eval`→`evaluate`).
