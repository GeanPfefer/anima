# 2026-09-09 — Diagnosticabilidade de `turn_not_executable` no self-dev

- **Tipo:** desenvolvimento (patch + testes; sem prova viva — devolvido ao humano).
- **Branch:** `dev`. **HEAD inicial = HEAD final = `d783a5d`** (nada commitado; WIP preservado).
- **Objetivo:** o Resident Host encontra o Work Item `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`
  (Cloud GPU Test #2, autoridade RunPod) mas toda volta encerra em
  `stopReason = turn_not_executable`, `itemsTouched = 0`, sem claim/attempt/`execution_started`
  — **sem explicação da barreira**. Descobrir a origem exata e tornar a parada diagnosticável.

## Causa raiz (comprovada no código, não hipótese)

`turn_not_executable` é a classificação **anti-spin** de `classifyTurnForDriver`
([autonomous-backlog-driver.ts](../../apps/web/lib/work-orchestration/autonomous-backlog-driver.ts))
para os outcomes de Supervisor `selection_not_executable | routing_unavailable | routing_refused`.
A razão canônica **já existe** e é estruturada: `SupervisorTurnResult.refusal = { code, message }`
([supervisor.ts:94](../../apps/web/lib/work-orchestration/supervisor.ts)). Ela é emitida por cada
`notExecutable(entry, code, message)` em
[autonomous-backlog-deps.ts](../../apps/web/lib/work-orchestration/autonomous-backlog-deps.ts)
com códigos do domínio: `work_item_unavailable`, `coder_placement_deferred`, `resident_turn_failed`,
o `reasonCode` do Compute Router, o `code` da seleção de executor e — no caminho de provisão
on-demand (RunPod) — `paid_compute_authorization_required | paid_compute_concurrency_limit |
paid_compute_observability_unavailable | coder_node_unavailable`.

**A barreira NÃO era a decisão em si — era a PERDA da razão.** O `refusal.code` era descartado em
4 camadas: `BacklogCycleTurn` (só `{workItemId, outcome}`) → `BacklogCycleResult` (`stopReason`
grosso) → `BacklogHostTurnResult` → `HostTurnOutcome`/`mapHostTurnResult` (só counts + `workItemIds`).
O terminal só via `turn_not_executable`, obrigando a **inferir** a causa.

Para `8a2515d8`, a última prova viva conhecida (ver
[2026-09-08](2026-09-08-runpod-autoprovisionamento-barreira-pre-provider.md) e memória) parou na
provisão on-demand com `coder_node_unavailable` (key RunPod **read-only**: `POST /pods` = 403).
Essa é uma **barreira REAL, fail-closed correta** — o item passa a seleção pura
(`planAutonomousBacklogTurn` → `execute_next`) e falha na resolução de compute, **antes** de
`runSupervisorTurn` (por isso `itemsTouched = 0`, sem claim/attempt). Não há inconsistência entre
seleção autônoma e elegibilidade de execução a "afrouxar"; caso (A) do critério: item realmente
bloqueado → tornar o motivo explícito.

## Mudanças (observabilidade; NENHUM gate afrouxado)

Propagação da `refusal` canônica pelas 4 camadas (campos **opcionais**, presentes só na parada
opaca — sem drift, sem categoria inventada, mapeamento inalterado nos demais casos):

- `autonomous-backlog-driver.ts`: novo tipo `TurnRefusal`; `BacklogCycleTurn.refusal`;
  `BacklogCycleResult.notExecutableReason` (a `refusal` da volta que causou `turn_not_executable`).
- `autonomous-backlog-host-turn.ts`: `BacklogHostTurnResult.notExecutableReason`, promovida do
  ciclo que parou.
- `in-process-host-turn.ts` (`mapHostTurnResult`): sobe `notExecutableReason` ao `HostTurnOutcome`
  (spread condicional).
- `resident-host.ts`: `HostTurnOutcome.notExecutableReason?` (telemetria; não altera decisão).
- `scripts/resident-host.ts`: eleva `notExecutable` ao topo da linha JSONL (paridade com `workItems`).

## Testes / gates

- `autonomous-backlog-driver.test.ts` + `autonomous-backlog-host-turn.test.ts` (config normal
  ts-jest): **63/63 verde**.
- Sob config transpile-only (contorno do WIP de tipos, ver abaixo), o conjunto afetado
  (driver, host-turn, in-process, resident-host, ports, backlog-host-turn-run, rotas
  backlog-cycle/backlog-host-turn): **142/142 verde**, incluindo os invariantes já existentes de
  dedupe ("duas requests ⇒ um único requestedWorkItemId") e não-reexecução ("com `execution_started`
  após ambos os seqs, nenhuma reentregue").
- **Typecheck `apps/web`: 1 erro, pré-existente e alheio** (ver abaixo). Meus 5 arquivos: 0 erros.

## Bug pré-existente encontrado (NÃO corrigido — WIP alheio)

`apps/web` **não passa `tsc --noEmit`** no working tree recebido: WIP em
`packages/types/src/database.ts` estreitou `p_attempt_id` de `string | null` → `string` nos RPCs
`record_compute_routing_decision` e `apply_work_control_at_checkpoint`, mas o chamador **commitado**
[autonomous-backlog-deps.ts:198](../../apps/web/lib/work-orchestration/autonomous-backlog-deps.ts)
(idêntico ao HEAD) ainda passa `null` → `TS2322`. Bloqueia **`tsc --noEmit`** e a **compilação ts-jest**
de qualquer suite cujo grafo alcance `deps.ts` — **mas NÃO a prova viva**: `npm run local-host` roda
via `node --experimental-transform-types` (type-stripping, sem type-check), então o runtime in-process
executa apesar do erro de tipo. Decisão humana (limpeza, não bloqueia a prova): regenerar tipos
consistentes com a migration, ou reverter o estreitamento. Não tocado para preservar WIP.

## Bug separado registrado (NÃO corrigido, por instrução)

`tools/dev-supervised.mjs` → `spawn EINVAL` no Windows/Node 24. Fora de escopo desta sessão.

## Efeitos externos

**Nenhum.** Sem commit, push, PR, migration, cloud, gasto ou credencial. **Nenhum Pod RunPod criado.**
Autoridade paga `fd534be7` intacta.

## Fronteira humana / próximo ponto de retomada

Patch pronto para **prova viva supervisionada** pelo Gean com o mesmo `npm run local-host`. Agora a
linha `state` do log (e `outcome.notExecutableReason`) imprimirá o **código canônico** da barreira
(esperado: `coder_node_unavailable` enquanto a key RunPod for read-only). Se aparecer um código
inesperado (ex.: `work_item_unavailable`, `coder_placement_deferred`, `resident_turn_failed`, ou um
`reasonCode` do Router), aí sim há inconsistência a investigar. A prova viva **não** depende do WIP de
tipos `p_attempt_id` (runtime é transpile-only); esse fix é limpeza separada para reverdejar `tsc`/jest.
