# Project Conversation Governance V0

- **Data / tipo:** 2026-08-24 — desenvolvimento e prova local determinística.
- **Branch / HEAD inicial:** `dev` / `254cbfee4d6eff4d6413e4b8b47f53c6a57b3b58`.
- **Resultado:** `PROJECT_CONVERSATION_GOVERNANCE_V0_LOCAL = PASS`.

## Entrega

Foi reutilizado o chat `ai_conversations`, o padrão de contratos puros em core,
eventos append-only, RPCs `SECURITY DEFINER`, RLS e chaves idempotentes. Criados
`project_decision_proposals`, `project_decision_events`, a view de estado e duas
RPCs. A bifurcação vive no `/api/ai/chat`; conversa não convergente continua no
fluxo anterior. Não existe segundo chat, backlog ou memória client-side
autoritativa.

Exploração e hipótese não persistem decisão. Preferência explícita pode produzir
proposta; confirmação só ratifica uma pendente inequívoca. Duas pendentes pedem
esclarecimento. Rejeição e revisão são terminais distintos; a versão revisada
referencia a anterior e exige confirmação nova. Replay idêntico é idempotente;
versão divergente, resolução concorrente/tardia e outra conta falham fechados.

## Persistência e efeitos

Persistidos: enunciado mínimo, rationale/listas estruturadas quando existentes,
provenance, versão, relação de revisão, actor, outcome, timestamps e chaves de
idempotência. Não persistidos na decisão: transcript, prompt, chain-of-thought,
output bruto ou conteúdo irrelevante. A mensagem humana permanece no substrate
normal e é apenas referenciada por ID.

Ratificação cria um evento e nada mais. pgTAP prova contagens invariantes de
`work_items` e `work_focus`; a rota não contém coder, Supervisor ou approval.

## Gates

- Core pertinente: 93/93 (24 específicos de governança).
- Web pertinente: 34/34.
- pgTAP: 31/31, contas descartáveis + rollback.
- Typecheck: cinco workspaces.
- Build Next: 56 páginas, `next dev` parado.
- `git diff --check`: PASS após normalizar o EOF do tipo gerado.

Nenhum egress, provider externo, browser automation, E2E, backlog ou execução foi
realizado. Próximo ponto: E2E manual futura da conversa T1–T4, sob autorização
separada; Backlog Proposal permanece fora de escopo.
