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

## Fechamento da validação humana (commit adicional)
- Opção B: no detalhe de Trabalhos a ação "Pedir correção" fica desabilitada com a orientação de usar o Chat (a rota `proposal-corrections` exige provider explícito e falha fechada sem ele). `WorkProposalCard` ganhou a prop opcional `correctionUnavailableReason`; sem ela o Chat não muda.
- PROOF-01 aparecia como "Pronto para integrar" apesar de integrado e publicado. Causa: `projectWorkIntegration` (core) só conhecia o protocolo de DECISÃO/publicação (`integration_decided`, `branch_published`, `review_request_created`) e ignorava o protocolo de EFEITO (`integration_effect_authorized` pelo usuário + `integration_completed` pelo sistema), cuja validação já existia em `integration-effect.ts`. Distinção: decisão de integração ≠ integração efetivada (efeito Git local em `refs/heads/dev`, com receipt) ≠ publicação Git (push para o remoto; o ANIMA NÃO registra isso).
- Correção na projeção (somente leitura): novo status `integrated` com `integrationEffect` quando o receipt do sistema reproduz integralmente a autorização humana e corresponde a ESTE item, versão e resultado aceito; qualquer divergência cai no comportamento anterior. Fase humana: Concluído. Web e mobile mostram "Integrado no repositório local" e dizem que a publicação no remoto não é registrada.
- Prova no ledger vivo (core da worktree): dos 53 itens completed, 22 passaram de "aguardando decisão" para `integrated` (inclui PROOF-01 e A1-v2); 21 continuam aguardando decisão (aceitos sem efeito registrado) e 10 sem integração projetada.
- Não alterado: rotas de ação, autoridade, estado persistido, banco e migrations. Itens com `integration_effect_authorized` sem `integration_completed` continuam como "aguardando decisão" (limitação conhecida, fora desta correção).
