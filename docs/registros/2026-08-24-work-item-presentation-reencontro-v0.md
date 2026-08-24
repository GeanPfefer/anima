# Work Item Presentation / Reencontro V0

- **Data/tipo:** 2026-08-24 — desenvolvimento e prova local.
- **Objetivo:** remover a colisão de cartões por mensagem-fonte e criar uma
  superfície read-only para reencontrar work items sem iniciar execução.
- **Branch/HEAD inicial:** `dev` em
  `c0ed988e993d90a75be9fa0f0f792390f681480c`, igual a `origin/dev`.

## Mudança

- O shape `Record<sourceMessageId, WorkPresentationView>` foi substituído por
  `Record<sourceMessageId, WorkPresentationView[]>`; atualização e hidratação
  preservam siblings pela identidade `workItem.id` e ordem do servidor.
- O chat passou a carregar o GET autenticado `/api/work-orchestration/items` e
  expor “Trabalhos do projeto”, sem criar conversa, tabela ou estado autoritativo.
- O detalhe reutiliza `WorkProposalCard` e o GET `/items/:id`. Dependências
  pendentes removem a ação autônoma do detalhe e explicam o bloqueio; o boundary
  mutante continua sendo o `/supervisor-turn` já existente.

## Provas e gates

- 14 testes focados: agrupamento/hidratação, identidade, ordem, painel,
  elegibilidade, bloqueio e regressões conversacionais — todos passaram.
- Suite existente do `WorkProposalCard`: 44 testes passaram; warnings antigos de
  `act()` permanecem flakes conhecidos, sem falha.
- `npm run typecheck`: cinco workspaces passaram.
- `npm run build`: Next.js compilou e gerou 56 páginas; `/chat` e os GETs de
  work orchestration foram incluídos.
- `git diff --check`: passou (somente avisos de normalização LF/CRLF).

## Segurança e fronteira humana

- Nenhum POST de work orchestration foi chamado na prova; item 1 permaneceu
  `approved` e `NOT_STARTED`.
- OpenAI, Ollama, coder, Supervisor, claim, worktree, PR, merge e deploy não foram
  acionados. Egress de provider: zero.
- RLS foi preservado porque lista, agrupamento por fonte e detalhe reutilizam os
  GETs autenticados existentes e nunca usam `service_role`.
- **Checkpoint:** abrir `/chat` na sessão real, confirmar os três itens após
  refresh e não clicar em “Executar autonomamente”. Somente após essa inspeção a
  prova E2E poderá ser declarada PASS.
