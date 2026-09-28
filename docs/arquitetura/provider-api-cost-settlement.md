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
- Nenhum preço é embutido no código: preços vivem num catálogo de dados versionado com fonte
  oficial. Nenhuma reserva histórica é liquidada automaticamente.

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
3. carrega o catálogo versionado do repositório (ou o override `ANIMA_PROVIDER_PRICING_CATALOG`);
4. decide no core; só `settle` escreve (`settlePaidComputeUsagePricedReservation`).

Fail-open em relação à attempt: erro de leitura/escrita devolve `store_error` e deixa a reserva
aberta e reconciliável (a decisão é recomputável a partir do ledger + evidência).

## Catálogo de preços (Pricing Catalog V1, 2026-09-28)

> Até 2026-09-27 esta seção dizia que o repositório não continha preço real e que um humano
> precisava fornecer o catálogo por `ANIMA_PROVIDER_PRICING_CATALOG`. Desde o registro
> [`2026-09-28-pricing-catalog-v1-b1c.md`](../registros/2026-09-28-pricing-catalog-v1-b1c.md)
> o catálogo oficial é versionado no repositório.

- **Onde vive:** [`apps/web/lib/work-orchestration/provider-pricing-catalog.json`](../../apps/web/lib/work-orchestration/provider-pricing-catalog.json),
  importado estaticamente pelo loader. `ANIMA_PROVIDER_PRICING_CATALOG` (caminho de JSON) é
  **override** de operador e substitui o catálogo inteiro. Catálogo inválido ⇒ `cost_unknown`.
- **Conteúdo:** preços oficiais OpenAI (tier Standard) para os model IDs **exatos** enviados à
  API — `gpt-5.6-sol` e `gpt-5.6-terra`. Não há alias no ANIMA: a string do `model` do request
  é a da reserva (`provider_api:<model>`) e a do catálogo.
- **Dimensões declaradas por versão** (opcionais no schema; o catálogo oficial declara todas):
  `cacheWriteInputPerMillion` (cache writes, 1,25× input no GPT-5.6),
  `longContextInputThresholdTokens` (requisição acima ⇒ `long_context_unpriced`),
  `serviceTier` (a resposta precisa ecoar esse tier). Declarada ⇒ o fato de usage
  correspondente precisa ter sido reportado pelo provider em **toda** chamada; senão
  `usage_pricing_facts_missing`.
- **Fatos de usage** (`ProviderReportedUsageV1`): `cacheWriteInputTokens`,
  `maxCallInputTokens`, `serviceTiers`, `providerModels`, capturados pelo `GptCoderBackend`
  (que agora envia `service_tier: 'default'`).
- **Custo:** `(input − cached − cacheWrite)×input + cached×cachedInput + cacheWrite×cacheWrite + output×output`.
- **Temporal (V1.1):** versão escolhida no instante da reserva.
  - `effectiveFrom` = primeiro instante em que o ANIMA tem evidência **autoritativa** para a
    versão (data da consulta), não a data em que o provider passou a cobrar; nada anterior é
    precificado.
  - `effectiveUntil` só com evidência real de término (ex.: nova versão); fecha a janela.
  - `sourceGuaranteedThrough` (`YYYY-MM-DD`) = garantia "at least through" publicada. **Não**
    expira a versão nem seleciona outra; reserva com data UTC posterior ⇒
    `pricing_guarantee_lapsed` (`cost_unknown`) até reverificação humana da fonte.
  - Atualizar = **adicionar** versão e fechar a anterior; nunca editar uma versão existente.
    Sobreposição ⇒ `pricing_ambiguous`.
  - Histórico da decisão: a V1 (`a68eada`) usou `effectiveUntil` para a garantia do Sol; corrigido
    na V1.1 ([registro](../registros/2026-09-28-pricing-catalog-v1-b1c.md#adendo-v11--correção-temporal-após-revisão-humana-2026-09-28)).

Formato de uma entrada:

```json
{
  "schemaVersion": 1, "pricingVersion": "<provider>/<modelo>@<data>", "provider": "openai",
  "model": "<model ID exato>", "currency": "USD", "serviceTier": "default",
  "inputPerMillion": 0, "cachedInputPerMillion": 0, "cacheWriteInputPerMillion": 0, "outputPerMillion": 0,
  "longContextInputThresholdTokens": 272000,
  "effectiveFrom": "<ISO-8601>", "effectiveUntil": "<ISO-8601 opcional, exclusivo>",
  "sourceGuaranteedThrough": "<YYYY-MM-DD opcional>", "sourceRef": "<URL oficial + data da consulta>"
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
- Long context (> 272K input por requisição) não é precificado ⇒ `cost_unknown`.
- Ainda sem prova viva de que a resposta real ecoa `service_tier`/`cache_write_tokens`/`model`.
- O planner OpenAI não reserva exposição (por design) e portanto não entra neste settlement.
