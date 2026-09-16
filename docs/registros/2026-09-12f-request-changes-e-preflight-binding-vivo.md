# 2026-09-12f — request_changes e preflight do binding vivo OpenAI

## Tipo e objetivo

Sessão de orquestração governada. Codex assumiu como executor principal único para preservar o
resultado verificado de `fe99e446` v3, persistir a decisão humana `request_changes`, materializar a
correction canônica e parar antes de qualquer provider pago com um preflight terminal mínimo.

## Estado Git preservado

- Branch: `dev`.
- HEAD inicial/final: `d783a5dc495da692eb7097f7c7252bb5ba074e51`.
- `origin/main`: `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- Commit revisável preservado: `b6201d8daaa50036e91b39c98e1ecf46d0e45130` na branch
  `anima-work/77d751c2-f642-4c0d-89da-7ca47feee3b1`.
- WIP amplo preservado; nenhum stash/reset/merge/push.

## Efeitos canônicos realizados

1. Reconciliado `fe99e446-9f14-45d0-97f5-764e9c2af8a9` em `review` v3, attempt
   `77d751c2-f642-4c0d-89da-7ca47feee3b1`, result event `2896b543`, Verifier `verified`
   (13 checks, 0 violations, 0 gaps).
2. Persistido `request_changes` pelo serviço/RPC canônico, preservando resultado, Verifier,
   checkpoint, branch e event log append-only. O original ficou `changes_requested`.
3. Materializada a correction por `correctReviewedWorkItem`: successor
   `3b0b3c57-a1d0-4bbe-a719-829b680ca6d1`, lineage
   `43638773-d48c-4959-acf1-5eab36e163f0`, recovery sequence 1, idempotency key
   `76481276-4304-5c36-ac15-8d35890dc0ac`.
4. A proposta derivada ampla foi reduzida, no mesmo successor, até v3 `proposed`; nenhuma cadeia
   paralela foi criada.

## Proposta terminal v3

- Resume checkpoint: `b6201d8daaa50036e91b39c98e1ecf46d0e45130`.
- Backend/modelo: `openai` / `gpt-5.6-terra`.
- Limites herdados: máximo 3 attempts, 30 minutos por attempt; a próxima execução deve autorizar
  apenas uma nova reserva/attempt paga.
- Escopo incluído:
  - `apps/web/lib/work-orchestration/post-turn-observation.ts`;
  - `apps/web/lib/work-orchestration/post-turn-observation.test.ts`;
  - `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts`.
- A primitive e seu teste em `openai-actual-cost-settlement.*` permanecem excluídos/preservados.
- Gate focal exige atravessar `buildProjectBacklogCycleDeps(...).runTurn` até
  `persistPostTurnHostObservations`; chamar diretamente apenas a primitive não satisfaz o aceite.
- Critérios cobrem correlação reservation/attempt, usage, pricing/cohort, callback real até
  `settlePaidComputeBudgetReservation`, fail-closed, replay idempotente e contenção de escopo.

## Preflight financeiro

- Authority anterior `20f546b1-ccd1-4499-b6a0-19f7eb051fe3`: US$1,50 integralmente reservado,
  remaining US$0,00.
- Reservation `3435b02c-545b-416c-aadd-bd069c178ff6`: `PENDING`, US$1,50, correlacionada à
  attempt anterior; `cost_unknown`, não liquidada.
- Próxima authority recomendada, somente após aprovação humana da correction v3: provider
  `openai`, node `openai-api`, resource class `provider_api:gpt-5.6-terra`, work item
  `3b0b3c57-a1d0-4bbe-a719-829b680ca6d1`, `maxCost USD 1.50`, `maxDurationMs 5_400_000`, validade
  de 7 dias, uma única concessão. O protocolo compartilhado permite até 8 chamadas provider na
  única edição; OpenAI tem retry interno de gate igual a zero. O budget do item permanece 3
  attempts, mas este preflight não autoriza múltiplas attempts pagas.

## Provas e invariantes

- `npm.cmd run typecheck --workspace @anima/web`: PASS após corrigir dois campos apenas de log no
  script operacional `selfdev-3b0b3c57-revise-live-binding.ts`.
- Nenhum provider chamado, nenhum novo gasto, nenhuma authority concedida, nenhuma reserva
  liquidada, nenhuma attempt/claim criada, nenhum RunPod/Ollama acionado.
- Três reservas históricas e a reservation atual permaneceram intocadas; teto nunca foi tratado
  como custo real.

## Próximo ponto exato

Fronteira humana: revisar e aprovar (ou revisar novamente) `3b0b3c57` v3. Só depois conceder a
authority exata acima e executar uma única volta até `review` ou primeira barreira real.
