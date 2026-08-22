# Backlog autônomo — inventário e primeira fronteira (política de laço)

Data: 2026-08-21
Tipo: investigação (inventário) + desenvolvimento (política pura) + prova

## Objetivo

Norte ratificado: enquanto houver backlog canônico, seguro e elegível, o Anima não
deve ficar parado; ele deve descobrir → entender → priorizar → transformar em
work_item → executar → revisar → atualizar estado → próximo, com humano só nas
fronteiras reais. Sem que Claude/Codex sejam o "scheduler humano". Este recorte faz
o INVENTÁRIO e implementa a PRIMEIRA fronteira ausente, sem abrir a frente grande.

- Branch: `dev`. HEAD inicial: `cf8c354`. `origin/main`: `99bec54`, intacta.

## Inventário (o domínio existente é suficiente como substrato)

- **O backlog já é estruturado como `work_items`** (não é só documental): estados
  `proposed` (aguardando aprovação humana), `approved` (fila de execução),
  `in_progress`, `blocked`, `review`, `changes_requested`, terminais. O banco local
  tem itens em todos esses estados. **NÃO é preciso uma tabela `backlog_items`.**
- **Seleção/elegibilidade/prioridade já existem**: `projectAutonomousQueue`
  (`autonomous-queue.ts`, espelho de `autonomous_work_queue`) devolve os itens
  `approved`+elegíveis+alvo-livre, FIFO pela aprovação; `next_autonomous_work`/
  `select_autonomous_work` são a fronteira SQL. `AutonomousQueueCandidate` já é o
  "candidato" tipado.
- **Execução/Verifier/estado**: `runSupervisorTurn` (supervisor-turn) executa uma
  volta até `review`; host-observed evidence + Verifier advisory + eventos
  append-only atualizam o estado. `requiresAnotherTurn` é o sinal de continuação.
- **O backlog DOCUMENTAL** (`002-modo-autonomo-v0-backlog.md`) descreve as
  capacidades V0 (ORQ/AUTO/INT/SUP/INTEL/UX) — hoje concluídas; **não é uma fonte
  de trabalho novo estruturado**. A fonte de trabalho estruturado é `work_items`.

Conclusão do inventário: as peças do laço existem, EXCETO (a) um DRIVER contínuo
(deliberadamente omitido no SUP-05 — "quem decide invocar de novo é quem chama") e
(b) a DECISÃO consolidada de "o que fazer a seguir sobre o backlog inteiro, e por
que parar", hoje implícita na fila + no clique humano.

## Primeira fronteira ausente implementada (política pura, sem daemon)

`packages/core/src/work-orchestration/autonomous-backlog.ts` —
`planAutonomousBacklogTurn(candidates, now, hostPermitsAutonomousWork?)`: decisão
PURA e read-only do próximo passo do laço, construída SOBRE `projectAutonomousQueue`
(sem duplicar régua, sem tabela nova, sem executar, sem daemon):

- `execute_next {entry}`: devolve o item PRONTO e livre de maior prioridade (FIFO).
  **Invariante central provado: um item bloqueado NUNCA congela o backlog** — se há
  um pronto e livre, ele é escolhido, independentemente dos bloqueados.
- `stop {reason, pending}`: explica por que não há ação autônoma agora —
  `resource_pressure` (sinal de host injetado, precedência máxima), `awaiting_target`
  (elegível mas alvo ocupado — transitório), `work_in_progress` (tentativa correndo),
  `awaiting_human_or_recovery` (proposta/revisão/decisão OU bloqueio recuperável por
  orçamento) ou `no_eligible_work` (vazio) — com contagem por categoria (`pending`).

Isto dá a um futuro DRIVER (o chamador, nunca um daemon aqui) exatamente o que ele
precisa para reavaliar, aguardar a fronteira humana/recuperação, ou encerrar — sem
ficar preso e sem iniciar sob pressão do host. A autonomia da execução continua no
Supervisor; parar em `review`/proposta/decisão continua sendo a fronteira humana.

## Provas

- `autonomous-backlog` **10/10** (FIFO; bloqueado-não-congela; precedência de
  host; awaiting_target; work_in_progress; awaiting_human_or_recovery p/ humano e
  p/ bloqueado; no_eligible_work; terminais ignorados; pureza). Core **948/948**;
  typecheck core PASS; `git diff --check` CLEAN.

## Deliberadamente NÃO feito (próxima fronteira, frente grande)

- **O DRIVER contínuo** (invocar supervisor-turns em laço enquanto
  `planAutonomousBacklogTurn` devolver `execute_next`) é a próxima fronteira. É uma
  frente que exige decisão arquitetônica deliberada (natureza "sempre ligado",
  condições de parada, gating pelo Resource Governor, concorrência, retomada) —
  merece ADR/design, não um rush de fim de ciclo. A política pura deste recorte é
  a base que o driver consumirá.
- Fonte de backlog a partir de DOCS em prosa (registros/PRD): fonte não estruturada;
  transformar prosa em candidatos seguros é frágil e o backlog documental V0 está
  concluído. Adiado; o substrato vivo é `work_items`.

## Relação com o recorte de orçamento (mesmo ciclo)

Com o orçamento consciente de custo (`cf8c354`), execução LOCAL não é mais barrada
por quota artificial; `planAutonomousBacklogTurn` + a admissão V2 permitem um laço
local contínuo sem parar por "6/24h". A prova viva de superfície segue desbloqueada
(admitida) e é um re-teste da maquinaria já provada.

## Invariantes

Sem tabela nova, sem daemon, sem execução na política, sem bypass, sem segredos.
`origin/main` intacta; sem PR/merge/deploy. Supervisor→Executor→Reviewer preservado.

## Próximo ponto de retomada

1. DRIVER do laço de backlog (ADR + implementação incremental) consumindo
   `planAutonomousBacklogTurn`, com gating do Resource Governor e parada nas
   fronteiras humanas — a maior alavanca de autonomia.
2. Prova viva de superfície `chat → review` (desbloqueada pelo orçamento V2).
