# 2026-09-28 — Pricing Catalog V1 / fechamento B1.C (`provider_api`)

## Objetivo

Fechar a última barreira do B1: preço **autoritativo e versionado** para attempts `provider_api`,
sem inventar preço e sem equivalência implícita entre aliases. Executor único de mutação: Claude
(Codex em auditoria read-only paralela de Durability, não tocada). Gasto: **US$0**.

## Estado git

- Branch `dev`. HEAD inicial `92b2f0f` (= `origin/dev` = `backup/marco-paid-compute-settlement-2026-09-27`).
- `main` = `origin/main` = `99bec54` intocada. Sem push.
- WIP preservado intocado: `.claude/settings.local.json`, `.worktrees/`, `apps/web/scripts/_session/`, `watch4-sensors.txt`.

## Reconstrução (read-only)

| Pergunta | Resposta (evidência) |
|---|---|
| `provider` que o settlement recebe | `'openai'` literal (`autonomous-backlog-deps.ts`, só com `coderBackend === 'openai'`). |
| `model` que o settlement recebe | `ObservedCoderInput.model` = `GptCoderBackend.observation.model`, único entre observações (divergência ⇒ `model_mismatch`). |
| model string enviada à OpenAI | a **mesma** string: `body: { model, … }` em `gpt-coder.ts` (`resolveOpenAICoderModel`: `ANIMA_CODER_MODEL` ⇒ `OPENAI_MODEL` ⇒ `gpt-5.6-terra`; ou preferência por unidade). |
| `sol`/`terra` são aliases internos? | **Não.** Não há tabela de alias no ANIMA; `gpt-5.6-sol`/`gpt-5.6-terra` vão verbatim no campo `model` da Responses API. A doc oficial publica exatamente esses IDs (página do modelo: "Snapshot alias `gpt-5.6-sol`"). Resource class da reserva = `provider_api:<mesma string>`. |
| instante de vigência | `reservation.createdAt` (1ª chamada paga da attempt), inalterado. |
| sourceRef/pricingVersion | entram na proveniência `usage_priced` (jsonb) e a RPC exige ambos não-vazios; replay compara `pricingVersion`. |

Achado da reconstrução, **decisivo**: a doc oficial cobra dimensões que o settlement de `e0adff7`
não observava. Publicar só as três tarifas teria **sub-reportado custo**:

1. **Cache writes** (GPT-5.6+): 1,25× a tarifa de input não-cacheado, reportados em
   `usage.input_tokens_details.cache_write_tokens` (subconjunto de `input_tokens`). O parser do
   coder ignorava o campo ⇒ tokens escritos em cache seriam precificados a 1×.
2. **Long context**: requisição com > 272K tokens de input ⇒ 2× input e 1,5× output **na
   requisição inteira**. A usage era só agregada; o limiar é por requisição.
3. **Tier de processamento**: Standard/Flex/Batch/Fast têm tabelas diferentes. O request não
   enviava `service_tier` (⇒ `auto` = configuração do projeto) e a resposta não era lida.
4. **Modelo ecoado**: a resposta traz `model`; não era capturado.

## Fonte oficial (consultada em 2026-09-28)

- <https://developers.openai.com/api/docs/pricing> (antes `platform.openai.com/docs/pricing`, 301).
- <https://developers.openai.com/api/docs/models/gpt-5.6-sol>, <https://developers.openai.com/api/docs/models/gpt-5.6-terra>.
- <https://developers.openai.com/api/docs/guides/prompt-caching> (cache writes 1,25×; partição do input).
- API reference (`service_tier`: omitido ⇒ `auto`; `default` = Standard; a resposta ecoa o tier efetivo quando o parâmetro é enviado).

Standard, USD por 1M tokens:

| model ID | input | cached input | cache write (1,25× input) | output | long context (> 272K input) | vigência |
|---|---|---|---|---|---|---|
| `gpt-5.6-sol` | 4.00 | 0.40 | 5.00 | 20.00 | 8.00 / 0.80 / 30.00 — **não precificado** | preço **promocional** "at least through November 21, 2026" |
| `gpt-5.6-terra` | 2.00 | 0.20 | 2.50 | 12.00 | 4.00 / 0.40 / 18.00 — **não precificado** | sem prazo publicado |

A página não tem data de publicação/atualização nem `effectiveFrom`. Upcharge de 10% para
endpoints regionais não se aplica: o transporte usa `https://api.openai.com/v1/responses`.

## Decisões de modelagem

- **Catálogo versionado no repositório**: `apps/web/lib/work-orchestration/provider-pricing-catalog.json`
  (`catalogRef` `anima/provider-pricing-catalog@2026-09-28`), importado estaticamente pelo loader.
  `ANIMA_PROVIDER_PRICING_CATALOG` continua existindo como **override** de operador (substitui o
  catálogo inteiro). Sem serviço, sem busca remota, sem scheduler, sem scraper.
- **`effectiveFrom = 2026-09-28T00:00:00Z`** (data da consulta): é o único instante em que a fonte
  prova o preço. Consequência deliberada: nenhuma reserva anterior é reprecificada
  (`pricing_missing`).
- **Sol `effectiveUntil = 2026-11-21T00:00:00Z`**: o preço é promocional e só garantido até 21/11;
  depois disso o catálogo não sabe o preço ⇒ `cost_unknown` até um humano adicionar nova versão.
  (Corte no início do dia em UTC: estritamente dentro da garantia em qualquer fuso dos EUA.)
- **Terra sem `effectiveUntil`**: a fonte não publica prazo. Mudança futura exige nova versão e
  fechamento da anterior; janelas sobrepostas ⇒ `pricing_ambiguous` (fail-closed).
- **Cache write = 5.00 / 2.50**: aplicação exata do multiplicador oficial 1,25× à tarifa oficial
  de input (não aproximação); registrado no `sourceRef`.
- **Long context NÃO é precificado** nesta versão: requisição acima de 272.000 tokens de input
  ⇒ `long_context_unpriced`. Limiar lido como 272.000 (se o "K" fosse 1024, o corte fica mais
  conservador, nunca menos).
- **Tier fixado**: o coder agora envia `service_tier: 'default'` (Standard) e o settlement exige
  que **toda** resposta ecoe `default`.

## Mudanças

- `packages/core/src/work-orchestration/host-observed-coder-evidence.ts`: `ProviderReportedUsageV1`
  ganha fatos opcionais `cacheWriteInputTokens`, `maxCallInputTokens`, `serviceTiers`,
  `providerModels` (+ validação).
- `packages/core/src/work-orchestration/provider-api-settlement.ts`: `ProviderPricingEntryV1` ganha
  dimensões declaradas opcionais `cacheWriteInputPerMillion`, `longContextInputThresholdTokens`,
  `serviceTier` (validadas no parse); agregação propaga fatos só quando **toda** observação os
  reportou; decisão exige os fatos que a versão declara; custo =
  `(input − cached − cacheWrite)×in + cached×cachedIn + cacheWrite×cacheWriteIn + out×out`
  (BigInt, inalterado no resto); proveniência inclui `cacheWriteInputPerMillion`, `serviceTier`,
  `longContextInputThresholdTokens`. Novos `cost_unknown`: `usage_pricing_facts_missing`,
  `service_tier_mismatch`, `long_context_unpriced`, `pricing_category_missing`; `model_mismatch`
  também quando o modelo ecoado difere do precificado.
- `apps/web/lib/work-orchestration/gpt-coder.ts`: request com `service_tier: 'default'`;
  `parseUsage` captura `cache_write_tokens`, `service_tier` e `model` da resposta; snapshot emite
  cada fato só se toda chamada o reportou, e `maxCallInputTokens`.
- `apps/web/lib/work-orchestration/coder-evidence.ts`: a evidência persistida agrega os mesmos
  fatos com a mesma regra (todo turno), para que a decisão siga recomputável a partir dela.
- `apps/web/lib/work-orchestration/provider-api-settlement.ts`: loader cai no catálogo do
  repositório quando a env está ausente; resultado indica `source: 'env' | 'repository'`.
- `apps/web/lib/work-orchestration/provider-pricing-catalog.json`: catálogo oficial.
- Sem migration (a RPC aceita campos adicionais na proveniência jsonb) e sem typegen.

## Segurança epistemológica

Resolve (liquida) somente quando, ao mesmo tempo: usage completa (cobertura de B1) · versão
única vigente no instante da reserva para o `provider`/`model` **exatos** · toda resposta ecoou
`service_tier = default` · toda resposta reportou `cache_write_tokens` · maior input de uma
requisição ≤ 272.000 · modelo ecoado (quando reportado) idêntico ao precificado · moeda igual ·
custo ≤ reserva. Qualquer falta ⇒ `cost_unknown` com razão explícita; nunca zero, nunca o teto.

Riscos conhecidos para a primeira prova viva (não verificáveis sem chamada paga): se a OpenAI
**não** ecoar `service_tier` ou `cache_write_tokens` nesse modelo, ou ecoar um snapshot datado em
`model`, a attempt termina `cost_unknown` (fail-closed) — a prova mostrará qual; a correção seria
uma nova unidade com a evidência na mão, nunca um relaxamento especulativo.

## Provas / gates

- Core focal `provider-api-settlement` + `host-observed-coder-evidence`: 61/61. Core completo: 102 suítes / 2.131 testes.
- Web focal `provider-api-settlement` + `gpt-coder` + `coder-evidence`: 93/93 (inclui o catálogo oficial: parse,
  identidade exata, aritmética Sol 0.57 / Terra 0.297, alias não casa, vigência, promo expira,
  versão futura não retroage, sobreposição ⇒ ambiguous, fatos ausentes ⇒ `cost_unknown`,
  evidência B1 anterior ⇒ `cost_unknown`).
- Web vizinhos (`autonomous-backlog-deps*`, `worktree-executor`, `paid-compute*`): 127/127.
- `npm run typecheck` verde. `git diff --check` limpo. Nenhum teste usa rede.

## Efeitos externos

- **Realizados:** leitura de páginas oficiais `developers.openai.com` (GET público).
- **Não realizados:** nenhuma chamada à API OpenAI; nenhuma authority, reservation, attempt ou
  settlement real; nenhuma reserva histórica liquidada; nenhum banco tocado; nenhum push; `main`
  intocada; trabalho do Codex (Durability) não tocado.

## Histórico e atualização futura

- Reservas históricas (`7398bb8d`, `11031d53`, `9d80439d`, `b1239ccb`, …) seguem `cost_unknown`
  por três razões independentes: criadas antes de `effectiveFrom`; evidência sem cobertura/fatos
  de precificação; e o settlement só roda no fim de attempt nova.
- Atualizar preço: consultar a fonte oficial, **adicionar** uma entrada com `pricingVersion`
  nova (`openai/<modelo>@<data>`), `effectiveFrom` = data da consulta/vigência publicada e
  `sourceRef`; fechar a anterior com `effectiveUntil` igual. Nunca editar uma versão existente
  (replay compara `pricingVersion`; editar reescreveria a leitura de settlements antigos).
- Sol após 2026-11-21: sem nova versão ⇒ `cost_unknown` (intencional).

## Fronteira humana e retomada

O settlement `provider_api` fica **pronto para operar** a partir de 2026-09-28 para
`gpt-5.6-sol` e `gpt-5.6-terra` no tier Standard. Falta para ser **operational (provado)**: uma
prova viva paga, em unidade separada, com authority humana explícita, verificando que a resposta
real ecoa `service_tier`, `cache_write_tokens` e `model` e que o evento `usage_priced` é gravado.
Reiniciar o Resident Host no HEAD novo antes dela.
