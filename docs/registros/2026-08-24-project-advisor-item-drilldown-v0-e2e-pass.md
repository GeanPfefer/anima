# Project Advisor Item Drill-down V0 — E2E PASS

- **Data / tipo:** 2026-08-24 — prova viva read-only.
- **Resultado:** `PROJECT_ADVISOR_ITEM_DRILLDOWN_V0_E2E = PASS`.
- **Branch / HEAD inicial:** `dev` / `3921425b875fc81d099f58eccfb961e509db3e5c`.
- **Item:** `58159655-0213-41e0-bb5a-735f79a81bf6`, pertencente à mesma conta
  autenticada na UI e confirmado por RLS HTTP 200.
- **Pergunta:** “O que aconteceu no item `58159655-0213-41e0-bb5a-735f79a81bf6`,
  qual foi a última tentativa e que evidência governada existe para ele?”.

## Projeção real anterior à chamada

- Estado `in_progress`, observado no item em `2026-08-11T02:46:59.395Z`.
- Timeline integral de quatro eventos: `work_proposed`, `context_attached`,
  `work_approved` pelo usuário e `work_started` pelo usuário.
- `latestAttempt=null`, nenhuma `latestFailure`, nenhum resultado, Verifier ou
  evidência coder/gate/Git.
- Observação do reteste gerada em `2026-08-24T20:12:45.885Z`.

## Trilha E2E e validação humana

- UI real enviou uma vez; nenhum browser automation ou retry.
- Backend resolveu exatamente o UUID user-scoped, construiu as duas fontes
  minimizadas `item-operational-state` e `item-operational-evidence` e omitiu
  payload, pedido, proposta, prompts, logs, comandos, caminhos e diffs.
- OpenAI `gpt-5.6-terra`: request estruturado iniciado uma vez; resposta de 4.201
  caracteres recebida.
- Schema aceito; parser estrutural e semantic validator passaram, com 11 fontes
  e 12 claims; HTTP 200 em 15.634 ms.
- A resposta exibida correspondeu à projeção: afirmou `in_progress` e os quatro
  eventos; declarou ausência de tentativa, falha, resultado, Verifier e
  evidências; não inferiu coder, timeout, sucesso, falha ou causa para a falta de
  telemetria posterior. Recomendou apenas confirmar a lacuna operacional.

## Ausência de mutação e efeitos

- Antes/depois: `work_items=60`, `work_events=601`, `work_focus=2`,
  `ai_conversations=189`.
- Antes/depois: HEAD e `origin/dev=3921425`, `origin/main=99bec54`, diff
  rastreado vazio.
- Nenhum coder, workflow, retry, resume, backlog, decisão, foco, PR, merge ou
  deploy foi acionado.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` foram
  preservados.

## Limites e próximo ponto

- O PASS prova leitura de um item com ausência de telemetria executora; não prova
  ainda o caso E2E de falha conhecida/desconhecida ou review com evidência na
  conta real.
- Próximo recorte recomendado: ergonomia de referência conversacional ou uma
  futura prova de item rico já existente, sem criar dado artificial. Qualquer
  nova chamada externa exige autorização independente.
