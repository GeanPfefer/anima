# Single-Item — contrato completo279 e ensaio offline

2026-10-09; análise/harness/manifests/testes offline. [Plano052](../planos/052-single-item-full-catalog-contract.md)
contém política, limites de evidência e procedimento exato; [diff/pins/inventário/logs](2026-10-09-single-item-catalogo-completo-evidencias/).
Corrige a falha da [campanha anterior](2026-10-09-single-item-executor-campanha.md).

Branch Windows dev, HEAD inicial/final6bc4aadef9414d655600c2ea37c6be436b3628c8,
índice vazio, nenhum staging/commit/push/reset/clean/prune.46worktrees preservadas.

Inventário completo279, nunca filtrado:161 de aplicação reconciliadas às fontes;
118 adicionais em public/owner supabase_admin,114 entrypoints e4 aggregates,
compatíveis com vector0.8.0. Infraestrutura adicional independente:0 identificada.
**Membership não consta das evidências antigas**: classificação como extensão é
condicional à coleta real pg_depend. Namespace/nome não excluem da auditoria.
Módulo/kind esperado também não é observação arquivada; nenhuma certeza inventada.

Todos279 são protegidos por identidade/retorno/OID/body/atributos e ACL. Aplicação
exige membership vazia;118 adicionais exigem vínculo vector e objeto/dependência
coerentes, versão e módulo/kind esperados. Unknown/extra/ausente/ambígua/adulterada
recusadas. Um só core de comparação reutilizado; igualdade final279 permanece,
somente as2/4 diferenças de corpo de aplicação autorizadas nas candidatas.

Collector ampliado: extensões/membership/objetos/dependências/aggregates,
constraints/FKs, índices/flags, schemaACL, event triggers e roles/memberships,
além de funções/RLS/policies/triggers anteriores. Novas estruturas sem arquivo
histórico são capturadas no baseline confiável e preservadas após extras;
metadados modelados no teste são explicitamente rotulados como tal.

153 testes Single-Item PASS (186,584s), incluindo28 do executor;30 bootstrap PASS
(10,874s). Ensaio completo: pacote/pins→272 fontes/wrappers/ledger modelados→0/1/2
extras pelo transporte fake→coleta279 simulada→mesmo executor/comparador→preparação
de fixtures→13 suítes/334 asserções renderizadas. Três GO_CATALOG_ONLY offline,
10 cenários negativos NO-GO, nenhuma query ou fixture executada. Bodies/atributos
reais do arquivo antigo usados em todas279; campos inexistentes e after candidatas
são modelos explícitos. Não é evidência PostgreSQL de membership ou segurança.

Negativos: aplicação extra, aplicação escondida em extensão, extensão com body/ACL/
module/membership/admissão/assinatura/OID adulterados ou ausente, corpo de aplicação
divergente; testes também cobrem guardas novas, pins e bootstraps incompletos.
As334asserções e quatro FAIL históricos não alterados, corrigidos ou reexecutados.

Revisão052r2:2484arquivos (827/828/829), schemaVersion3 com contrato completo por
path/hash; mesmas receitas272/+1/+2. Originais2469, revisão0502475 e052r1 intermediária
preservados. Nenhuma migration, payload canônico ou SQL de fixture foi editado.
Metadata diff/manifest pins e integridade finais no diretório de evidências.

Mudanças: comparador/core/coleta, adapter/classificação e proteção do conjunto
completo, fixture de replay sem projeção, compositor/schema3, contrato JSON e
artefatos/pins/docs052. PRD/051 recebem ponteiros de retomada. Typecheck/build TS
não executados: nenhum TS/schema de produto modificado.

Nenhum Docker, SQL, container, banco/residente, INV-11, Resident Host, serviço ou
compute/API paga nesta sessão. Estado atual residente não consultado; gate
single_item_atomic_claim_unavailable ativo. Não alterar políticas ou execução
governada para resolver falhas do harness.

Próxima etapa: revisão humana do052r2 e preflight integral049/052. Novos ambientes
com limites anteriores, bootstrap272/identidade/receipts/ledger, coleta REAL completa
com membership/module/objetos, gate e só então matriz funcional334/concurrency/
revogação/replay/orçamento/rollback/ACL/RLS/cleanup/contenção. Query/membership,
estruturas novas, fixtures/MVCC e semântica/segurança só podem ser provadas em PG.
Não retomar adapters ou contextos antigos. Não promover candidatas nem retirar gate.
Parada após validação offline.


Integridade final PASS:2484 novos arquivos,2475 anteriores e2469 originais preservados,156migrations/556bootstrap/3253arquivos protegidos sem drift; quatro arquivos de evidencia historica do contrato conferidos. Git final:dev/mesmo HEAD/indice vazio/25tracked modificados preexistentes/158untracked agregados/46worktrees com metadados identicos. SHA256SUMS e review.json preservam pins finais.
