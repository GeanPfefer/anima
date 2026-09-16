# 2026-09-14d — Attempt 571d29be falha no protocolo antes de editar

## Objetivo e lifecycle

Executar exatamente uma attempt governada da correction `571d29be-2912-4775-80e0-ba8df1e00a5e`
v2 até `review` ou primeira barreira. Approval e classification canônicos passaram; classificação
low/normal/bounded/clear/reversible, política `human-approved-project-planner-v1` inalterada.

Authority exclusiva `70b4129f-5bc8-43fc-9e25-f478b0a353f8`, OpenAI
`provider_api:gpt-5.6-terra`, USD 1,50/30 minutos. Attempt única
`77ca3038-dda5-42ed-b904-3500f7bd5ab6`; claim liberado com `attempt_finished`.

## Barreira

O backend OpenAI foi chamado e retornou uma resposta que o protocolo de edição limitado recusou:
`[ollama_invalid_response_schema] no máximo 8 leituras por rodada.` O código de erro conserva o
nome histórico compartilhado do parser, embora a evidência autoritativa registre backend
`openai:gpt-5.6-terra`, node `openai-api`, placement remote e model `gpt-5.6-terra`.

A resposta continha 4 leituras servidas no transcript, mas violou o limite/schema da rodada antes
de qualquer operação aplicada. `providerCallCount` e usage terminal não foram materializados porque
o backend lançou antes de devolver `editResult`; há evidência de uma chamada (`transcript call:0`),
sem contagem agregada factual além disso.

## Financeiro e output

- Reservation `56245160-845b-495f-9596-1b1b73c83f1d`, lease
  `provider-api:77ca3038-dda5-42ed-b904-3500f7bd5ab6`, USD 1,50.
- Pricing ausente; usage terminal ausente; reservation aberta, não liquidada,
  `settledCost=null`, `costSource=null`; `cost_unknown`. Nenhum void/settlement/reuse/transfer.
- Branch da attempt existe apenas no checkpoint herdado `5fad667`; não há diff contra `5fad667`
  e não existe output commit novo.
- Nenhum gate rodou; não houve result event nem Verifier. O harness host-side não é aplicável sem
  output novo. B1/B2/B3 não foram avaliados por esta attempt.

## Segurança e parada

Item final `failed` v2. Nenhuma segunda attempt/authority e nenhum RunPod/Ollama real. Reservations
anteriores, inclusive `6bc73048`, preservadas. Branch `dev`/HEAD
`b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`; `origin/main`
`99bec54e3ab42bfe882a8686cd1385d8058b916e`; WIP auxiliar preservado. Parada exata: falha
pré-edit do protocolo do coder, retryable tecnicamente, mas sem retry pela autorização humana de
uma única attempt.
