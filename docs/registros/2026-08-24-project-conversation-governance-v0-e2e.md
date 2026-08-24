# Project Conversation Governance V0 — prova E2E

- **Data / tipo:** 2026-08-24 — correção determinística e prova viva pela UI real.
- **Objetivo:** provar conversa natural → proposta → ratificação humana, sem backlog ou execução.
- **Branch / HEAD inicial:** `dev` / `f0048b04d0b26a68df39b88588e5969f8213ffde`.
- **Resultado:** `PROJECT_CONVERSATION_GOVERNANCE_V0_E2E = PASS`.

## Correção pré-prova

A revisão do roteiro revelou que o replay T4 de “Sim.”, após a proposta deixar
de estar pendente, cairia no chat comum e poderia gerar egress desnecessário. O
host agora reconhece apenas o replay imediato cuja última mensagem corresponde
ao `source_message_id` da ratificação mais recente. Ele responde localmente sem
RPC; um “Sim.” solto continua conversa normal. O gate de autoridade não mudou:
ratificar ainda exige exatamente uma proposta pendente.

## Prova viva

- **T1 — exploração:** a pergunta sobre usar cloud como transbordo recebeu
  análise advisory. Zero proposta/evento. Uma chamada OpenAI, sem retry.
- **T2 — preferência:** “Eu prefiro local primeiro e cloud só quando realmente
  precisar.” criou a proposta `1dedfd5f-0f19-4e8a-8ac5-fcc54a304fbb`, versão 1,
  em `awaiting_confirmation`. Zero provider.
- **T3 — confirmação:** “Sim.” criou exatamente um evento `ratified`, actor
  `user`, em `2026-08-24T21:35:24.897983Z`. Zero provider.
- **T4 — replay:** novo “Sim.” informou que a decisão já estava ratificada;
  nenhum evento adicional e zero provider.

O statement persistido é somente a preferência humana. `rationale` ficou vazio e
`constraints`, `implications`, `alternatives` e `uncertainties` ficaram vazios;
as sugestões advisory de T1 não foram atribuídas ao usuário. A proposta aponta
para a mensagem humana de origem, e a ratificação aponta para a confirmação
humana exata. Proposta e eventos pertencem à mesma identidade autenticada; RLS e
RPCs derivaram `auth.uid()`.

## Invariantes e gates

- Banco global antes → depois:
  `project_decision_proposals 0→1`, `project_decision_events 0→2`,
  `work_items 60→60`, `work_events 601→601`, `work_focus 2→2`,
  `ai_conversations 191→196`.
- O aumento de conversas corresponde a T1 usuário+assistente e T2/T3/T4 usuário;
  respostas host-side não criaram mensagens artificiais do assistente.
- Nenhum work item, backlog, approval, Supervisor, coder, attempt, Git, PR,
  merge, deploy, configuração ou infraestrutura foi acionado.
- Provider: OpenAI apenas no T1 (1 chamada); T2/T3/T4 = 0; total = 1; sem retry.
- Testes: domínio 25/25; boundary web 9/9.
- Typecheck: cinco workspaces.
- Build Next: 56 páginas, com `next dev` parado.
- `git diff --check`: PASS.

## Efeitos externos, limites e retomada

Egress restrito ao T1 conversacional autorizado. Não houve PR, merge ou deploy.
O push de documentação/correção para `origin/dev` é o único efeito externo de
entrega; `origin/main` permanece intacta. `.worktrees/`, configuração local e
segredos foram preservados.

Limite aberto: o replay host-side cobre deliberadamente somente a confirmação
imediata vinculada à ratificação mais recente; memória conversacional durável de
decisões não foi ampliada. Próximo recorte recomendado, ainda não autorizado:
Backlog Proposal separado, mantendo decisão ratificada sem autoridade operacional.
