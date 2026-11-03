# Single-Item V1 — diagnóstico e proposta mínima item/orçamento

2026-10-09; desenvolvimento/análise offline. Objetivo: recuperar o 40P01 residual
sem alterar a correção item/claim, políticas ou ambiente residente.
Branch Windows `dev`; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`. Nenhum commit/staging/push.

## Diagnóstico e decisão

[Ciclo/escopo/prova preparados no Plano 048](../planos/048-single-item-budget-lock-order.md).
A espera cruzada está comprovada em duas evidências anteriores independentes:
A I→C→T→B via trigger de execution_started; B block B→I. SQLSTATE 40P01 de A,
rollback e cleanup iguais. Snapshot mostra a espera de B; log de erro fecha ambas
as arestas. Harness usa pré-lock manual I; reprodução com duas entradas naturais
mais barreira independente C ainda é requisito da próxima prova, não resultado atual.

Recomendada proposta de quatro corpos: antecipar o advisory de orçamento já
existente em start_claimed e nas três admissões de retomada. Um corpo basta para
mudar o par específico; três retomadas exigem o mesmo protocolo para não conservar
I→B no domínio das admissões conhecidas. Não há prefixo em 59 funções, mudança
de quota ou novo mutex. Release/acquire/global/trigger/política ficam intactos.

Artefatos novos: [diff](../planos/048-single-item-budget-lock-order.diff),
[SQL somente proposto em docs](../planos/048-single-item-budget-lock-order-candidate.sql),
[inventário e hashes](../planos/048-single-item-budget-lock-order-inventory.json),
[testes](../../supabase/tests/single_item_budget_lock_order_test.py).
SQL proposto não está em migrations e não foi aplicado a qualquer banco.
O scanner inspecionou 161 definições vigentes, com 155 migrations pinadas;
headers/argumentos/corpos originais preservados exceto quatro inserções do PERFORM.
Não é compilador nem prova de ACL/MVCC/FK universal.

## Provas offline e falhas preservadas

13 testes novos PASS; **97 testes Single-Item offline PASS** no conjunto completo
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'`
(33,687 s). Incluem integridade das fontes/evidências, diff/semântica textual,
ordem B→I e I→C, contraexemplos de pré-locks, retomada omitida, recovery, foco e
alvo entre itens; os 178 contratos canônicos históricos/Single-Item continuam
validados pelos testes anteriores. O modelo exclusivo finito não demonstra ausência
universal de deadlocks e não executou qualquer prova PostgreSQL.

Primeira execução dos testes novos detectou problemas **do material offline desta
sessão**: normalização CREATE OR REPLACE incompleta por whitespace inicial em um
corpo e comparações de whitespace; leitor esperava objeto em failedAssertions,
mas o relatório bruto contém linhas TAP. Corrigidos no gerador/proposta e teste,
sem mexer no candidato item/claim, SQL de produção ou relatório bruto. Resultado
inicial (5 failures/1 error) não era nova regressão do produto nem prova SQL.

Quatro FAIL anteriores `work_budget_local_vs_external`, asserções 1, 2, 6 e 10,
permanecem explícitos e byte-preservados: expectativas históricas de quota só
externa divergem da política atual v1 supervisionada. Ambos os ambientes anteriores
8/12 nessa suíte e 330/334 no total. Não foram reexecutados nem convertidos em PASS;
não alterar expectativas, classificação ou política para liberar este candidato.

Bootstrap offline: 272 etapas verificadas e 556 hashes sem divergência; plan SHA256
`6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13`.
Snapshot de 6.880 arquivos preexistentes de migrations/harness/bootstrap/evidência
e código relevante: zero alterações. Não equivale a execução do bootstrap.

## Segurança, limites e efeitos

O prefixo só resolve a ordem nas quatro entradas que ainda não tenham locks
relevantes anteriores. Mesma transação acquire/start, pré-lock I/C, recovery
multi-item, alvo/claim estrangeiro/FK, foco, pai/admin e multiowner continuam
fora da garantia. Novas esperas de B podem aumentar contenção/replay e ampliar
janela preexistente de revogação nas retomadas, que não têm rechecagem igual ao
start. Plano exige registrar esse caso, lease/now transacional, erros/timeouts e
isolamentos; falha de contrato implica NO-GO, não ajuste silencioso durante prova.

Não executados Docker, containers, SQL, pgTAP ou concorrência real nesta sessão.
Nenhum acesso ao Supabase residente; saúde atual não foi reavaliada. Os estados
saudáveis DB/Auth e Vector degradado registrados na comparação anterior são
históricos, não uma observação nova. Nenhum container anterior iniciado/removido/
reutilizado. Nenhuma migration existente, policy, código governado ou gate alterado.
Resident Host, INV-11 e compute pago não usados. WIPs/worktrees preservados.
PRD e Plano 047 recebem apenas ponteiros append-only para a retomada.

## Git e próximo ponto exato

Git inicial: 24 tracked modificados, 123 entradas untracked agregadas, índice vazio,
46 worktrees registradas. [Verificação final](2026-10-09-single-item-budget-lock-order-checks.json)
registra status/HEAD/worktrees/contagens e integridade das fontes protegidas.
Git final: 24 tracked modificados, 130 entradas untracked agregadas, índice vazio,
46 worktrees; branch/HEAD inalterados. Sete novas entradas desta sessão explicam
a diferença 123→130; os dois documentos já alterados recebem somente acréscimos.
Mudanças desta sessão limitadas aos artefatos 048, teste offline, este registro,
JSON de checks e acréscimos no PRD/047. WIPs SQL anteriores de 20260905000001/00002
continuam como estavam; não são alterações desta sessão.

**BLOCKED_BY_HUMAN_DECISION:** revisar quatro corpos e fronteira de transação limpa.
Se aprovados, autorizar separadamente criação de migration incremental e prova
047/048 com baseline comum item/claim e candidato orçamento. Reconstruir somente
novos descartáveis independentes sob novo preflight, nunca aplicar ao residente.
Controle natural positivo e contenção ainda não provados. Promoção continua NO-GO;
`single_item_atomic_claim_unavailable` permanece ativo. Parada antes de SQL de produção.
