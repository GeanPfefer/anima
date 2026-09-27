# 2026-09-27e — B1: settlement seguro de custo `provider_api`

## Objetivo

Resolver a dívida B1: attempts via `provider_api` terminavam com reserva `cost_unknown` porque
não existia settlement pós-attempt. Executor único: Claude. Gasto: **US$0** (nenhuma chamada a
provider, nenhuma authority/reserva real nova).

## Estado git

- Branch `dev`. HEAD inicial `18578f0` (= `origin/dev` = `backup/marco-evolution-v2-2026-09-27`).
- `main` = `origin/main` = `99bec54` intocada. Sem push.
- WIP preservado intocado: `.worktrees/`, `apps/web/scripts/_session/`, `watch4-sensors.txt`.

## Diagnóstico (read-only)

- Ao fim de uma attempt `provider_api`, o host já tem: `coderObservations` com `providerUsage`
  (tokens in/cached/out/total) e `providerCallCount`, **inclusive em falha**
  (`withCoderFailureUsage` → `coderFailureUsage` no worktree executor); o modelo observado do
  backend; a reserva no ledger (`openai-attempt:<attempt>`, lease `provider-api:<attempt>`,
  valor = teto humano inteiro).
- Faltava: (1) preço autoritativo versionado — não existe em lugar nenhum; `ProviderPricingV1` e
  `calculateApiAttemptCost` existiam só para métricas, com `pricing: null`; (2) fonte de custo
  honesta — o ledger só aceitava `estimated` (tempo de node) e `provider_confirmed` (fatura),
  sem proveniência de versão de preço; (3) critério de completude — sem saber se toda chamada
  despachada reportou usage, liquidar sub-reportaria; (4) fiação no fim da attempt.
- Primitives reaproveitados: ledger append-only + invariantes da RPC de settle (`20260910000001`),
  `ProviderPricingV1`, `ProviderReportedUsageV1`, `ObservedCoderInput`, a agregação de
  `coder-evidence`, o padrão de role robusto (`20260910000003`).
- O oráculo congelado `0bea4c8` **não** foi consultado nem reutilizado; implementação independente.

## Mudanças

Contrato e fluxo detalhados em
[`docs/arquitetura/provider-api-cost-settlement.md`](../arquitetura/provider-api-cost-settlement.md).

- `packages/core/src/work-orchestration/provider-api-settlement.ts` (+ test, 29 casos): catálogo
  versionado fail-closed, seleção por vigência no instante da reserva, agregação de usage com
  completude, aritmética decimal exata (BigInt), decisão pura de settlement e proveniência.
- `host-observed-coder-evidence.ts`: cobertura opcional `reportedCallCount`/`unreportedCallCount`.
- `apps/web/lib/work-orchestration/gpt-coder.ts`: conta chamadas despachadas sem usage (erro de
  transporte, HTTP não-ok, corpo sem usage); recusa de admissão não conta.
- `coder-evidence.ts`: agrega a cobertura só quando todo turno com chamadas a declara.
- `paid-compute-authorization-store.ts`: `PaidComputeCostSourceV1` (inclui `usage_priced`),
  `readProviderApiReservationForAttempt`, `settlePaidComputeUsagePricedReservation`.
- `provider-api-settlement.ts` (web, + test): loader de `ANIMA_PROVIDER_PRICING_CATALOG` e
  `settleProviderApiAttemptCost` com store injetável.
- `autonomous-backlog-deps.ts`: chama o settlement após a observação pós-turno, em qualquer
  desfecho, fail-open.
- Migration aditiva `20260927000000_provider_api_usage_priced_settlement.sql` + typegen
  (`database.ts`, +12 linhas) + pgTAP `paid_compute_usage_priced_settlement.test.sql`.

## Decisões

- **Preço não é inventado nem embutido.** A implementação exige catálogo externo curado por
  humano; ausente ⇒ `cost_unknown`. Testes usam apenas fixtures marcadas como fictícias.
- **Fonte nova `usage_priced`** em vez de reaproveitar `estimated`: custo derivado por tokens ×
  tarifa versionada é epistemicamente distinto de tempo × preço/h e de fatura do provider, e
  precisa carregar a versão de preço usada.
- **Preço vigente no instante da reserva** (início do gasto), não no instante do settlement.
- **Custo > reserva não clampa**: vira `requires_human_reconciliation`, reserva segue aberta.
- **Arredondamento para cima ao micro**; custo exato preservado na proveniência.
- **Usage parcial não liquida**: uma chamada despachada sem usage bloqueia a attempt inteira.

## Provas / gates

- Core focal `provider-api-settlement.test.ts`: 29/29. Core completo: 102 suítes / 2.122 testes.
- Web focais `provider-api-settlement` + `gpt-coder` + `coder-evidence`: 3 suítes / 83 testes.
- Web sweep `lib/work-orchestration` + `lib/ai`: 106 suítes, 1.408/1.409; a falha é o flake
  conhecido `lib/ai/project-tools.test.ts` (passa isolado, 4/4).
- pgTAP: `paid_compute_usage_priced_settlement` 19/19; `paid_compute_budget_settlement` e
  `paid_compute_aggregate_budget` verdes.
- `npm run typecheck` (4 workspaces) verde; `npm run build` verde.

## Achado fora do escopo (não corrigido)

`paid_compute_provider_api_correlation.test.sql` falha 3/8 **antes e independentemente** desta
mudança: a função viva `reserve_paid_compute_budget` não contém o bloco de correlação
attempt↔work item da `20260904000000` (verificado em `pg_proc`), provavelmente perdido quando
`20260910000001/03` recompilaram o `reserve` a partir do corpo da `20260831000004`. É regressão de
defesa em profundidade do reserve; a admissão OpenAI continua amarrada por autoridade por-item.
Fica como próxima unidade separada (migration aditiva que reúna os corpos).

## Efeitos externos

- **Realizados:** subir Docker Desktop + `supabase start` (reattach); `supabase migration up`
  local (só `20260927000000` pendente); `supabase gen types --local`; pgTAP (transação + ROLLBACK).
- **Ledger histórico:** hash `md5` de todos os eventos idêntico antes/depois
  (`54b7476a…`): 58 `reserved`, 18 `settled/estimated`, 2 `voided`; 0 linhas com proveniência.
- **Não realizados:** nenhuma chamada OpenAI/RunPod/Ollama; nenhuma authority, reserva, attempt,
  settle ou void real; nenhum backfill; nenhum `db reset`; nenhum push; `main` intocada.

## Fronteira humana e retomada

- Para liquidar em produção: humano fornece o catálogo de preços oficial (moeda, tarifas de
  input / input em cache / output por milhão, `effectiveFrom`, `pricingVersion`, `sourceRef`)
  para cada modelo usado e aponta `ANIMA_PROVIDER_PRICING_CATALOG` para ele no Resident Host.
- Reservas históricas (`7398bb8d`, `11031d53`, `9d80439d`, `b1239ccb`, …) seguem `cost_unknown`;
  reconciliá-las exige decisão humana e evidência de completude que a evidência legada não tem.
- Próximo passo técnico sugerido (fora deste mandato): restaurar a correlação provider_api no
  `reserve`.
