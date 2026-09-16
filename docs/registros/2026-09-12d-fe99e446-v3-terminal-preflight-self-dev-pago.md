# 2026-09-12d — fe99e446 revisado para v3 TERMINAL + preflight do self-dev pago (sem execução)

## Objetivo e mandato

Codex reauditou o harness e deu **A) APPROVED** (Trilha C concluída). Decisão humana: preparar o
próximo passo — revisar o successor `fe99e446` (sem criar outro) para uma proposta **v3 terminal**
executável até `review`, e PARAR antes de qualquer provider pago, entregando um preflight objetivo
(provider/modelo, capacidade, teto financeiro, validade, authority exata, estado pré-execução).
Proibições reafirmadas: NÃO chamar OpenAI/RunPod/provider; NÃO conceder/consumir paid authority;
NÃO executar o successor; NÃO liquidar reservas; NÃO push; NÃO tocar `origin/main`; preservar WIP.

## Estado

- Branch `dev`; HEAD `d783a5dc495da692eb7097f7c7252bb5ba074e51` (sem commit). `origin/main`
  `99bec54e3ab42bfe882a8686cd1385d8058b916e` INTACTA. Sem push.
- Zero provider, zero gasto, zero write no ledger; nenhuma reserva tocada; `service_role` não usado.

## v3 TERMINAL de `fe99e446-9f14-45d0-97f5-764e9c2af8a9`

Persistida via `service.reviseProposal` (evento `proposal_revised` v2→v3, **14:15:55Z**) — HAND-AUTHORED
pelo executor sob direção humana explícita, SEM planner pago. Lineage preservada (v1→v2→v3); nenhum
successor novo; item permanece `proposed` (não aprovado, sem attempt).

- `planner` mantido `openai_project_tools_v1` (fonte de classificação: fe99e446 não tem
  canonical_provenance nem lineage de recovery; trocar por valor de operador o tornaria
  inclassificável no approval). Conteúdo da v3 é do executor — transparente aqui.
- execution_spec preservado: executor `worktree`; coder_backend `openai`; base_sha `d783a5d`;
  target project/anima; permissions `[workspace_read, workspace_write_isolated]`; limits
  `max_attempts 3 / max_duration_minutes 30`. Envelope de classificação: **satisfeito**.
- included_scope (9, terminal — inclui os testes focais que faltavam): compute-economics.ts(+test),
  openai-actual-cost-settlement.ts(+test), openai-paid-compute.ts(+test), post-turn-observation.ts(+test),
  autonomous-backlog-deps.ts.
- excluded_scope: autonomous-backlog-deps-router.test.ts, migrations, reservas históricas
  c0edc775/8e51abf5/b1c37346 e settlement de reservas antigas, Verifier v2, Ponto 1, integração,
  merge, deploy, origin/main, Ollama, RunPod.
- validation_criteria proof-typed (2 gate Jest + 1 scope) com **covers == expectedEffects
  (aligned=true)**. Runner Jest canônico; a defesa de harness (pré-coder + AST + fail-closed +
  policy não-enfraquecível) protege a execução HOST-SIDE.

## Preflight para a decisão humana (resumo; detalhe no retorno da sessão)

- **Provider/modelo:** planner = NENHUM pago (v3 já autorada; classificação = bridge determinístico,
  sem LLM). Coder = OpenAI `gpt-5.6-terra` (forte; local inadmissível por RAM + capacidade honesta).
  Uma única authority (do coder); não há authority de planner.
- **Teto financeiro:** pricing versionado (`ProviderPricingV1`) para `gpt-5.6-terra` **NÃO existe no
  sistema** ⇒ `calculateApiAttemptCost`→`cost_unknown`; custo USD exato NÃO é derivável. Dado
  faltante: rates USD (input/cachedInput/output por milhão) + sourceRef + effectiveFrom para
  openai/gpt-5.6-terra. Base empírica observada (attempt 8021c1ce comparável): 7 calls, 54.258 tokens.
  Recomendação de teto: mínimo US$1,00; confortável US$1,50; pior caso = o teto é reservado e, sem
  pricing vivo, a reserva do attempt permanece ABERTA (fail-closed) — como as 3 já abertas.
- **Validade:** recomendo `validUntil` ≥ 72h (confortável 7 dias) — NÃO repetir authority expirando
  em minutos/no mesmo dia.
- **Authority a conceder (pelo humano):** provider openai; nodeId openai-api; resourceClass
  `provider_api:gpt-5.6-terra`; workItemId fe99e446; maxCost US$1,00–1,50; maxDurationMs ~90min;
  validUntil now+72h..7d.
- **Estado pré-execução:** proposta v3; scope/criteria finais; authority NÃO concedida; zero provider;
  zero gasto; successor NÃO executado.

## Fronteira / próximo passo

Decisão financeira humana: (a) conceder a authority acima; (b) aprovar fe99e446 (dispara
classificação); (c) executar via resident host construído a partir do WIP atual (harness presente).
Só então o coder pago roda. Referências: `2026-09-12c-...` (harness aprovado), `2026-09-11c-...`.
