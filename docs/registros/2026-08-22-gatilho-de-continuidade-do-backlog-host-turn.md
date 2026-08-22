# Gatilho de continuidade do backlog — host-turn (continuação entre ciclos)

Data: 2026-08-22
Tipo: desenvolvimento (continuação) + prova por doubles + refatoração segura

## Objetivo

Reduzir mais uma camada de scheduler humano. O driver (`7af0735`/`e339136`) já
CONTINUA dentro de uma invocação bounded (`runAutonomousBacklogCycle` re-planeja
entre voltas até `maxTurns`). Faltava a continuação ENTRE ciclos: ao fim de um ciclo,
decidir de forma TIPADA se há mais trabalho e, havendo (e sendo permitido), rodar o
próximo ciclo sozinho — com um SEGUNDO limite estrutural e parada tipada. Sem daemon,
sem always-on, sem while(true) ingovernável.

- Branch: `dev`. HEAD inicial: `f734df3`. `origin/main`: `99bec54`, intacta.

## Investigação (respostas às perguntas obrigatórias)

- **`requiresAnotherTurn`** (SupervisorTurnResult) é PRODUZIDO por `runSupervisorTurn`
  e **nenhum código de produção o consome** — só testes o inspecionam. Era o sinal da
  era do TURNO ÚNICO ("chame o supervisor de novo"), quando o chamador era humano por
  volta. O DRIVER o superou: classifica por `outcome` (mais rico que o booleano) e É o
  laço que reinvocaria. Portanto NÃO é a abstração de continuação de CICLO — é o análogo
  por-volta, hoje interno/superado. A continuação de ciclo é um conceito NOVO, PROMOVIDO
  um nível acima.
- **`runAutonomousBacklogCycle(maxTurns>1)` já resolve a continuidade DENTRO de uma
  invocação** (re-planeja e roda o próximo pronto; um item em `review` nunca congela a
  fila — invariante já provado em `planAutonomousBacklogTurn`/autonomous-backlog.test).
  O que faltava era: (a) distinguir `max_turns_reached` (bound atingido, PODE haver mais)
  de paradas definitivas/à-espera; (b) uma camada de host que rode o próximo ciclo.
- **Autoridade para iniciar a próxima volta**: continua sendo o host (`hostPermitsAutonomousWork`,
  hoje advisory→sempre true) + as guardas atômicas do banco (claim/exclusão) + os bounds
  estruturais. O gatilho NÃO interpreta "local ilimitado" como "host ilimitado".

## Mudanças

1. **`autonomous-backlog-deps.ts`** (extração DRY): `buildProjectBacklogCycleDeps(client,
   ownerInstanceId)` = a maquinaria real de uma volta (executor de worktree por contrato +
   `runSupervisorTurn` + observação host-side), COMPARTILHADA entre `backlog-cycle` e
   `backlog-host-turn`. A rota `backlog-cycle` foi refatorada para consumi-la (6/6 do seu
   teste intactas, comportamento idêntico).
2. **`autonomous-backlog-host-turn.ts`**:
   - `classifyCycleContinuation(stopReason)` (PURA): `max_turns_reached→continue`;
     `no_eligible_work|turn_not_executable|control_applied|cancelled→stop`;
     `awaiting_*|work_in_progress|resource_pressure|budget_exhausted|turn_incomplete→wait`.
   - `runAutonomousBacklogHostTurn(deps)`: roda até `maxCycles` ciclos bounded; continua
     só enquanto um ciclo termina em `max_turns_reached`; para com veredito tipado quando
     um ciclo termina definitivo/à-espera, no cancelamento, ou no bound de host. No bound
     de host faz um `peekMoreWork` READ-ONLY para dizer se sobrou trabalho por fazer.
   - Resultado tipado `{cyclesExecuted, turnsExecuted, itemsTouched, stopReason,
     continuation, moreWorkAvailable, lastOutcome, cycles[]}`.
3. **Rota `POST /api/work-orchestration/backlog-host-turn`**: bounds `{maxTurnsPerCycle
   (default 1, teto 10), maxCycles (default 2, teto 10)}` — produto ≤ 100 execuções por
   invocação. Cada ciclo = o driver já provado; peek = `planAutonomousBacklogTurn` sobre o
   backlog fresco. Desacoplada do transporte HTTP.

## Dois níveis de bound (defesa em profundidade)

`maxTurns` por ciclo (driver) × `maxCycles` por host-turn. Mesmo um bug de política não
gera loop infinito: o produto é o teto absoluto. `max_turns_reached`/`max_cycles_reached`
≠ erro e ≠ "backlog concluído" — significam "lote seguro terminado; pode haver mais"
(`continuation=continue`, `moreWorkAvailable=true`).

## Provas (Jest, por doubles)

- `autonomous-backlog-host-turn.test` **26/26** — as 10 regressões exigidas:
  (1) bound+mais→continue; (2) próximo ciclo drena→no_eligible_work/stop; (3) A→review
  então B executa (não congela); (4) só fronteira humana→wait; (5) pressão de recurso
  entre ciclos→sem nova execução; (6) cancel entre ciclos→sem próximo; (7) maxCycles+mais
  →max_cycles_reached+continue (não finge conclusão); (8) cabeça quebrada→stop sem retry
  infinito (+ turn_incomplete→wait); (9) corrida perdida→wait tipado sem spin; (10) fila
  vazia→0 voltas. Extras: itemsTouched distinto entre ciclos, maxCycles≤0, drenou-no-bound,
  cancel-antes-do-1º, tabela pura de `classifyCycleContinuation` (11 razões).
- `backlog-host-turn/route.test` **6/6** (401, 400 bounds inválidos, portos passados,
  tetos, runCycle com maxTurnsPerCycle, peek consulta a política).
- `backlog-cycle/route.test` **6/6** (refatoração comportamento-idêntico).
- apps/web `tsc` PASS; `git diff --check` CLEAN; `lib+api/work-orchestration` **47 suítes / 602** verdes.

## Invariantes de segurança

SELEÇÃO/EXCLUSÃO server-side (o host pode perder corrida sem duplicar — o banco decide).
Cancelamento atravessa host→ciclo→supervisor→executor. Sem daemon/always-on. Desfecho
máximo `review`; nada aceito/integrado/aplicado. `origin/main` intacta; sem PR/merge/deploy.

## Deliberadamente NÃO feito (fronteira)

- **Runner always-on/serviço persistente** que reinvoque o host-turn automaticamente:
  é a próxima fronteira e tem CONSEQUÊNCIA ARQUITETÔNICA (natureza sempre-ligada,
  disparo pós-terminal, gate real do Governor) — merece decisão humana/ADR, não um rush.
  O host-turn é a peça bounded que esse runner futuro chamará.
- Gate real do Resource Governor no porto `hostPermitsAutonomousWork` (hoje advisory).
- UI "Anima trabalhando no backlog" + razão tipada de parada.

## Próximo ponto de retomada

1. Prova viva do host-turn (`maxTurnsPerCycle=1, maxCycles=2`, 2 itens controlados):
   host → ciclo 1 (item A → review) → replan/continue → ciclo 2 (item B → review OU stop
   tipado) → resultado bounded. Coder `qwen3-coder:latest`.
2. Só então avaliar o runner always-on (fronteira arquitetônica).
