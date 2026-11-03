# Single-Item — retomada parada no preflight de integração

2026-10-09; diagnóstico e validação offline. **NO-GO instrumental antes de criar
ambientes**, conforme mandato desta retomada. [Plano 050](../planos/050-single-item-catalog-comparator.md),
[matriz exigida 049](../planos/049-single-item-budget-lock-candidate.md).

Branch Windows dev; HEAD inicial/final 6bc4aadef9414d655600c2ea37c6be436b3628c8.
Índice vazio, 25 tracked modificados preexistentes. Estado inicial dos WIPs e
metadados das 46 worktrees exatamente iguais ao checkpoint anterior, confirmado
por igualdade dos arrays status/worktrees. [Snapshot inicial](2026-10-09-single-item-retomada-bloqueio-executor.json).
Nenhum staging, commit, push, reset, clean, prune ou alteração de worktrees.

## Bloqueio confirmado

Busca pelos usos de single_item_catalog_compare/catalog_read_query e expectedIdentities nas fontes Python de testes, scripts
e adapter arquivado identificou apenas compositor e testes offline.
`supabase/tests/single_item_catalog_compare.py` declara explicitamente interface
sem executor; `single_item_budget_lock_proof.py` só renderiza coreografia.
O adapter histórico `2026-10-09-single-item-combinada-prova-evidencias/apply_variants.py`
continua indexando funções por signature textual e comparando expectedProsrcSha256
por essa chave. Não chama compare/resolve/catalog_read_query/verify_manifest.
Seu gate de atributos/ACL/RLS/triggers não foi integrado à resolução canônica nova.

O plano 050 já registra esta integração como pendente. Pacotes revisados corrigem
metadados e disponibilizam o comparador, mas não certificam um executor live
integrado. Prosseguir criando clusters violaria o item 9 do preflight solicitado.
Nenhum adapter histórico foi executado ou alterado; nenhum SQL de produto foi
improvisado. Ausência de integração não é falha empírica das migrations candidatas.

## Matriz desta retomada

| Evidência | Baseline | Item/claim | Combinado |
|---|---|---|---|
| Novos ambientes | não criado | não criado | não criado |
| Bootstrap real | não executado | não executado | não executado |
| Migration adicional | nenhuma aplicada | não aplicada | não aplicada |
| pgTAP | 0/334 executadas | 0/334 executadas | 0/334 executadas |
| Deadlock/SQLSTATE/waits | não medidos | não medidos | não medidos |
| Concorrência/replay/retomada/ACL/RLS | não executados | não executados | não executados |
| Desempenho/starvation | não medidos | não medidos | não medidos |

13 testes adversariais do comparador PASS (0,796 s). Resultados históricos de
125+30 testes não reclassificados como execuções desta retomada. Quatro FAIL
históricos local/externo permanecem visíveis, não reexecutados nem convertidos
em PASS. Sem novo 40P01 ou SQLSTATE: não houve execução SQL.

Docker/imagem/recursos/DB/Auth/Vector não inspecionados nesta retomada após o
bloqueio anterior de integração; saúde atual não confirmada. Nenhum serviço,
container, rede, volume ou dado residente tocado. Não inferir saúde de snapshot
histórico. Gate Single-Item permanece ativo; nenhum INV-11, Resident Host,
API paga/compute externo ou mudança de migrations/políticas/expectativas.

## Ponto mínimo de retomada

Preparar e revisar um executor live separado das evidências históricas: integrar
verify_manifest e recebimentos de source/payload, snapshot de tipos/OIDs, compare
com atributos esperados obrigatórios, identidade canônica de argumentos/retornos
incluindo defaults, ownership/ACL/grants, RLS/policies/triggers/FKs/índices antes e
depois das extras. Testes offline de integração devem provar que ele chama os gates
e recusa adulterações antes de qualquer DDL. Congelar/pinar a revisão do executor
sem sobrescrever pacotes/evidências. Depois repetir preflight integral e executar
matriz 049 em novos clusters sequenciais com identidade/isolamento validados.

Recomendação: NO-GO da campanha nesta sessão; segurança combinada indeterminada.
Parada para revisão humana conforme instrução de bloqueio instrumental. Apenas
registro e ponteiros de retomada alterados nesta sessão.


Integridade offline desta retomada: 2475 hashes dos pacotes revisados e respectivos pins externos PASS; contrato das 156 migrations PASS; 556 hashes de bootstrap PASS. Nenhuma divergencia de bytes detectada. A integridade dos artefatos nao elimina o bloqueio de integracao.
