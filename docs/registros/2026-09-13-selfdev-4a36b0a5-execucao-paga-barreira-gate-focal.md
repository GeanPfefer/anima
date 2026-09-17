# 2026-09-13 — 4a36b0a5: execução paga governada até barreira no gate focal (C1)

## Tipo e objetivo

Sessão de orquestração governada (Claude como executor principal único). Retomar o replacement já
preparado `4a36b0a5-3be8-4431-a3fa-258be13917a3` (recovery_successor seq 3 de `3b0b3c57`, proposal
v1), conceder UMA única authority paga autorizada pelo humano, aprovar/classificar, executar UMA
única attempt pelo Resident Host a partir do checkpoint `421a533`, e parar em `review` ou na
primeira barreira humana real. Não reabrir investigação, não recriar successor, não reimplementar a
primitive `settleOpenAIActualCostReservation`, não alterar política de classificação.

## Estado Git preservado

- Branch: `dev`.
- HEAD inicial/final: `d783a5dc495da692eb7097f7c7252bb5ba074e51` (inalterado).
- `origin/main`: `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- WIP amplo preservado (188 arquivos modificados); nenhum stash/reset/merge/push/commit em `dev`.
- Checkpoint de retomada preservado: `421a533a57cecb64d551647a459c740aff2cd4c7` (que preserva
  `b6201d8daaa50036e91b39c98e1ecf46d0e45130`).
- Output da attempt PRESERVADO na branch `anima-work/2a0011ef-62a4-4f3b-a9bc-575823586138`
  (commit `41e27ec8fc5ffc504c275e6b6038fc1109f84319`).

## Revalidação read-only (pré-execução)

- `4a36b0a5`: `proposed`, v1, sem authority, sem attempt, sem claim (só `work_proposed` +
  `context_attached`).
- Lineage `4277187e-2730-4869-8114-92a77756c706`: `3b0b3c57` → `4a36b0a5`, seq 3,
  `recovery_successor`. Única alteração material vs. o retirado: `max_duration_minutes=30`.
- Item retirado `bea933f2`: `cancelled`. Predecessor `3b0b3c57`: `failed` v3.
- Authority antiga `0e4fc437` (do `bea933f2`, envelope de 20 min): revogada, reserved 0, remaining
  1,5 — zero gasto.
- Causa-raiz da incompatibilidade de 20 min confirmada em código:
  `ensurePlannedProjectClassification` exige `max_duration_minutes===30` e `state==='approved'`
  (`planned-project-classification.ts`). O envelope de 30 min é classificável.

## Efeitos canônicos realizados (ordem exata)

1. Authority única concedida: `71554a8f-802f-4ef4-ad52-e5f791fc8413` — provider `openai`, node
   `openai-api`, resource_class `provider_api:gpt-5.6-terra`, work item `4a36b0a5`,
   `maxDurationMs 1_800_000` (30 min), `maxCost USD 1.50`, validade 72h
   (validUntil `2026-09-16T06:57:45Z`). Guarda anti-duplicação passou.
2. `4a36b0a5` aprovado v1.
3. Classificação real: `ok: true, replayed: false` (classifier `openai_project_tools_v1-bridge`,
   recuperado pela lineage; policy `human-approved-project-planner-v1`).
4. Roteamento confirmado (evento `compute_routing_decided`): `status: selected`,
   `selectedProvider: openai`, `selectedModel: gpt-5.6-terra`, `authorizationId 71554a8f`,
   `paidAuthorityRequired: true`. Alternativa Ollama `qwen3-coder:latest` inadmissível
   (`model_or_resource_incompatible` + `resource_governor_deny`). Router V1 ON, on-demand OFF,
   VRAM local 16 GiB < 20 GiB exigido ⇒ local inviável.
5. UMA attempt executada pelo Resident Host: `2a0011ef-62a4-4f3b-a9bc-575823586138`, executor
   `worktree-v1`, effort `strong`.

## Desfecho: execution_failed no gate C1 (NÃO retryable)

- Coder OpenAI `gpt-5.6-terra` `outcome: succeeded` em ~53s; **6 provider calls**; usage terminal
  provider-reported: input 22.858, output 5.131, cached 4.623, total 27.989 tokens (dentro do teto
  operacional humano de 8 calls).
- Diff da attempt vs. checkpoint `421a533`: SOMENTE 2 arquivos —
  `post-turn-observation.ts` (+20/−3) e `post-turn-observation.test.ts` (+58, NOVO).
  `autonomous-backlog-deps.ts` NÃO foi tocado (o caller vivo não foi ligado).
- C1 (`npm test --workspace=@anima/web -- post-turn-observation.test.ts
  openai-actual-cost-settlement.test.ts`): **failed, exitCode 1, 12.943 ms** (não timeout).
- C2 (typecheck): NÃO executado (gates param na primeira falha).
- C3 (contenção): NÃO avaliado formalmente (falha antes do Verifier). Contenção observada vs.
  checkpoint = 2 arquivos in-scope; nenhum arquivo fora de escopo introduzido por esta attempt.
- Verifier: NÃO alcançado.
- Causa provável (estática, do diff): o teste chama `persistPostTurnHostObservations(...)`
  DIRETAMENTE com entradas stubbadas (`client: {} as never`, sinks mockados), não via
  `buildProjectBacklogCycleDeps(...).runTurn` — exatamente o padrão que a proposta declara
  insuficiente — e falhou mesmo assim; além disso `autonomous-backlog-deps.ts` não foi editado, de
  modo que o binding vivo não é provado. Correção do import (`settlePaidComputeBudgetReservation`
  de `paid-compute-authorization-store`) foi aplicada, mas não bastou.

## Financeiro (fail-closed; teto ≠ custo)

- Reservation única desta attempt: `74bfd377-c60b-4c08-939c-f5e461344555` — US$1,50, node
  `openai-api`, lease `provider-api:2a0011ef...`, **ABERTA/unsettled**, `cost_unknown`.
- Authority `71554a8f`: reserved 1,5 / committed 1,5 / remaining 0,00.
- Nenhum settlement e nenhum void nesta sessão (verificado: 0 eventos `settled`/`voided` nos
  últimos 30 min). Sem ProviderPricingV1 válido ⇒ custo real indeterminável; a reserva NÃO foi
  liquidada artificialmente (o provider FOI chamado ⇒ void inaplicável).
- Reservas anteriores intocadas, incluindo a fora-de-escopo `61b3acc4-d783-4f6f-abe7-e3292310c742`
  (authority `73c9e25b`, da attempt `e91687b8`).

## Invariantes de segurança respeitados

- Identidade residente via GoTrue → Bearer → RLS; NUNCA `service_role`.
- Exatamente UMA authority e UMA attempt; nenhuma segunda concessão/volta após a falha.
- `origin/main` intacta; `dev` HEAD inalterado; WIP preservado; nenhum merge/push/deploy.
- `reached execution ≠ verified`; `authorized ceiling ≠ reserved ≠ settled`.

## Próximo ponto exato (fronteira humana)

Barreira humana real: a capacidade atual do coder OpenAI (gpt-5.6-terra, 6 calls) NÃO completou o
binding vivo desta unidade — não editou `autonomous-backlog-deps.ts` e o teste focal não atravessa
o caller vivo, resultando em C1 FAIL. Decisão humana pendente: (a) autorizar novo recorte/attempt
(nova authority explícita — TODAS as por-item expiram; esta `71554a8f` foi consumida e a reserva
`74bfd377` fica aberta), possivelmente com orientação de escopo mais forte (obrigar edição do
caller vivo em `autonomous-backlog-deps.ts` e teste via `buildProjectBacklogCycleDeps(...).runTurn`),
ou (b) hand-author da correction. Não reabrir sem recorte aprovado. Output preservado em
`anima-work/2a0011ef...` (`41e27ec8`).

Scripts operacionais desta sessão (untracked, preservados em `apps/web/scripts/`):
`inspect-selfdev-4a36b0a5-readonly.ts`, `selfdev-4a36b0a5-grant-authority.ts`,
`selfdev-4a36b0a5-approve-classify.ts`, `selfdev-4a36b0a5-execute-one-turn.ts`,
`inspect-selfdev-4a36b0a5-postmortem.ts`.
