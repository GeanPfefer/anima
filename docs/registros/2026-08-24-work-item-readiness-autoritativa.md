# Readiness autoritativa nos cartões de trabalho

- **Data/tipo:** 2026-08-24 — correção e prova local.
- **Objetivo:** eliminar a divergência entre o painel de reencontro e os cartões
  reidratados, sem executar nenhum item.
- **Branch/HEAD inicial:** `dev` em
  `ebda24e49099348cd282a454a8b32324016e1f5e`, igual a `origin/dev`.

## Causa e correção

O painel superior calculava dependências no cliente, enquanto os cartões ligados
à mensagem continuavam habilitando execução apenas por `approved` e validade do
`execution_spec`. Os GETs de lista, source grouping e detalhe agora acrescentam
uma projeção read-only de `autonomous_work_queue()`, a mesma fila SQL consumida
pelo Supervisor. O cliente não recalcula eligibility: usa a projeção pelo ID
exato e falha fechado quando ela não existe. Dependências visíveis são consultadas
sob RLS apenas para explicar o bloqueio.

## Provas

- 63 testes focados passaram: fila autoritativa, falha fechada, itens 1/2/3,
  cartões, painel, siblings/refresh e regressões do chat.
- Typecheck dos cinco workspaces passou.
- Build Next.js passou com 56 páginas.
- `git diff --check` passou; avisos LF/CRLF não são falhas.

## Invariantes

- Nenhum POST de work orchestration, `supervisor-turn`, claim, attempt, coder ou
  provider foi chamado. Os três itens reais não foram executados.
- Nenhuma semântica da fila, migration, RLS ou tabela foi alterada.
- O handler existente continua enviando o `workItemId` do próprio cartão; ordem
  visual e “primeiro elegível” não participam da identidade.
- **Checkpoint humano:** atualizar `/chat` e confirmar Item 1 elegível, Item 2
  bloqueado pelo Item 1 e Item 3 bloqueado pelo Item 2, inclusive nos cartões
  detalhados da conversa, sem clicar em qualquer ação.
