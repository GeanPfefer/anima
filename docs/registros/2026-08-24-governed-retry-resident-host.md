# Governed Retry + Resident Host Execution Authority V0

- **Data/tipo:** 2026-08-24 — desenvolvimento e prova local.
- **Objetivo:** eliminar a contradição `failed/retryable` e retirar a autoridade de
  worktree do processo web, sem criar a attempt 2 real.
- **Branch / HEAD inicial:** `dev` / `e29014ac18c26d2d7a9cbb0957fc9be1b33c8a6a`.
- **Bug corrigido:** a rota explícita `supervisor-turn` executava o worktree no
  `next dev`; uma falha retryable terminava sem reentrada governada.
- **Mudanças:** projeção `RETRY_READY`; RPCs idempotentes de retry/sinal; card com
  budget 1/2; rota web explícita fail-closed; execução mantida na composição
  in-process do Resident Host. Ver ADR-003 e Plano 002.
- **Provas:** política pura (13 casos); pgTAP (10); UI/rota/Resident Host; migration
  local; leitura real do Item 1 = `RETRY_READY`, 1/2, zero retries persistidos.
  Worktree descartável criada no HEAD inicial, arquivo escrito/inspecionado e
  cleanup completo; branch temporária removida; `origin/main` intacta.
- **Invariantes:** attempt `937d402a-8d20-4750-b06b-9e0792dfd18f` e falha histórica
  preservadas; Item 1 continua `failed`; Itens 2/3 `approved`; zero claim/attempt
  novo, coder, provider, cloud, compute pago, autorização financeira, integração,
  PR, merge ou deploy.
- **Fronteira humana:** atualizar `/chat` e clicar uma vez em “Tentar novamente
  autonomamente” no Item 1. Só então o Resident Host poderá criar a attempt 2.
- **Próximo ponto:** prova viva attempt 2 até `review` ou falha terminal; não executar
  Itens 2/3.

## Reconciliação Codex → Claude (2026-08-24, mesmo recorte)

- **Motivo:** o Codex atingiu o limite semanal ao fechar; Claude retomou pelo estado
  real do repositório/banco, sem assumir o resumo.
- **Reconciliação forense:** `dev`/HEAD `e29014a` = `origin/dev`; `origin/main` `99bec54`
  intacta; todo o diff local do Codex confirmado APLICADO (migration `20260825000000`
  aplicada e as 3 RPCs + a privada existem; `execution-requests`/`retries` só persistem
  sinal; `supervisor-turn` explícito recusa `resident_host_required`). A amarração final
  por `workItemId` (a ação antes recusada pelo auto-review) está PRESENTE no working tree:
  derivação do sinal pendente em `in-process-host-turn.ts` + filtro do backlog em
  `runProjectBacklogHostTurn`.
- **Lacuna fechada por Claude:** faltava regressão direta do filtro anti-fallback →
  novo `backlog-host-turn-run.test.ts` (3 casos: sinal A com A/B elegíveis entrega só A;
  pedido inelegível/inexistente esvazia o backlog sem cair em outro item; sem ato
  explícito mantém o backlog íntegro).
- **Provas re-rodadas verdes:** typecheck 5 workspaces; pgTAP `governed_retry` 10/10
  (ROLLBACK); core 1159/1159; web alvo 67/67 + novo 3/3; build web com next dev parado;
  `git diff --check` limpo. Item 1 real re-lido: `RETRY_READY`, 1/2, 0 retry, 0 claim,
  falha `execution_failed` retryable `937d402a…` preservada. Itens 2/3 `approved` com
  dependência não satisfeita. Autorização financeira = 0. Egress externo = 0.
- **Prova controlada de worktree (independente):** create/inspect/cleanup em HEAD
  `e29014a` fora do Item 1; contagem de worktrees inalterada, sem residual, `origin/main`
  intacta.
- **Invariante mantido:** nenhuma attempt 2 real criada; `request_work_retry` só exercitado
  sob ROLLBACK em fixture. Aguarda o clique humano.
