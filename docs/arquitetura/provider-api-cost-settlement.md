# Provider API Cost Settlement V1 (B1)

Status: implementado em 2026-09-27 (`dev`). Registro da sessão:
[`2026-09-27e-provider-api-cost-settlement-b1.md`](../registros/2026-09-27e-provider-api-cost-settlement-b1.md).

## Problema (B1)

O coder OpenAI (`provider_api`) reserva **todo o teto humano** na 1ª chamada paga da attempt
(`createOpenAICoderAdmission`: idempotência `openai-attempt:<attempt>`, lease
`provider-api:<attempt>`). Não existia caminho pós-attempt que transformasse a usage reportada
pelo provider em custo e liquidasse a reserva. Resultado: toda attempt `provider_api` terminava com
reserva aberta, `cost_unknown`, e o `committed` da autoridade carregava o teto inteiro.

A causa não era falta de usage: o `GptCoderBackend` já acumulava usage em sucesso **e** falha
(`withCoderFailureUsage`) e o worktree executor a entregava ao host (`onCoderObserved`). Faltavam:
preço autoritativo versionado, uma fonte de custo honesta para "usage × preço", critério de
completude da usage e a fiação no fim da attempt.

## Invariantes

- `usage observada ≠ preço conhecido ≠ custo liquidado`; `authorized ≠ reserved ≠ settled`.
- Sem usage **completa** ou sem preço **versionado vigente** ⇒ `cost_unknown` (reserva aberta).
  Unknown **nunca** vira zero e o teto **nunca** vira custo.
- O custo não depende do desfecho da attempt (sucesso/falha/cancelamento).
- `S ≤ R`: custo derivado acima da reserva **não** é clampado em silêncio ⇒
  `requires_human_reconciliation` (reserva segue aberta).
- Settlement é append-only, idempotente por (reserva, versão de preço, valor); versão, valor ou
  fonte divergentes conflitam (`55000`) — nunca liquida duas vezes.
- Nenhum preço é embutido no código. Nenhuma reserva histórica é liquidada automaticamente.

## Contrato

Core puro — [`packages/core/src/work-orchestration/provider-api-settlement.ts`](../../packages/core/src/work-orchestration/provider-api-settlement.ts):

| Conceito | Tipo |
|---|---|
| Preço versionado | `ProviderPricingEntryV1` = `ProviderPricingV1` (reuso de `compute-economics`) + `pricingVersion` + janela `[effectiveFrom, effectiveUntil)` |
| Catálogo | `ProviderPricingCatalogV1` (`catalogRef`, `entries`); `parseProviderPricingCatalog` fail-closed no catálogo inteiro |
| Seleção | `resolveProviderPricing` — única versão vigente no instante da **reserva**; nenhuma ⇒ `pricing_missing`, sobreposição ⇒ `pricing_ambiguous` |
| Usage | `aggregateProviderApiAttemptUsage` sobre `ObservedCoderInput[]` ⇒ `complete` / `absent` / `incomplete` / `inconsistent` |
| Decisão | `deriveProviderApiSettlement` ⇒ `settle` / `cost_unknown` / `requires_human_reconciliation` / `already_settled` / `settlement_conflict` / `not_applicable` |
| Proveniência | `ProviderApiSettlementProvenanceV1` (attempt, provider, modelo, catálogo, versão, sourceRef, tarifas, usage, custo exato, regra de arredondamento) |

**Completude da usage.** `ProviderReportedUsageV1` ganhou cobertura opcional:
`reportedCallCount` (chamadas despachadas com usage) e `unreportedCallCount` (despachadas sem usage:
erro de transporte, HTTP não-ok, corpo sem usage). Recusa de admissão não conta (nada enviado). A
usage só é `complete` quando toda observação com chamadas declara cobertura e
`unreportedCallCount = 0`. Evidência legada (sem cobertura) ⇒ `incomplete`.

**Aritmética.** Tarifas por milhão com ≤ 9 casas decimais, escaladas sem perda para `BigInt`; custo
exato em femto-unidades (1e-15); valor liquidado arredondado **para cima** ao micro (1e-6). Se o
arredondamento cruzar `R` com custo exato ≤ `R`, liquida exatamente `R`.

**Ledger** — migration aditiva
[`20260927000000_provider_api_usage_priced_settlement.sql`](../../supabase/migrations/20260927000000_provider_api_usage_priced_settlement.sql):
coluna `paid_compute_budget_events.settlement_provenance jsonb`; fonte `usage_priced` (só em
`settled`, sempre com proveniência — constraint); RPC
`settle_paid_compute_usage_priced_reservation(reservation, currency, amount, provenance)` com as
invariantes da RPC existente + coerência provider/modelo/attempt/moeda da proveniência com a
reserva + replay por versão de preço. A RPC legada continua recusando `usage_priced`.

## Fluxo

`autonomous-backlog-deps` (fim da volta, após a observação pós-turno, **qualquer desfecho**,
`coderBackend = openai`) → `settleProviderApiAttemptCost`
([`apps/web/lib/work-orchestration/provider-api-settlement.ts`](../../apps/web/lib/work-orchestration/provider-api-settlement.ts)):

1. lê a reserva da attempt (`readProviderApiReservationForAttempt`, lease `provider-api:<attempt>`);
2. agrega a usage das `coderObservations` e usa o modelo **observado** do backend;
3. carrega o catálogo de `ANIMA_PROVIDER_PRICING_CATALOG` (caminho de um JSON curado por humano);
4. decide no core; só `settle` escreve (`settlePaidComputeUsagePricedReservation`).

Fail-open em relação à attempt: erro de leitura/escrita devolve `store_error` e deixa a reserva
aberta e reconciliável (a decisão é recomputável a partir do ledger + evidência).

## Preço real — fronteira humana

O repositório **não contém preço real**. Sem `ANIMA_PROVIDER_PRICING_CATALOG`, toda attempt
`provider_api` continua `cost_unknown` (comportamento idêntico ao anterior, agora explícito). Para
liquidar em produção, um humano precisa fornecer um catálogo com, por modelo usado
(ex.: `gpt-5.6-sol`, `gpt-5.6-terra`): moeda, tarifa de input, de input em cache e de output por
milhão de tokens, `effectiveFrom`, `pricingVersion` imutável e `sourceRef` rastreável à fonte
oficial.

Formato:

```json
{
  "schemaVersion": 1,
  "catalogRef": "<revisão do catálogo>",
  "entries": [{
    "schemaVersion": 1, "pricingVersion": "<provider>/<modelo>@<data>", "provider": "openai",
    "model": "<modelo>", "currency": "USD", "inputPerMillion": 0, "cachedInputPerMillion": 0,
    "outputPerMillion": 0, "effectiveFrom": "<ISO-8601>", "sourceRef": "<fonte oficial>"
  }]
}
```

## Histórico

Reservas antigas (`cost_unknown`) **não** são tocadas: o caminho só roda no fim de uma attempt
nova. Mesmo um reprocessamento manual futuro cairia em `cost_unknown` por construção: a evidência
histórica não tem cobertura de chamadas (`usage_incomplete`) e a seleção de preço usa o instante
da reserva (um catálogo com vigência posterior não retroage). Uma reconciliação histórica exigiria
decisão humana explícita e evidência de completude externa; o primitive puro já serve de contrato.

## Dívida restante

- A razão de um `cost_unknown` não é persistida (é recomputável); não há evento dedicado.
- Chamada despachada que falhou sem usage (ex.: 429/5xx/timeout) bloqueia o settlement da attempt
  inteira (conservador: não se sabe se houve cobrança).
- `provider_confirmed` (fatura/API de custo do provider) não é consultado; `usage_priced` é custo
  derivado, não faturado.
- O planner OpenAI não reserva exposição (por design) e portanto não entra neste settlement.
