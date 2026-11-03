# Single-Item V1 — candidato localizado implementado offline

2026-10-09. Tipo: desenvolvimento offline; nenhuma prova PostgreSQL.
Objetivo: implementar migration incremental de início/liberação item→claim,
autorizada pelo usuário, preservando migrations históricas e residente.

Branch Windows `dev`; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit.
Inicial: 24 tracked modificados, 110 entradas untracked, índice vazio, 46 worktrees.
Final: 24 tracked modificados, 116 entradas untracked, índice vazio, 46 worktrees.
WIPs/worktrees preservados; Git Windows é fonte das contagens, sem staging/commit.

## Mudanças e decisão

[Plano 047](../planos/047-single-item-claim-lock-candidate.md) contém migration,
diff dos corpos, contrato congelado, testes e roteiro exato de prova comparativa.
Migration `20261009000000_claim_item_lock_order_candidate.sql` escrita, **não aplicada**.
Somente start_claimed_work_attempt/release_work_claim substituídos via OR REPLACE:
descoberta own-claim, lock own-item, releitura locked-claim, identidade/correlação,
auth/allowlist rechecadas, regras originais. Definições efetivas anteriores foram
obtidas varrendo todas as migrations; ambas vinham de 20260721000001.

Sem assinatura/retorno/atributos novos; owner/ACL esperados preservados pela
semântica OR REPLACE em função existente, a verificar no catálogo. Nenhuma mudança
em aquisição scoped/global, orçamento/classificação/transições ou gate.
Item/replay/liberação podem esperar antes; erros adicionais e limites de revalidação
sob MVCC estão no plano. Não declarar bug corrigido em PostgreSQL; candidato pronto
para revisão/prova, com risco residual alvo/budget/foco/recovery/FK/prelocks/multiowner.

Compositor offline prepara pacotes baseline/candidato independentes, com bootstrap,
harness e documentação comuns; só candidato contém migration extra. Valida hashes,
recusa output existente, não possui executor/rede. Identidades NULL exigem preflight
factual futuro. Bootstrap congelado versus corpus atual ainda exige reconciliação
manual de receita; não repetir migrations nem presumir equivalência de catálogo.
PRD/Plano 046 atualizados por adendo; inventário/diff 045 históricos preservados.

## Verificação

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'`:
**84 PASS**, exit 0, 5,602 s na execução completa final antes do último ajuste de
empacotamento de documentação. Após esse ajuste, os 11 testes do candidato/bundle
foram reexecutados: **11 PASS**, exit 0, 5,473 s. 73 anteriores + 11 novos.
Léxico/scanner/contratos aceitam duas funções; não compilam SQL/PLpgSQL ou provam RLS.

Primeira execução detectou três divergências de teste: inventário 045 esperava os
corpos antigos, comparação incluía espaços externos ao DDL e teste buscava P0001
no documento em vez do runner. Corrigidos os testes, sem afrouxar corpos/cenários:
o inventário verifica seus hashes baseline e admite apenas os dois candidatos
pinados, e teste específico exige restauração dos corpos originais. Outros hashes
continuam obrigatórios. Falhas iniciais não eram evidências de execução SQL.

Snapshot de 1.975 arquivos preexistentes de migrations/bootstrap/apps/packages/tests:
apenas single_item_lock_review_test.py alterado para acomodar o baseline histórico
e o candidato pinado. 154 migrations históricas íntegros por hash; fixtures/runners
SQL/concurrency e código governado íntegros. 123 propriedades históricas e 55
Single-Item preservadas pelos gates; não são novos PASS pgTAP. Divergência de
orçamento local/externo permanece separada, sem mudança de política.
Flakes offline: nenhum observado; nenhum claim/banco factual inspecionado.

## Fronteira humana e retomada

BLOCKED_BY_HUMAN_DECISION: revisar migration/diff e Plano 047. Implementação offline
foi autorizada e concluída; aplicação SQL/criação de ambientes não estão autorizadas.
Próximo passo exato: revisão humana, reconciliação/autorização da receita bootstrap,
identidades/isolamento de dois destinos, então matriz baseline/candidato 046/047.
Negativos de deadlock e P0001 de orçamento continuam obrigatórios; sem retry que
oculte 40P01. Candidato PASS localizado não libera gate/produto automaticamente.

Nenhum Docker/container/SQL/banco residente/Resident Host/INV-11/compute pago/API,
staging/commit/push/reset/clean/prune ou efeito externo/publicação. Gate
`single_item_atomic_claim_unavailable` mantido. Produção permanece NO-GO.
