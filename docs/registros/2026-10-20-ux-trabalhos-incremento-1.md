# UX-TRABALHOS — incremento 1: área dedicada de Trabalhos (read-only)

Data: 2026-10-20. Branch `claude/ux-trabalhos-1` (worktree `C:\Users\GeanTeco\anima-work-trabalhos`), base `28d5ed7b`. Não integrado nem publicado.

## O que entrega
- `GET /api/work-orchestration/catalog`: catálogo LEVE e paginado (todos os estados), isolado por RLS + `user_id`. Busca GLOBAL no banco por código (`canonical_provenance.sourceId`, `investigation_provenance.reference`), título (objetivo canônico, pergunta, resumo) e UUID exato; filtro por estado; "só os que precisam de mim" (critério da governança existente `isWaitingForUserWorkState`: proposed, review, changes_requested); ordenação estável (coluna temporal + `id`); página limitada ao intervalo real; contagem global de pendências. Sem migration, sem N+1, sem eventos.
- `/trabalhos` (página servidor, URL = estado) e `/trabalhos/[referencia]` (código legível ou UUID; `?item=<uuid>` desambigua sucessores que partilham o código; ambíguo lista candidatos sem abrir nenhum). O detalhe reutiliza a reconstrução de `items/[id]`, `resolveWorkReference` e o `WorkProposalCard` com as rotas de ação atuais.
- AppNav: link "Trabalhos" e `aria-current`.
- NÃO altera ChatClient, ProjectWorkPanel, WorkProposalCard, rotas de ação, governança, banco ou migrations.

## Provas
- Jest focado (catálogo, rota, detalhe, componentes, AppNav) e tsc sem erros. Regressão dos cartões/rotas existentes verde, exceto `backlog-cycle/route.test.ts`, que já falha no checkout principal.
- Consulta REAL (identidade residente, só leitura): 179 de 215 itens do usuário (os demais pertencem a outros usuários); paginação percorre 179 itens únicos nas 4 ordenações; busca por código, parcial, título, `_` literal e injeção sem efeito; detalhe de PROOF-01 ok, SDC-02 ambíguo, inexistente e inválido.

## Limites
- "Precisa de você" cobre os estados de espera humana; aprovado sem classificação e decisões pendentes (`pendingDecision`) não entram no destaque do catálogo (só no detalhe).
- A busca usa `ilike` sobre JSON sem índice (sem migration); ok para centenas de itens, medir antes de milhares.
- Sem badge de pendências no menu nem remoção dos cartões do chat (incrementos seguintes).
