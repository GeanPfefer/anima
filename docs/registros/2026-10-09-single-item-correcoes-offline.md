# Single-Item V1 — correções offline após provas reais

09/10/2026, desenvolvimento. Objetivo: corrigir defeitos comprovados de testes e
propor locks antes de tocar em SQL de produção. Branch dev; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`; zero commits. Estado inicial Git Windows:
19 modificados versionados, 111 entradas untracked agregadas, índice vazio,
46 worktrees registradas. Trabalho local preexistente não incorporado nem removido.

## Evidências e decisões

Lidos delivery-summary/pgtap-results/diagnósticos/concurrent-results/result de deadlock
em G:\anima-provas\single-item-7694431622913864120-{real,concurrency-decoder,deadlock}.
SHA256SUMS íntegros: 151+113+17 = 281 arquivos, nenhuma divergência. Resultados da
[prova original](2026-10-08-single-item-provas-reais.md) continuam NO-GO, sem editar
as evidências. SQLSTATE 42501 e 22023 são erros de fixture; parser e cleanup são
erros de harness; 40P01 é risco real da ordem SQL reproduzida por staging sintético.
Cinco regressões não executadas são lacunas de cobertura, não FAIL observado.
Divergência local/externo é incompatibilidade de contratos por inspeção, fora da
correção de política autorizada. Nenhuma conversão retroativa de FAIL para PASS.

## Manifesto desta sessão

Três arquivos de testes existentes, anteriormente untracked:
- supabase/tests/single_item_work_claim.test.sql: resolver OID privado antes de
  authenticated; release b2 sem attempt. Mesmas 55 asserções e guardas.
- supabase/tests/single_item_concurrency.py: decoder t/f estrito; close tolera somente
  EPIPE de stdin após saída e tenta fechar todos os streams; outros erros continuam
  FAIL e coleta de cleanup de backends permanece obrigatória.
- supabase/tests/single_item_concurrency_test.py: seis testes novos, incluindo
  subprocesso Python local para reproduzir flush EPIPE, parser inválido/false e
  erros de outros streams que não podem ser mascarados.

Documentos existentes receberam apenas adendo: PRD, Plano 043 e protocolo de
concorrência. Novos: este registro; [delta exato](2026-10-09-single-item-fixtures-runner.diff)
contra bytes pré-sessão (não contra HEAD); [Plano 044](../planos/044-single-item-lock-order-proposta.md)
e seu [rascunho SQL](../planos/044-single-item-lock-order-proposta.diff).
Nenhum arquivo em supabase/migrations ou supabase/bootstrap foi editado. Rascunho
SQL referencia corpos históricos para revisão; não aplicar a migrations antigas.

## Testes e limites

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p single_item_concurrency_test.py -v`:
31 PASS. Rodada proporcional final `-p 'single_item*_test.py'`: 42 PASS em três
módulos (31 runner, 7 preflight, 4 recovery). Sem flakes ou falhas nesta sessão.
A primeira rodada focal integra a final; não somar como 73 casos distintos.
Contagem estática TAP antes/depois: 55/55. 1108 arquivos de migrations/bootstrap/
web-orchestration/core-orchestration comparados por SHA256, nenhum alterado.
Typecheck/Jest/build não executados: nenhum TypeScript ou código de aplicação mudou.
Nenhum teste offline comprova PostgreSQL, SQLSTATE futuro, deadlock eliminado ou ACL.

## Segurança e retomada

Sem Docker/start/stop, SQL, migrations aplicadas, reconstrução, consulta residente,
INV-11, Host, provider/compute pago, credenciais, staging/commit/push/reset/clean/prune.
Gate single_item_atomic_claim_unavailable intacto; WIPs e 46 worktrees preservados.
Não atualizar pacote congelado de bootstrap antes de aprovar nova migration/hashes.

BLOCKED_BY_HUMAN_DECISION: revisar correções e rascunho/compatibilidade de locks.
Próximo ponto exato: matriz do Plano 044 — completar auditoria dos caminhos mutantes
(inclusive orçamento/reconciliação/retomadas/FKs), revisar serialização e precedência
de erros; reformular cinco fixtures com triggers ativos e expectativas preservadas.
A implementação SQL depende de nova autorização, assim como novo ambiente/provas.
Pare antes de SQL de produção; nenhum aceite de atomicidade ou promoção do gate.

## Git final e verificação de fechamento

Git Windows --no-optional-locks: dev e HEAD inicial preservados; índice vazio;
19 arquivos versionados modificados, 115 entradas untracked agregadas (+4 documentos
novos desta sessão), 46 worktrees registradas. git diff --check exit 0. Arquivos
de teste/documentação já untracked continuam untracked; nenhuma atualização de índice.
