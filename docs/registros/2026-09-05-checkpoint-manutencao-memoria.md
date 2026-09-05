# Checkpoint de manutenção — estado canônico e próxima fronteira

- **Data/tipo:** 2026-09-05 — manutenção (memória) e checkpoint de estado.
- **Objetivo:** compactar o índice de memória do agente (`MEMORY.md`, fora do repositório) sem perder invariantes, movendo o detalhe durável da próxima fronteira para este registro recuperável apenas pelo repositório (conforme `AGENTS.md` §"Convergência de agentes").
- **Branch:** `dev`.
- **HEAD inicial:** `9fa181c` (= `origin/dev`).
- **HEAD final:** commit atômico que contém este registro.
- **`origin/main`:** `99bec54` — INTACTA, não tocada.

## Estado canônico em `9fa181c`

Fechados e publicados em `origin/dev` (referências detalhadas nos registros e memórias citados, não duplicadas aqui):

- **Compute Router V1** — atrás de `ANIMA_COMPUTE_ROUTER_V1_ENABLED`; OFF invisível (early-branch), ON decide apenas Ollama×OpenAI, cloud fora. Ver `docs/registros/2026-09-04-compute-router-v1-composicao.md`.
- **Compute Economics V1 / Economic Observations V1** — `EconomicObservationV1` por coorte (capability/taskClass/provider/model/placement/configVersion) e agregação com `calculateCohortMetrics`. Ver `docs/registros/2026-09-04-compute-economics-observations-v1.md`.
- **Ponte histórico econômico → Router** — adapter host-side `apps/web/lib/work-orchestration/economic-history.ts` projeta o event store em `ComputeEconomicsSignalV1` e entrega a `decideComputeRoute`. **Policy do Router INALTERADA**; só acrescentou observabilidade em `economicsBasis`.
- **Governança OpenAI global** — borda financeira única `openai-paid-transport.ts` (admissão antes do fetch; único a ler `OPENAI_API_KEY`/URL). Ver `docs/registros/2026-09-03-*` e memória correspondente.

### Invariantes provados (não fabricados)

- **Router OFF não consulta economics**; ON consulta exatamente **1×** por decisão.
- **Histórico limitado** (`ECONOMIC_HISTORY_LIMIT === 100`, `.limit(100)` em toda query; nunca full-scan).
- **`authorized ceiling` ≠ `reserved exposure` ≠ `settled cost`** — `cost` fica `null` sem settlement; teto reservado US$ 0,25 NUNCA vira custo.
- **`reachedReview` ≠ `verified`** — só `verdict === 'verified'` conta como verified; inconclusive alcança review mas não é verified.

### Gates em `9fa181c` (todos verdes, primeira mão)

- core completo **1560/1560**; suíte host ampla **1313/1313** (117 suites); web afetado **12/12**.
- typechecks **5/5** (mobile/web/core/supabase/types); build web **OK**.
- `git diff --check` limpo. **Sem migrations/SQL** → pgTAP não aplicável.
- **Zero chamadas OpenAI pagas.** Flake conhecido (`WorkProposalCard` + `lib/ai/project-tools.test`, só sob carga ampla) não se manifestou.

## Próxima fronteira — OpenAI actual cost settlement / versioned pricing (NÃO implementar agora)

Investigada, deliberadamente não implementada nesta sessão. O seam já existe:

- `ProviderPricingV1` {provider, model, currency, inputPerMillion, outputPerMillion, cachedInputPerMillion?, sourceRef} **já existe**.
- `calculateApiAttemptCost(attempt, pricing, currency)` **já existe** → `known` (derived) quando há pricing, `unavailable('pricing_missing')` quando `null`.
- `providerUsage` e `providerRequestIds` **já são capturados** (request IDs = `body.id` da resposta; não são segredo; a chave vive só na borda `openai-paid-transport.ts`).
- Hoje o adapter passa **`pricing = null` de propósito** ⇒ `cost` indisponível honesto.

**Gaps a fechar (na ordem, sem quebrar invariantes):**

- **(a)** Fonte de **pricing versionado** com `sourceRef` + versão efetiva (nunca hardcode).
- **(b)** Ligar **usage + model + pricing version** no `finishedAt` (hook = `configVersion?` na cohort key).
- **(c)** Reconciliação **assíncrona/offline** com billing/provider real via `providerRequestIds` já retidos (não hot-path).
- **(d)** Separar **derived estimate** de **billed/settled** no bloco `provenance` da observação.
- **(e)** **Nunca inferir `settled` do teto reservado** (reserved ceiling ≠ settled).

Referências: `docs/registros/2026-09-04-compute-economics-observations-v1.md`, memória `project_20260904c_ponte_economic_observations_router`.

## Efeitos externos e limites desta sessão

- **Realizados:** compactação do índice de memória do agente (`MEMORY.md`, fora do repositório); commit deste registro; push para `origin/dev`.
- **Explicitamente NÃO realizados:** nenhuma alteração de código de produção; nenhuma migration/SQL/RPC; nenhum toque em Compute Router, Compute Economics, cloud/provisionamento, transport OpenAI, planner/chat; nenhuma chamada paga; nenhum toque em `origin/main`; nenhum merge/integração; nenhuma credencial usada.

## Próximo ponto exato de retomada

Abrir o recorte aprovado de **OpenAI cost settlement / versioned pricing** começando pelo gap (a) — fonte de pricing versionado com `sourceRef` —, mantendo `derived` separado de `settled` e sem inferir custo do teto reservado. Base: `origin/dev @ 9fa181c` (ou o HEAD deste registro).
