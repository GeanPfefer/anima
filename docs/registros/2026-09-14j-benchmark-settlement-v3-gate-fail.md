# 2026-09-14j — Benchmark settlement V3: output contido, gate focal falha

Data: 2026-09-14

## Execução autorizada

Após autorização explícita no corpo da mensagem para envio direcionado de contexto do
repositório à OpenAI, foi executada exatamente uma attempt do successor
`7e0a75cf-560b-45a1-8097-5631c631ad05`, usando a authority existente
`fc01585e-b334-415e-a730-a0cd8b39536d`, OpenAI `gpt-5.6-terra`, teto US$1,50 e 30
minutos. Não houve segunda authority, retry ou RunPod.

## Attempt, reservation e usage

- Attempt: `3a367223-c8d0-4e66-bc38-c859ffde81ad`.
- Claim `3de9e9c9` adquirida e liberada por `attempt_finished`.
- Reservation: `7398bb8d-ea20-4bf5-9976-76276fec89d1`, lease
  `provider-api:3a367223-c8d0-4e66-bc38-c859ffde81ad`, US$1,50.
- Provider calls: 18.
- Usage factual terminal: 234.756 input tokens, 89.127 cached input, 7.876 output,
  242.632 total.
- Pricing permaneceu ausente; não houve settlement factual. Reservation aberta,
  `cost_unknown`, committed US$1,50 e remaining zero.

## Contexto efetivamente enviado

Os transcripts host-observed registram READs somente destes cinco arquivos:

- `apps/web/lib/work-orchestration/post-turn-observation.ts`;
- `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts`;
- `apps/web/lib/work-orchestration/post-turn-observation.test.ts`;
- `apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts`;
- `apps/web/lib/work-orchestration/openai-actual-cost-settlement.ts`.

Nenhum `.env`, secret, token, credencial ou path fora do workspace foi observado.

## Tool trajectory V3

- 10 rodadas do protocolo; 17 operações READ servidas.
- Na rodada 10: 7 edits propostos e 7 aplicações, somente em
  `post-turn-observation.ts` e `autonomous-backlog-deps.ts`.
- SEARCH, GLOB, EXEC/TEST e GIT read-only estavam wired no runtime, mas o coder não os
  acionou nesta attempt.
- O runtime retornou as edições e o host criou o checkpoint; não houve a falha antiga
  de `>8 reads`.

## Output e contenção

- Checkpoint/commit: `7143d697b00e2359e61522f7bc2d164ccdb3b7a3`.
- Handoff: `worktree:anima:anima-work/3a367223-c8d0-4e66-bc38-c859ffde81ad`.
- Delta da attempt: 2 arquivos de implementação, +100/-23.
- Diff completo observado desde a base/resume: exatamente os 4 arquivos materiais,
  +233/-14; contenção PASS.

## Primeira barreira e análise semântica mínima

O primeiro gate canônico, `npm.cmd test --workspace=@anima/web --
post-turn-observation.test.ts openai-actual-cost-settlement.test.ts
paid-compute-authorization-store.test.ts`, terminou com exit 1 em 13.835 ms. O item
foi para `failed`, `retryable=false`, antes dos gates seguintes.

A inspeção read-only do diff identifica pelo menos duas violações materiais:

- o adapter envia `costSource: 'provider_reported'`, enquanto o store real aceita
  `NodeCostSourceV1` e a resposta canônica usa `provider_confirmed`;
- o caller vivo passa `pricing: null` literalmente, logo nunca exercita/carrega pricing
  conhecido e não consegue liquidar custo factual nesse caminho.

Assim, B1 FAIL, B2 FAIL e B3 FAIL (o conjunto de provas não fica verde). Por ordem de
parada, o strong host harness independente e o Verifier não foram executados; não há
review e não houve accept/integration/merge/push/deploy.

## Comparação factual

- Harness antigo: `61eb2eb` FAIL; `5fad667` FAIL; `0bea4c8` PASS; a attempt
  `571d29be` morreu pré-edit ao pedir mais de 8 leituras.
- Coding Harness V3: avançou materialmente além do antigo — investigou por 10 rodadas,
  leu 17 vezes, editou e produziu checkpoint contido — mas não completou a tarefa.
  A inteligência não aproveitou TEST/GIT/SEARCH/GLOB e submeteu código que falhou no
  primeiro gate e continuou sem binding de pricing real.

## Estado final

- Item `7e0a75cf`: `failed` v1; única attempt consumida; sem retry autorizado.
- HEAD do WIP principal permanece `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`.
- `origin/main` permanece `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Reservations históricas não foram mutadas; a nova `7398bb8d` fica aberta e
  `cost_unknown`.
- Razão exata da parada: primeiro gate canônico `exitCode=1`.

Próximo passo exige nova decisão humana: o item é terminal e não deve ser reaberto.
Qualquer continuação deve ser um novo successor canônico, com nova autorização de
compute, preservando este output apenas como evidência do benchmark.
