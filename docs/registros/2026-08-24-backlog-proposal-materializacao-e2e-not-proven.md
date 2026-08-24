# Backlog Proposal V0 — materialização E2E não comprovada

- **Data / tipo:** 2026-08-24 — prova viva e correção local.
- **Branch / HEAD inicial:** `dev` / `dc4609e4347b872abaf4ddd4913ed31e4495abd2`.
- **Resultado:** `BACKLOG_PROPOSAL_V0_E2E = NOT_PROVEN`.

O usuário confirmou pela UI real a V2
`a76c5acf-3e6f-41d9-a8b4-170d51be2d13`, versão 2, com a frase canônica
“Pode registrar esses trabalhos no backlog.” A UI respondeu como se os trabalhos
tivessem sido registrados, mas a inspeção persistida comprovou que a mensagem
caiu no chat comum: a V2 permaneceu `awaiting_confirmation`, materializações
permaneceram em zero e `work_items/work_events/work_focus` permaneceram
`60/601/2`. Duas linhas de conversa foram criadas (usuário e assistente), sem
evento de backlog.

A causa determinística foi a confirmação estrita não incluir exatamente a forma
nominal usada na própria pergunta da proposta: reconhecia “registrar isso” e
“criar esses trabalhos”, mas não “registrar esses trabalhos”. O fallback comum
produziu uma alegação operacional falsa. O schema de `ai_conversations` não
preserva provider/model; portanto não é possível provar localmente se esse
fallback usou OpenAI ou outro provider configurado.

A correção local acrescenta a forma canônica ao conjunto fechado de confirmações
inequívocas e uma regressão exata. Gates locais: core 31/31, composição web 3/3
e typecheck dos cinco workspaces. Não houve retry, replay, materialização,
approval, attempt, execution, Supervisor ou coder.

**Próximo ponto exato:** uma nova confirmação pela UI real exige autorização
humana independente. Somente depois de materialização real será lícito testar o
replay idempotente e declarar `BACKLOG_PROPOSAL_V0_E2E = PASS`.

