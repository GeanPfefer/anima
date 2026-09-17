# 2026-09-14c — Request changes de 5fad667 e preflight da correction 571d29be

## Objetivo

Rejeitar canonicamente o output `5fad667`, criar a próxima correction com contrato técnico
anti-hallucination e preparar um harness host-side não-gameável, parando antes de approval,
authority, reservation, attempt ou provider call.

## Lifecycle

- `request_changes` persistido em `4eb79eb4-f6c4-40a5-b791-2e9d671a33c5`, referenciando o result
  event `7b359adb-1619-471b-be6d-872db4b79ce3`; estado final `changes_requested`.
- Correction criada exclusivamente por `correctReviewedWorkItem`:
  `571d29be-2912-4775-80e0-ba8df1e00a5e`, lineage
  `364e95d9-010e-4660-b098-e0c7dcbe9ae9`, recovery sequence 1.
- Revisão canônica da proposta até v2 `proposed`; capability `programming`, impact `low`, uma
  attempt, 30 minutos, base `ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe`, retomada de
  `5fad66796af8ceeb8ad3f175dfeba911c324caec` na branch da attempt anterior.
- Escopo exato preservado: `post-turn-observation.ts` e teste;
  `autonomous-backlog-deps.ts` e `autonomous-backlog-deps-router.test.ts`.

## Referência técnica e contrato

O diff `ccb7dcc..0bea4c8` foi inspecionado apenas read-only; `af313c3` confirmou a linha validada.
A síntese foi incorporada ao objective/criteria v2: o caller resolve reservation pelo lease,
projeta usage terminal de `coderObservations`, constrói provider/model/cohort/pricing, passa
`ProviderPricingV1|null` ao adapter; o adapter chama `settleOpenAIActualCostReservation` e traduz
`OpenAISettlementAuditV1` para `settlePaidComputeBudgetReservation(client,
{reservationId, settled:audit.actualCost, costSource})`. Pricing nulo não liquida.

E1–E7 proíbem nova RPC/tabela/migration/protocolo, `actualCostUsd` do caller, nomes substitutos e
`any`; exigem mudança material de `autonomous-backlog-deps.ts`, testes semânticos e harness externo.
Se API real faltar, o coder deve parar com evidência, não inventar. A referência não foi promovida,
cherry-picked, merged nem copiada para qualquer output governado.

## Harness host-side

Harness transitório em worktrees destacadas: sobreposição, controlada pelo host, somente de
`post-turn-observation.test.ts` e `autonomous-backlog-deps-router.test.ts` de `0bea4c8`; execução
explícita dessas duas suítes mais `openai-actual-cost-settlement.test.ts` e
`paid-compute-authorization-store.test.ts`. Junctions e worktrees foram removidos após cada alvo.

- Primeira invocação contra `61eb2eb` encontrou apenas duas suítes e foi descartada como evidência.
- Invocador corrigido (`--runTestsByPath`, cwd físico `apps/web`):
  - `61eb2eb`: FAIL, 2 suítes falhas/2 verdes; caller não aceita pricing e adapter não aceita facts.
  - `5fad667`: FAIL idêntico; a RPC inventada não satisfaz os contratos fortes.
  - `0bea4c8`: PASS, 4 suítes/22 testes.

Os testes controlados pelo output não conseguem alterar esse overlay. O harness preparado será
reaplicado ao eventual output futuro, além dos gates da attempt.

## Financeiro e parada

- Authority anterior `7bd202af-c649-4efe-b70a-43e7a27d8ae0` preservada; reservation
  `6bc73048-cd11-4194-ac22-c9492caaa269` aberta, USD 1,50, não liquidada, `costSource=null`.
  Usage factual anterior preservado; pricing ausente e `cost_unknown`; sem void/reuse/transfer.
- A correction nova tem zero authorities. Nenhuma chamada paga nesta sessão.
- Estrutura classificável: target/permissões/limites/critérios válidos e lineage chega ao planner
  `openai_project_tools_v1` em `fe99e446`.
- Branch `dev`, HEAD `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`; `origin/main`
  `99bec54e3ab42bfe882a8686cd1385d8058b916e`; WIP auxiliar preservado e worktrees transitórias removidas.
- Parada exata: checkpoint pré-pago atingido em `proposed` v2; aguarda autorização humana separada.
