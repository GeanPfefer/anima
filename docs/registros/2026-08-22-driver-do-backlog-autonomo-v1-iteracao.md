# Driver do backlog autônomo V1 — a iteração com efeito sobre a política pura

Data: 2026-08-22
Tipo: desenvolvimento (driver de iteração) + prova por doubles

## Objetivo

Norte ratificado: enquanto houver backlog canônico, seguro e elegível, o Anima não
deve depender de um agente externo (Claude/Codex/Gean) como "scheduler humano". O
recorte anterior (`0842d70`) implementou a POLÍTICA pura de próximo passo
(`planAutonomousBacklogTurn`, core). Faltava o DRIVER: o chamador que consome essa
política, executa UMA volta do Supervisor por iteração, observa o desfecho e decide
se pode continuar — dentro de um limite estrutural, cancelável e sem spin. Este
recorte entrega esse driver (V1), provado por doubles, sem daemon e sem tocar o
caminho de execução real ainda (a fiação viva é o próximo recorte).

- Branch: `dev`. HEAD inicial: `0842d70`. `origin/main`: `99bec54`, intacta.
- Working tree limpa exceto `.worktrees/`.

## Separação POLICY × DRIVER (mantida rígida)

- **POLICY (pura, core, inalterada):** `planAutonomousBacklogTurn` decide
  execute-vs-stop + razão tipada + `pending` por categoria. Não faz IO, não executa.
- **DRIVER (efeito, apps/web, novo):** `runAutonomousBacklogCycle` faz a ITERAÇÃO.
  A cada volta: (1) refotografa o backlog (`readBacklog`, injetado) e consulta a
  política; se ela manda parar, para com a razão dela; (2) senão, executa UMA volta
  do Supervisor (`runTurn`, injetado — envolve `runSupervisorTurn`); (3) classifica
  o desfecho (`classifyTurnForDriver`, pura) e decide continuar ou parar.

Arquivo: `apps/web/lib/work-orchestration/autonomous-backlog-driver.ts`.

## Invariantes preservados (nada afrouxado)

- **Exclusão mútua e SELEÇÃO continuam server-side.** O driver pode escolher tentar
  uma volta e PERDER a corrida do claim — permanece seguro porque `runSupervisorTurn`
  seleciona (`next_autonomous_work`) e reivindica (`acquire_work_claim`) no banco. O
  driver nunca duplica execução nem cria lock caseiro. QUAL item roda é decisão do
  Supervisor (provada em `supervisor.test`); o driver prova a ITERAÇÃO.
- **Item bloqueado/aguardando humano NUNCA congela o backlog** (invariante da política
  pura): há pronto e livre ⇒ roda; senão para com a razão certa e cede ao humano.
- **Desfecho máximo continua `review`.** O driver não aceita, autoriza, integra nem
  aplica resultado. Sem PR/merge/deploy.
- **Resource Governor RESPEITADO, não reimplementado:** `hostPermitsAutonomousWork`
  é um porto injetado (a camada canônica decide; `false` ⇒ não iniciar). O driver
  apenas o honra (precedência máxima, via a própria política pura).

## Anti-spin e paradas tipadas

`BacklogCycleStopReason` = paradas da política (`resource_pressure`,
`awaiting_target`, `work_in_progress`, `awaiting_human_or_recovery`,
`no_eligible_work`) + estruturais do driver (`max_turns_reached`, `cancelled`) +
fim-de-ciclo por desfecho (`turn_not_executable`, `turn_incomplete`,
`budget_exhausted`, `control_applied`).

Princípio anti-spin (em `classifyTurnForDriver`): só CONTINUA quem produziu progresso
(o item saiu da fila para fronteira/terminal) ou perdeu uma corrida cujo estado a
próxima leitura já reflete (auto-limitado). Desfechos que re-selecionariam a MESMA
cabeça FIFO quebrada (`selection_not_executable`/`routing_*`) ou deixam incerteza real
(`execution_interrupted`/`terminal_refused`) PARAM — nunca giram em falso. `maxTurns`
é limite ESTRUTURAL por invocação (anti-loop por bug), não quota diária.

## Resultado tipado (explicável ao humano)

`{ turnsExecuted, itemsTouched, stopReason, pending, lastOutcome, turns[] }`. Permite
dizer objetivamente: "Executei 3 itens e parei porque o próximo exige revisão humana"
(`turnsExecuted=3`, `stopReason=awaiting_human_or_recovery`); "Não executei nada porque
a máquina está sob pressão" (`resource_pressure`); "Backlog elegível esgotado"
(`no_eligible_work`).

## Provas (Jest, por doubles — sem gastar execução real)

`autonomous-backlog-driver.test.ts` **33/33**, cobrindo as 10 regressões exigidas:
1. ready A + ready B → executa A, depois B, para em `no_eligible_work` (2 voltas, 2 tocados);
2. blocked A + ready B → não congela, executa B, para em `awaiting_human_or_recovery` (`pending.blocked=1`);
3. ready A → `review` → para em `awaiting_human_or_recovery` (`pending.awaitingHuman=1`);
4. resource pressure → 0 execuções, `resource_pressure` (`runTurn` 0 chamadas);
5. item `in_progress` → 0 execuções, `work_in_progress`;
6. cabeça não-executável → 1 volta, `turn_not_executable`, SEM spin (política insistia em execute_next);
7. backlog vazio → 0 execuções, `no_eligible_work`;
8. `maxTurns=3` com backlog infinito → 3 voltas, `max_turns_reached`;
9. cancelamento antes (0 voltas, `readBacklog` 0 chamadas) e no meio (para no topo da próxima iteração);
10. corrida de claim perdida → 1 volta, 0 tocados, `runTurn` 1 chamada (nada duplicado), para em `work_in_progress`.
Extras: `budget_exhausted`, `control_applied`, `turn_incomplete`, `itemsTouched` distinto,
`maxTurns<=0`, explicabilidade N-itens, e a tabela pura de `classifyTurnForDriver` (15 desfechos).

- apps/web `tsc --noEmit` PASS; `git diff --check` CLEAN.
- Regressão: `lib/work-orchestration` **37 suítes / 523 testes** verdes (inclui o novo).

## Deliberadamente NÃO feito (próximo recorte)

- **Fiação viva:** um `readBacklog` real (projeção de `AutonomousQueueCandidate[]` a
  partir do banco — hoje NADA no app vivo constrói candidatos; a fila é computada em
  SQL) + uma superfície de invocação explícita (rota) + uma prova viva pequena com
  `maxTurns` pequeno. Adiado a um recorte próprio porque toca o caminho de execução
  real e a projeção precisa casar com a régua do `autonomous_work_queue`.
- **Gate real do Resource Governor:** hoje o governor é advisory (read-only); o porto
  `hostPermitsAutonomousWork` está pronto para receber o gate quando ele existir.
- `requiresAnotherTurn` do Supervisor passar a consumir a decisão de backlog; UI
  "Anima está trabalhando no backlog" + motivo de parada — candidatos posteriores.

## Invariantes de segurança

Sem tabela nova, sem daemon, sem execução na política, sem bypass, sem segredos.
`origin/main` intacta; sem PR/merge/deploy. Supervisor→Executor→Reviewer preservado.

## Próximo ponto de retomada

1. Fiação viva do driver: `readBacklog` do banco + rota de invocação explícita +
   prova viva pequena (`maxTurns` pequeno, coder `qwen3-coder:latest` local).
2. Prova viva de superfície `chat → review` (desbloqueada pelo orçamento V2).
