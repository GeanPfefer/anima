# 2026-09-12e — fe99e446 v3: execução paga OpenAI até `review` VERIFIED

## Objetivo e mandato

Decisão financeira humana autorizada: conceder UMA authority (US$1,50, 7 dias) e executar o self-dev
pago do successor `fe99e446` v3 até `result_submitted → verifier → review` ou primeira barreira real.
Fail-closed de pricing reafirmado (não inventar preço; não liquidar pelo teto; preservar reserva
aberta se `cost_unknown`; preservar as 3 reservas históricas). Sem segunda authority; sem merge/
integração/deploy; origin/main intacta; Ollama/RunPod fora.

## Estado

- Branch `dev`; HEAD `d783a5dc495da692eb7097f7c7252bb5ba074e51` (inalterado). `origin/main`
  `99bec54e3ab42bfe882a8686cd1385d8058b916e` INTACTA. Sem push. WIP da working tree intacto (attempt
  rodou em worktree ISOLADA).

## Authority concedida

- `20f546b1-ccd1-4499-b6a0-19f7eb051fe3` — openai/openai-api/`provider_api:gpt-5.6-terra`, item
  fe99e446, teto US$1,50, maxDurationMs 5_400_000, validFrom 2026-09-12T14:22:35Z, validUntil
  2026-09-19T14:23:05Z (exatamente 7 dias). Única; sem authority de planner.

## Execução (caminho canônico, host do WIP atual — harness aprovado ATIVO)

Router V1 ON, on-demand OFF. `resolveApproval` (v3) → `ensurePlannedProjectClassification` (novo,
não replay) → `runProjectBacklogHostTurn` (1 ciclo/1 turno). Outcome do turno: **execution_completed**.

- Attempt `77d751c2-f642-4c0d-89da-7ca47feee3b1`; claim `31a47092`; executor `worktree-v1`.
- Coder **OpenAI `gpt-5.6-terra`** (placement remote, openai-api), duração 54,03s, outcome succeeded.
- Reserva **`3435b02c-545b-416c-aadd-bd069c178ff6`** (lease `provider-api:77d751c2`, correlacionada ao
  attempt), US$1,50 — **ABERTA/unsettled** (fail-closed). Authority remaining US$0,00 (teto reservado).

## Resultado — REVIEW VERIFIED

Event log: … → checkpoint_recorded → **result_submitted** → work_claim_released → gate/coder/git
evidence → **verifier_opinion_recorded**.

- Gates: **C1 (core Jest compute-economics.test.ts) PASSED** exit 0; **C2 (web Jest
  openai-actual-cost-settlement.test.ts + post-turn-observation.test.ts + openai-paid-compute.test.ts)
  PASSED** exit 0; C3 (scope) declared → provado independente pelo Verifier.
- **Verifier verdict: `verified`** — 13 checks, 8 attested, 5 independent, 0 violations, 0 gaps
  (correlation/branch_ownership/scope_independently_observed/scope_respected/status_coherent/
  gates_independently_observed/criterion_covered×2/scope_criterion_covered/acceptance_criterion_covered).
- Git: commit `b6201d8daaa50036e91b39c98e1ecf46d0e45130`, base d783a5d, branch
  `anima-work/77d751c2…` (preservada). Diff contido ao escopo: **2 arquivos, +111** —
  `openai-actual-cost-settlement.ts` (+88) e `.test.ts` (+23).

## Usage / custo (fail-closed)

- Provider-reported: **7 calls; input 47.678; cached 16.257; output 4.636; total 52.314 tokens.**
- **Custo real: `cost_unknown`** — não existe `ProviderPricingV1` para gpt-5.6-terra ⇒
  `calculateApiAttemptCost`→unavailable. NÃO inventado, NÃO liquidado pelo teto. Reserva `3435b02c`
  permanece ABERTA/unsettled com a evidência de usage. As 3 reservas históricas (688c7a44, e3d316d8,
  b1c37346) seguem abertas e intactas. RunPod `3b87224f` intocada.

## Leitura honesta para a revisão humana

O coder implementou `settleOpenAIActualCostReservation(...)` — função fail-closed GENUÍNA: correlaciona
`reservationId`↔attempt (attempt_mismatch), exige `terminalEvidence`, idempotência via
`settledReservationIds` (already_settled), custo por `calculateApiAttemptCost`+`ProviderPricingV1`
(cost_unavailable quando pricing null), guarda `reservation_exceeded` (moeda/amount>reservado), e só
então chama o callback `settlePaidComputeBudgetReservation` com trilha de auditoria. Prova unitária +
gates verdes + Verifier verified.

**Fronteira de revisão:** a função é AUTOCONTIDA (2 arquivos). O callback/`reservation`/`usage`/
`pricing`/`cohort` são INJETADOS; o coder NÃO alterou `post-turn-observation.ts`/`autonomous-backlog-deps.ts`,
ou seja, NÃO há binding vivo do terminal pós-turno à API canônica do store nesta attempt (o próprio
docstring diz "callers must bind it"). Em produção `pricing=null` ⇒ o caminho retornaria
`cost_unavailable` (fail-closed, reserva aberta — coerente com 3435b02c). Portanto: verified-review no
nível de contrato/unidade; o **wiring vivo terminal** é exatamente o foco da revisão humana (accept vs
request_changes). Nada foi aceito/integrado/mergeado.

## Fronteira / próximo passo (humano)

`review` é gate humano: accept → `completed` (sem merge/integração; INT-05 intacta) OU request_changes
(pedir o binding vivo do terminal). Saneamento contábil (settle real das reservas) permanece trilha
separada e depende de configurar `ProviderPricingV1` para gpt-5.6-terra. Refs: `2026-09-12d-...`,
`2026-09-12c-...`.
