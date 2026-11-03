# Single-Item V1 — revisão de locks e fixtures históricas

09/10/2026; desenvolvimento/análise offline. Objetivo: inventariar caminhos,
revisar candidato sem modificar produção e reformular cinco suítes guard-unsafe.
Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Zero commits/staging/push/reset/clean/prune. Inicial: 19 modificados versionados,
115 entradas untracked agregadas, índice vazio e 46 worktrees registradas.
[Prova original](2026-10-08-single-item-provas-reais.md) e
[sessão anterior](2026-10-09-single-item-correcoes-offline.md) permanecem intactas.

## Decisões e análise

O [Plano 045](../planos/045-single-item-lock-review.md) substitui a recomendação
linear do 044 sem reescrever seu histórico. FKs de claim/evento/foco, trigger de
foco, recovery/ancestrais e orçamento completam o grafo: C1 observado 40P01;
C2–C6 inferidos com pré-condições a provar; C7/C8 são limites de deletion/admin.
Não transformar grafo estático em DAG por alegação: recomendação é prefixo comum
B antes de recursos para transações participantes de um único owner fixo, sem
pré-lock. Corpos e checks permanecem, evitando erro/replay alterado por checagem
antecipada do alvo. Serialização, waits, lease/now e DML não participante são riscos
concretos. Nenhuma declaração de deadlock eliminado em PostgreSQL.

Inventário textual: 139 definições e dependências/12 callbacks (scanner percorreu
161 definições finais no corpus); overloads, DROP, RENAME/aliases e hashes tratados.
[JSON](../planos/045-single-item-lock-inventory.json) fixa fonte/linha/hash/callees/
locks/disposição. [Diff proposto](../planos/045-single-item-lock-review.diff): 59
prefixos adicionados, zero remoção de linhas de corpo, 42 fontes históricas; cinco
corpos já B-first, três triggers mutantes herdam, sete mutadores pagos separados,
65 readers/validadores/wrappers. Não aplicar esse patch a migrations históricas:
após aprovação compor migration nova com corpos vigentes e ACLs preservados.

Single-Item segue recusando claim alheio inclusive vencido antes de delegar global;
novo candidato só introduz lock de owner, sem UPDATE/DELETE/evento alheio. Sua
interferência temporal entre itens é explícita, não autoridade de manutenção.
Divergência local/externo permanece sem correção de política, expectativas ou skip.

## Manifesto exato

Cinco arquivos versionados de fixtures alterados nesta sessão:
- supabase/tests/work_budget.test.sql
- supabase/tests/work_budget_local_vs_external.test.sql
- supabase/tests/budget_blocked_human_resume.test.sql
- supabase/tests/work_budget_interruption_resumption.test.sql
- supabase/tests/supervisor_reconciliation.test.sql

Mudanças: remover DISABLE/ENABLE de guardas; classificação/route/executor e claims
históricos; histórico de seis starts distribuído 3+3; routes para ambos executores
na interrupção; retry de reconciliação com max_attempts=2 na fixture t5 (duas
attempts legítimas em vez de bypass). Mantido cenário de vários itens do mesmo
owner, pois comandados não entram no consumo autônomo e cinco starts sob claim
ficam abaixo do teto6. Timestamps/estados sintéticos controlados continuam restritos
a BEGIN/ROLLBACK; não são instrução de UPDATE de ledger real.

Novos instrumentos/contratos (offline):
- supabase/tests/helpers/guarded_history.inc
- supabase/tests/single_item_lock_audit.py
- supabase/tests/single_item_lock_review_test.py
- supabase/tests/single_item_pgtap_payload.py
- supabase/tests/fixtures/single_item_assertion_contract.json

Novos documentos: Plano 045, inventário JSON, diff candidato, este registro e
[delta exato das fixtures/instrumentos](2026-10-09-single-item-cobertura-fixtures.diff)
contra bytes pré-sessão (não contra HEAD). PRD, planos 043/044 e protocolo de
concorrência receberam apenas adendos. Nenhum hunk preexistente foi apagado.
Single-Item 55 e runner anterior ficaram byte a byte intactos, assim como migrations,
bootstrap e execução web/core. Não recompilar/atualizar pacote congelado bootstrap.

## Gates e falhas de instrumentação

Rodada final proporcional:
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'`:
**59 PASS**, quatro módulos (31 concorrência offline, 17 review, 7 preflight,
4 recovery). Focal review anterior 17 PASS; resultados não somados como cobertura.
17 testes incluem 196 pares de paths com prefixo comum em modelo finito, seis
contraexemplos antigos e fronteiras não participantes/multi-owner, inventário/
triggers e rendering fechado. Não modelam PostgreSQL completo nem seu escalonador.

Contrato compara 178 statements pgTAP normalizados: 123 históricos e 55 Single-Item.
Só whitespace e inclusão de executor_id correlacionado são normalizados; expectativas,
SQLSTATE e labels mantidos. As 123 ficaram **preparadas**, não executadas/aprovadas
em PostgreSQL. Local/externo deve expor divergência V2/V1, não virar verde por bypass.

Na primeira rodada de 15 testes novos, duas falhas eram do instrumento: comentário
contendo expires_at era confundido com filtro e ciclo esperava par em vez do caminho
C→I→T→C. Corrigidos os testes, sem mudar SQL/proposta para satisfazê-los. Scanner
passou a recusar CREATE FUNCTION desconhecido e tratar comentário entre assinatura
e RETURNS, em vez de omitir um trigger. Sem flake conhecido.

1108 arquivos protegidos (migrations/bootstrap/web e core orchestration) comparados
por SHA256, zero mudanças. Nenhum parser/compilador PostgreSQL disponível foi usado:
renderer/scanner validam fechamento lexical e contrato, não semântica PL/pgSQL.
Typecheck/Jest/build não executados: nenhum TypeScript/código de aplicação mudou.

## Segurança, efeitos e retomada

Sem Docker, SQL, migration nova/aplicada, reconstrução, residente, INV-11, Host,
compute pago/API, credenciais, staging/commit/push/reset/clean/prune. Consultas web
apenas à documentação/código oficial PostgreSQL para modos de locks/FK/trigger/
snapshots, sem dados locais enviados. Gate single_item_atomic_claim_unavailable
intacto e produção NO-GO; nenhum resultado histórico reclassificado.

BLOCKED_BY_HUMAN_DECISION: revisar candidate amplo/prefixo, escopo dos participantes,
139 entradas/callbacks, custos de serialização e leases. Próximo ponto exato:
procedimento do Plano 045 — validar transportes/includes e preflight factual do
ambiente independente, autorização para compor migration nova e prova separada
baseline/candidato. Catálogo/PLpgSQL/RLS/FK/waits/cleanup e divergência de contrato
local/externo continuam bloqueios concretos. Não autoriza aplicar patch nem liberar
produto/INV-11. WIPs e worktrees preservados.

## Correção de contagens Git e fechamento

A consulta inicial de PowerShell usou wildcard `?? *` e reportou 115 como
“untracked”: eram 19 modificados + 96 untracked. O mesmo erro afeta as contagens
de “111/115 untracked” nas entregas anteriores: os valores eram totais de entradas
nessas consultas, não somente untracked. Os registros históricos não foram editados.
Nesta sessão, a consulta literal StartsWith('?? ') encontrou 24 modificados e
107 untracked, incluindo um cache Python recém-gerado desta própria análise.
O único single_item_lock_audit.cpython-312.pyc foi identificado e removido, assim
como sua pasta vazia; nenhum WIP ou arquivo preexistente foi removido. Rodadas de
teste usam PYTHONDONTWRITEBYTECODE=1. Final esperado: 24 modificados, 106 untracked.
Índice vazio, 46 worktrees, HEAD/branch preservados. Git diff --check exit 0;
1108 arquivos protegidos e Single-Item/runner novamente comparados, intactos.
