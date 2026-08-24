# Project Advisor Item Drill-down V0 — prova local

- **Data / tipo:** 2026-08-24 — desenvolvimento e prova determinística local.
- **Objetivo:** permitir compreensão governada e read-only de um item operacional
  explicitamente referido no chat, sem ampliar o overview nem iniciar recuperação.
- **Branch:** `dev`.
- **HEAD inicial:** `b6f66ce169366f125a7ca9edec3b7d89afee0111`.

## Mudanças e decisões

- A resolução é conservadora: UUID, prefixo único, ordinal determinístico, foco
  atual para referência dêitica ou candidato único; ambiguidade pede ID exato.
- A projeção por item é pura, temporal e bounded: no máximo 20 eventos visíveis e
  200 eventos lidos pela rota para o único item já resolvido.
- Falha observada não vira diagnóstico. Código/mensagem tipados só aparecem se
  forem curtos e passarem a redação; ausência ou dado sensível vira causa
  `unknown` com limite explícito.
- Evidências coder, gate e Git reutilizam presenters tipados e saem apenas como
  contagens, desfechos, duração, SHA e timestamp. Comandos, logs, caminhos e diff
  não são serializados.
- A bifurcação do drill-down está antes de qualquer detector ou gravador do chat;
  respostas declaram `X-Anima-Mutation: none`.

## Provas e gates

- 18 testes focados cobrem resolução, ambiguidade, ordenação/bounds, falha atual e
  superada, causa conhecida/desconhecida, redação adversarial, tentativa,
  resultado, Verifier, evidências coder/gate/Git, ausência de payload/mutação,
  overview bounded e matriz de autoridade.
- Regressões core do Project Advisor e snapshot: verdes.
- Regressões web do Advisor, Context Builder e turno normal do chat: verdes.
- Gates finais (typecheck dos cinco workspaces, suíte pertinente, build web com
  dev parado e `git diff --check`) são registrados no fechamento deste commit.

## Segurança, efeitos e limites

- Nenhum egress/provider foi usado; nenhuma mensagem externa foi enviada.
- Nenhum banco, backlog, foco, work item, evento, coder ou workflow foi alterado.
- Nenhum PR, merge ou deploy foi criado; `origin/main` permaneceu intacta.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` foram
  preservados.
- **Limite:** a capacidade está provada localmente. A prova pela UI real com um
  provider exige autorização explícita independente.

## Próximo ponto exato

Com autorização de uma única chamada, executar pela UI real uma pergunta com ID
inequívoco de item e comparar banco/Git antes/depois. Sem essa autorização, parar.
