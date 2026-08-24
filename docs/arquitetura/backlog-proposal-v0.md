# Backlog Proposal V0

## Fronteiras

`CONVERSA → DECISÃO RATIFICADA → BACKLOG PROPOSAL → CONFIRMAÇÃO HUMANA → WORK_ITEMS PROPOSED → APROVAÇÃO/EXECUÇÃO EXISTENTES`.

As separações são normativas: decisão não é backlog; backlog proposal não é
work item; materialização não é approval; approval não é execution. O planner
formula slices, mas não confirma, materializa, aprova ou executa.

## Substrate e lifecycle

O recorte reutiliza `project_decision_proposals/events`, o envelope validado de
`WorkProposal`, `work_items/work_events` e o padrão de provenance por IDs no
`intent`. Não cria outro backlog nem outro planner.

`project_backlog_proposals` guarda objetivo, 1–12 slices, rationale, exclusões,
incertezas, decisão/versão de origem, versão própria, supersessão e provenance do
sistema. `project_backlog_events` registra `proposal_created`,
`changes_requested`, `materialization_confirmed` e `materialized`. A projeção
RLS deriva `awaiting_confirmation | changes_requested | materialized`.

Revisão encerra a versão anterior e cria uma nova, ligada por `supersedes_id`.
Confirmação exige linguagem contextual inequívoca e uma proposta pendente única.
“Legal”, “parece bom” e recomendações do provider não materializam.

## Materialização, atomicidade e provenance

Uma única RPC transacional valida ownership, decisão ratificada, versão,
allowlist, mensagem humana, envelope dos slices, dependências e execution spec.
Ela cria todos os itens e seus eventos ou nenhum. Cada item nasce `proposed` e
recebe `intent.backlog_provenance` com IDs/versões da decisão e da proposta,
slice key, confirmação humana e dependências. A tabela de correlação liga slice
e work item sem usar título.

Replay com a mesma chave/payload retorna os mesmos IDs. Chave igual com mensagem
ou payload divergente falha fechada. A materialização não toca `work_focus`, não
cria approval, claim ou attempt e não chama Supervisor/coder.

Um resultado local `no_work_required` exige rationale não vazio e termina sem
criar proposta ou trabalho.

## Autoridade e continuidade

RLS e RPCs derivam `auth.uid()`; não há `service_role` no fluxo legítimo.
Decisão é ratificada pelo humano; proposta é derivação do sistema; confirmação
de materialização é humana; itens são materializados pelo host sob essa
autorização. A fronteira seguinte continua sendo a aprovação/autorização já
existente, separada e não acionada por este recorte.
