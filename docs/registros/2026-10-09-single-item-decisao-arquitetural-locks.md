# Single-Item V1 — decisão arquitetural de locks

2026-10-09. Tipo: análise/desenvolvimento offline.
Objetivo: avaliar o prefixo owner antes de alterações transversais, estabelecer
candidato mínimo, limites e prova comparativa. Fontes: Planos 044/045, inventário
045 e registros das provas reais/correções/recuperação de cobertura.

## Estado e decisão

Branch Windows `dev`; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`. Nenhum commit.
Estado inicial Windows: 24 arquivos tracked modificados, 106 entradas untracked,
índice vazio, 46 worktrees. Estado final: 24 tracked modificados, 110 entradas
untracked, índice vazio, 46 worktrees; WIPs/worktrees preservados. Git Linux na
montagem mostra diferenças de plataforma e não foi usado para contar o estado
Windows. Consultas PowerShell somente leitura, sem operações no índice.

A [decisão arquitetural proposta](../arquitetura/single-item-lock-strategy-decision.md)
recomenda **dois corpos**, start_claimed_work_attempt e release_work_claim, I próprio
antes de C com descoberta sem lock e releitura/correlação bloqueada. Start isolado
pode introduzir ciclo com release C→I_fk; prefixo transversal de 59 corpos não está
aprovado. Essa é recomendação para candidato e prova localizada, não implementação
concluída nem ausência global de deadlocks. Nenhuma falha de produto corrigida em
produção nesta sessão. O 40P01 real com pré-locks opostos segue evidência histórica;
chamadas naturais ainda exigem prova independente. Ciclos residuais e fronteiras
não cooperativas/multiowner continuam explícitos na ADR.

Mudanças: ADR, [Plano 046](../planos/046-single-item-lock-strategy-proof.md),
[modelo determinístico](../../supabase/tests/single_item_lock_strategy_test.py),
ponteiro append-only no Plano 045 e atualização de estado vivo no PRD.
Diff 045, inventário, fixtures/runners anteriores e registros históricos intactos.

## Verificação e limites

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'`:
**73 testes PASS**, 1,656 s, exit 0. Inclui 14 novos testes da estratégia e os 59
anteriores. Os novos testes preservam contraexemplos (start-only/release,
alvo estrangeiro, budget, trigger tardio, pré-locks, multiowner, não participante,
foco/recovery) em vez de ocultá-los. Modelo finito de duas transações, sequências
fixas e recursos exclusivos não certifica PostgreSQL, MVCC, catálogo ou justiça.

Snapshot SHA256 anterior da sessão comparado após alterações: **1.974 arquivos
preexistentes** sob migrations/bootstrap/apps/packages/tests, zero alterações.
O único teste novo é o modelo acima; migrations e execução governada intocadas.
Documentação preserva as 123 propriedades históricas recuperadas e 55 Single-Item;
nenhuma nova asserção PostgreSQL foi executada. Divergência orçamento V2 local/
externo versus V1 continua separada da estratégia de locks. Flakes offline: nenhum
observado; não inferir ausência de flakes/deadlocks reais desse resultado.

## Fronteira e retomada

BLOCKED_BY_HUMAN_DECISION: revisar o candidato de dois corpos e a matriz do Plano
046. Diff conceitual está na ADR; migration executável ainda não escrita/aprovada.
Depois dessa revisão, uma autorização separada permitirá implementar o candidato
e outra prova descartável com baseline/candidato de identidades e evidências
independentes. Critérios de rejeição/reversão e limites de performance estão no plano.

Docker não consultado/iniciado; nenhum container, SQL, migration, banco residente,
Resident Host, INV-11, API paga, compute externo, staging, commit, push, reset,
clean ou prune. Nenhum efeito externo/publicação. Gate
`single_item_atomic_claim_unavailable` mantido; produção permanece NO-GO.
Próximo ponto exato: revisão humana da ADR/Plano 046, antes de alterar SQL de produção.
