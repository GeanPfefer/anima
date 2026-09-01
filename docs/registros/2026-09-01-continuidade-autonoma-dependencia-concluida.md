# 2026-09-01 — Continuidade autônoma: dependência concluída invisível à projeção do driver

**Tipo:** desenvolvimento + auditoria de continuidade. **Branch:** `dev`.
**HEAD inicial:** `ac4f647`. **HEAD final funcional:** `07a1cbc`; o commit posterior contém este
registro. `origin/main` observado em `99bec54` e **não alterado**. `origin/dev` avançado por
fast-forward.

Foco da sessão: avançar a propriedade "o Anima continua trabalhando sozinho no próprio backlog"
(não compute pago). Fontes: [`AGENTS.md`](../../AGENTS.md), orquestração de trabalho, plano
[002](../planos/002-modo-autonomo-v0.md), código do backlog autônomo/supervisor/resident host.

## Gap comprovado

A cadeia de continuação já existia em três níveis (`runAutonomousBacklogCycle` →
`runAutonomousBacklogHostTurn` → `runResidentHost`, com veredito tipado continue/wait/stop e
materialização em `no_eligible_work`). O que a travava era uma **divergência entre a projeção TS do
driver e a autoridade SQL**, exatamente na transição que a prova preferida pede
("A completa → B fica elegível → segue"):

- `projectAutonomousQueue` satisfaz `depends_on_work_item_ids` só quando o dependência está
  `completed` (`itemsById.get(dep)?.state === 'completed'`). Correto DADO input completo.
- Mas a fotografia de produção `readAutonomousBacklogCandidates` lia apenas estados NÃO-terminais.
  Como `completed` é TERMINAL, a dependência concluída nunca entrava no candidate set →
  `undefined !== 'completed'` = true → o dependente ficava ETERNAMENTE inelegível NA PROJEÇÃO.
- Resultado: server-side (`autonomous_work_queue`/`autonomous_work_dependencies_satisfied`, que
  consulta a tabela inteira) B ficava elegível ao A completar, mas o driver — que decide por
  `planAutonomousBacklogTurn` sobre a projeção — via "sem trabalho" e parava (`no_eligible_work` /
  host idle), sem NUNCA tentar B. O loop autônomo travava na dependência concluída.

Duas superfícies do MESMO gap:
1. **Caminho geral** (resident host sem ato explícito): a fotografia excluía a dependência completed.
2. **Caminho escopado** (`runProjectBacklogHostTurn` com `requestedWorkItemId` — sinal de execução,
   retry governado ou burst forçado): a amarração `candidate.item.id === requestedWorkItemId`
   derrubava a dependência completed, fazendo o PRÓPRIO item pedido sair da fila.

UI (`projectAutonomousReadiness`) e retry (`current_work_retry_readiness`) já eram SQL-backed e
CORRETOS — a divergência era exclusiva da projeção do loop do driver. Antes do fix, a UI mostrava B
elegível enquanto o resident host se recusava a executá-lo: incoerência observável.

## Mudanças (commits)

- `6ee7d6b` **Enxergue dependências concluídas na projeção do backlog autônomo** —
  `readAutonomousBacklogCandidates` passa a buscar as dependências `completed` referenciadas por
  itens não-terminais e incluí-las como candidatos INERTES (sem aprovação/claim/classificação: nunca
  entram na fila nem executam; eligibility exclui `completed`). Só `completed` é buscado →
  failed/cancelled/inexistente permanece ausente (fail-closed, coerente com o SQL). `pending` não
  muda (nenhuma categoria conta `completed`). Core inalterado; contrato de `projectAutonomousQueue`
  atualizado.
- `07a1cbc` **Preserve dependências concluídas na amarração escopada do host-turn** — a amarração ao
  item pedido passa a manter também os candidatos `completed` (inertes), para a projeção resolver
  `depends_on` do item pedido. Sem ato explícito, o backlog segue íntegro.

## Bugs corrigidos

- Divergência projeção-TS × autoridade-SQL na satisfação de dependência concluída (caminho geral).
- A mesma divergência reintroduzida pela amarração escopada (execução explícita/retry/burst).

## Fronteiras humanas confirmadas (não são bugs)

- **Aprovação** de proposta e **aceitação** de resultado (`review` → `completed`) permanecem atos
  humanos: o máximo autônomo é `review`. A dependência de B em A só satisfaz quando um humano aceita A.
- **Governed retry** (`request_work_retry`) é reentrada HUMANA por design (o retry intra-attempt do
  harness é autônomo). Recuperação de falha técnica cross-attempt não é auto-disparada — decisão
  humana deliberada. Não alterado.
- **Recovery successor** (decomposição/correção) vai a `proposed` (aprovação humana) e reduz escopo
  (subconjunto estrito) — não satisfaz automaticamente a dependência de um terceiro no original falho.

## Provas / gates

- Focados: `autonomous-backlog-read` (reader inclui/《não inclui》dependência), `autonomous-queue`
  (87 core), `backlog-host-turn-run` (amarração preserva completed), suíte de autonomia web 166.
- Completos: core `1349/1349` (comentário; sem mudança de contagem); web `1176/1176` (+3 testes).
- typecheck **5 workspaces** PASS; **Next build** PASS; `git diff --check` limpo; sem SQL (pgTAP
  não impactado). Flake preexistente conhecido inalterado.

## Efeitos externos

`push` para `origin/dev` (fast-forward, autorizado após gates verdes). `origin/main` intacta.
Nenhum PR/merge/deploy. ZERO compute pago/RunPod/gasto. Locais preservados fora dos commits:
`.worktrees/`, `watch4-sensors.txt`, `.claude/settings.local.json`.

## Próximo ponto de retomada

Continuidade autônoma através de dependência concluída está fechada (as duas superfícies). Candidatos
a próximos recortes (não bloqueadores; sem evidência concreta de bug ainda): auditar outras eventuais
divergências projeção-TS × SQL (`is_autonomously_eligible`, `autonomous_intelligence_eligibility`);
e observabilidade da UI durante a continuação multi-item. Governed retry autônomo e satisfação de
dependência por lineage de sucessor são DECISÕES humanas/de design em aberto, não bugs.
