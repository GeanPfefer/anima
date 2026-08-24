# Project Advisor Fresh Operational State V1 — E2E não provada

**Data:** 2026-08-24

**Tipo:** prova viva + correção determinística local

**Branch:** `dev`

**HEAD inicial:** `12d5224577d86fc32b43a134dfae9fd68ffd00cf`

## Prova autorizada

A pergunta canônica foi enviada uma vez pela UI real, sem automação de browser.
O servidor registrou 11 fontes, quatro classes de autoridade e 24.068 caracteres
governados. OpenAI `gpt-5.6-terra` devolveu structured output de 7.226 caracteres.
Não houve retry.

O parser estrutural chegou a entregar a resposta ao semantic validator, que a
recusou com `current_claim_without_live_source`. Portanto a resposta não foi
apresentada; a UI exibiu a mensagem fail-closed. O resultado correto da prova é
`PROJECT_ADVISOR_FRESH_OPERATIONAL_STATE_V1_E2E = NOT_PROVEN`.

## Diagnóstico e correção

O V1 já proibia linguagem presente sustentada só por `historical_snapshot`, mas
`unprovenFrontiers` ainda aceitava semanticamente um claim histórico puro. Como
essa categoria descreve fronteiras abertas agora, o contrato ficou alinhado:
cada fronteira deve citar ao menos `current_projection` ou `event_sequence`.
Histórico puro permanece válido no `rationale` para explicar trajetória; a matriz
de autoridade e o fail-closed não foram afrouxados. O prompt declara a mesma
regra e há regressão positiva/adversarial.

## Ausência de mutação

Antes e depois: `work_items=60`, `work_events=601`, `work_focus=2` e
`ai_conversations=189`; HEAD/origin-dev permaneceram `12d5224`, origin/main
`99bec54`, diff rastreado vazio. Nenhum work item, foco, backlog, decisão, coder
ou workflow foi acionado pelo Advisor. O POST auxiliar `turns/abandon` respondeu
204 sem alterar as contagens.

## Snapshot reconstruído

No escopo do usuário da prova canônica, a reconstrução read-only encontrou um
item de programação em `review`, zero falhas não superadas, zero bloqueios e
nenhum evento verificado dentro da sequência visível. Essa reconstrução ocorreu
após a tentativa e não substitui a resposta rejeitada, cujo conteúdo não foi
persistido por desenho.

## Segurança e retomada

Nenhum conteúdo proibido foi lido pela rota ou enviado: as queries mantiveram
somente IDs, estados, capability, timestamps, autoria e tipos de evento; payload,
pedido original, intent e proposal continuaram ausentes. Nenhum novo egress é
autorizado. Após os gates locais e publicação da correção, o próximo ponto é uma
nova prova manual da mesma pergunta, somente sob autorização explícita.

## Gates da correção

- Advisor/snapshot core: 23/23.
- Advisor/context/provider web: 22/22.
- Typecheck dos cinco workspaces: PASS.
- Build web com `next dev` encerrado: 56 páginas, PASS.
- `git diff --check`: PASS.

O `generatedAt` exato da tentativa não foi persistido nem registrado nos logs;
isso preserva a minimização, mas limita a auditoria temporal pós-falha. A
reconstrução read-only posterior ocorreu em `2026-08-24T19:34:23.7478864Z`.
