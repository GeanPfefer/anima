# Project Advisor Conversational Item Reference V0

- **Data / tipo:** 2026-08-24 — desenvolvimento e prova local determinística.
- **Resultado:** `PROJECT_ADVISOR_CONVERSATIONAL_ITEM_REFERENCE_V0_LOCAL = PASS`.
- **Branch / HEAD inicial:** `dev` / `cb0ab35a2dd62bbbe82f20cb5b0880e6b6ea2e6c`.

## Contrato e fluxo

- O Advisor continua sem persistir respostas read-only no banco. Após a resposta
  estruturada passar pelo host, UUIDs exatos realmente mencionados são cruzados
  contra o snapshot vivo e reduzidos a `workItemId`, ordinal e papel operacional.
- O metadado viaja no header `X-Anima-Presented-Items`; o `ChatClient` o mantém em
  `useRef` apenas durante a sessão e o envia no próximo request. Uma apresentação
  posterior vazia limpa o conjunto antigo.
- O servidor valida tamanho, UUID, ordem, papel, duplicação e campos adicionais.
  Payload adulterado falha fechado. Nenhum texto, snapshot, autorização ou dado
  pessoal é retido.
- Ordinais usam somente a ordem apresentada. Anáfora resolve apenas com um
  candidato compatível; “essa falha” filtra somente refs apresentadas como falha.
  Ambiguidade retorna esclarecimento humano sem provider.
- Depois de resolver a identidade, o item e seus eventos são relidos sob RLS. A
  referência não congela estado nem cacheia acesso; item agora invisível retorna
  404 governado.

## Provas e gates

- Core focado: 40/40 para referência conversacional + drill-down; campanha
  pertinente ampliada: 63/63 incluindo Advisor e overview.
- Web pertinente: 34/34 — transporte efêmero, limpeza stale, fronteira read-only,
  Advisor e continuidade normal do chat.
- Typecheck: cinco workspaces.
- Build Next: 56 páginas, executado com `next dev` parado.
- `git diff --check`: PASS.

## Segurança, efeitos e limites

- Nenhum provider/egress, escrita de banco, foco, backlog, coder, workflow, retry
  ou resume foi acionado.
- Não foram criadas migration, tabela, cookie, localStorage ou memória geral.
- `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` e
  `origin/main` preservados; sem PR, merge ou deploy.
- E2E pela UI real ainda é necessária para provar o encadeamento entre uma
  resposta real do Advisor e a anáfora seguinte; exige autorização externa.

## Próximo ponto exato

Com autorização independente, executar na mesma sessão: overview que mencione
dois UUIDs → “Me fale mais sobre o primeiro” → “E o segundo”; em uma segunda
apresentação controlada, A+B → “E esse?” deve esclarecer sem provider indevido.
