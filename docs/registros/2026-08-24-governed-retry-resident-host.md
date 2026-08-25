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

## Correção da divergência backend×UI no reencontro do chat (2026-08-24, `cd85c21`)

- **Sintoma (inspeção humana autenticada em /chat):** o cartão INLINE do Item 1
  mostrava "nenhuma nova tentativa está autorizável no estado atual" e escondia
  "Tentar novamente autonomamente", enquanto a RPC autoritativa continuava
  `RETRY_READY`.
- **Diagnóstico READ-ONLY:** o estado real seguia intacto (Item 1 `failed` v2,
  RETRY_READY, attemptsUsed 1/2, `execution_started`=1, `retry_authorization`=0,
  `autonomous_execution_request`=0, `open_claim`=0; a única attempt é
  `937d402a…`; a "execução iniciada 00:09 UTC" da UI É essa attempt original, não
  uma segunda). Itens 2/3 `approved` bloqueados.
- **Causa (camada de projeção, não backend):** o chat hidrata os cartões da
  conversa por `GET items/by-source/[sourceMessageId]` (ChatClient linha ~113),
  e esse endpoint NÃO projetava `retryReadiness` — diferente de `items` e
  `items/[id]`. Logo `presentation.retryReadiness` chegava `undefined` ao card.
- **Correção (sem afrouxar gate):** `by-source` passa a anexar a MESMA
  `readWorkRetryReadiness` por apresentação. O card passa a exibir a razão
  ESTRUTURADA de bloqueio (espelho da RPC) quando há motivo conhecido, em vez da
  mensagem genérica (que fica só para readiness ausente/desconhecida).
- **Provas:** regressão de rota `by-source` (readiness acompanha o reencontro);
  card mostra razão estruturada; WorkProposalCard + by-source 50/50; typecheck 5
  workspaces; build web; `git diff --check` limpo. Nenhuma attempt/claim/retry
  real. Aguarda nova inspeção visual humana em http://localhost:3000/chat.

## Prova viva da attempt 2 real (2026-08-25, dirigida pelo Resident Host)

- **Ato humano:** Gean confirmou a superfície de retry no /chat e clicou UMA vez em
  "Tentar novamente autonomamente". A UI só persistiu `request_work_retry`
  (`work_approved`/authority=retry_authorization, seq 34713, 01:28:17) → Item 1 → `approved`.
- **Driver:** Resident Host (`npm run local-host`, in_process, identidade Bearer do
  usuário) iniciado por Gean. 1º start SEM credenciais parou fail-closed em
  `waiting_human_or_recovery` (identity_unavailable) — invariante de identidade honrado;
  reiniciado com credenciais. Realtime deu `CHANNEL_ERROR` → **poll fallback** acordou o
  host ~11s após o clique. `materializeWhenIdle` desligado (sem doc), Governor por ciclo.
- **Attempt 2 (`e2e790bb-8ea4-49c8-a9c1-d0f1c8658d3c`):** routing → claim → `execution_started`
  (seq 34718, 01:28:28) → **worktree isolada criada** (`worktree:anima:anima-work/e2e790bb`,
  contagem 37→38). **PASSOU do `worktree-create`** — exatamente o checkpoint que matou a
  attempt 1 no processo `next dev`. A correção de autoridade (execução saiu do web para o
  Resident Host) fica PROVADA ao vivo.
- **Desfecho terminal:** `execution_failed` (seq 34719, 01:30:08), reason
  **`ollama_read_round_limit`** — o qwen3-coder esgotou as 3 rodadas de leitura sem propor
  edições (~98s, `durationMs 98276`). Barreira de CAPACIDADE do modelo (editor fraco),
  cortada por guard bounded (falha limpa, sem hang) — não é o `worktree-create-failed` da
  attempt 1 nem o `ollama_timeout` de RAM. Evidência host-observed persistida
  (`host_observed_coder_evidence_recorded`, outcome failed). Claim liberado, **worktree
  limpa (37, sem residual)**.
- **Estado final:** Item 1 `failed`; retry readiness `BLOCKED`/`attempt_budget_exhausted`
  (2/2, remaining 0) → **terceira attempt impossível**. Nenhum gate rodou, nenhum Verifier
  (o coder falhou antes de qualquer edição). O card mostra a razão estruturada e esconde o botão.
- **Invariantes:** Itens 2/3 `approved`/bloqueados; 27 work_items (zero materialização);
  autorização financeira = 0; compute pago = 0; egress externo = 0; `origin/main` `99bec54`
  intacta; nenhuma integração/completion do Item 1. Após a falha o Resident Host ficou em
  `waiting_resource` (Governor adiando por pressão de memória), `itemsTouched=0` — não tocou
  mais nada.
- **Conclusão:** `GOVERNED_RETRY_RESIDENT_HOST_V0` provado fim-a-fim até o coder; a barreira
  restante coder→`review` é CAPACIDADE do qwen3-coder como editor (ortogonal ao retry
  governado e à autoridade de execução, ambos verdes). Próximo: avaliar melhor editor local
  ou hardware.
