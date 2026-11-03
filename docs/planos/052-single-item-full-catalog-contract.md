# 052 — Contrato completo do catálogo Single-Item

2026-10-09; correção de harness e ensaio exclusivamente offline. Substitui o
inventário incompleto do [051](051-single-item-executor-catalog-integration.md),
sem alterar SQL de produto. [Falha recuperada](../registros/2026-10-09-single-item-executor-campanha.md).

## Inventário e limite de evidência

[Contrato/inventário279](../../supabase/tests/fixtures/single_item_full_catalog_contract.json)
contém OID histórico, assinatura arquivada, identidade canônica/schema, owner,
atributos, hash raw e origem por objeto. OID arquivado serve para reconciliar esta
observação; nunca é pin de outro cluster. Evidências arquivadas usadas possuem hashes.

| Grupo | Quantidade | Evidência e tratamento |
|---|---:|---|
| Aplicação |161| definição efetiva das migrations congeladas, raw prosrc e atributos arquivados; corpo esperado varia somente por manifesto |
| Adicionais compatíveis com vector |118| public, owner supabase_admin;114 entrypoints e4 aggregates avg/sum de vector/halfvec; versão vector0.8.0 observada |
| Infraestrutura adicional comprovada em public/private |0| nenhuma identificada fora desse conjunto; não inferir membership por ausência |

A origem das118 é **compatível com vector**, mas a membership individual NÃO foi
coletada na campanha antiga. Não há SQL/control da extensão congelado nem pg_depend
arquivado para demonstrar a atribuição por função. O prerequisite pinado cria vector
em public sob supabase_admin; signatures/corpos/owner/tipos do grupo são evidência
adicional, não substituem pg_depend. A classificação do contrato é
`extension-membership-required`, com vector como vínculo esperado e verificação
real obrigatória. O inventário deixa essa lacuna explícita; não classifica por nome,
prefixo ou schema, nem transforma uma inferência em membership observada.

Os4 aggregates têm prosrc aggregate_dummy;114 outras funções têm entrypoints C
compatíveis com vector. Módulo esperado `$libdir/vector`/kind f ou aggregate kind a
não são campos observados no arquivo antigo: são requisitos a verificar na coleta.
Se a evidência real contrariar a origem esperada, NO-GO, sem ajustar política para
aceitar nomes semelhantes. Não ignorar objetos adicionais para obter PASS.

## Contrato único e coleta

Adapter/comparador existentes permanecem a única rota de verificação. Core
compare_function é extraído do compare original, reutilizado por ambas as classes;
compare mantém a validação separada de source/payload. Não há matching paralelo.

1. Aplicação161: fonte raw/hash/prosrc/owner/ACL e atributos completos, identidade de
   argumentos/retorno por tipos/OID. Membership de extensão deve ser vazia, inclusive
   para match_entries que usa tipo vector. Corpo controlado pelo manifesto da variante.
2. Adicionais118: allowlist de identidades completas, hash raw arquivado, retorno,
   owner/ACL/atributos, módulo/kind e membership exata vector. Todos protegidos;
   desconhecida, removida, ambígua ou sobreposta à aplicação gera NO-GO.
3. Extensões: conjunto e versões das9 extensões arquivadas obrigatórios. Collector
   coleta pg_extension/schema/owner/OID e pg_depend deptype e/classid pg_proc/
   refclassid pg_extension/objsubid0. Membership da função deve concordar com o
   inventário de objetos. Não aceitar vínculo declarado só pelo nome da função.
4. Objetos/dependências/pg_aggregate, versões e atributos das extensões preservados
   antes/depois; RLS/policies/triggers, constraints/FKs, índices/flags, schemaACL,
   event triggers, roles e memberships também capturados e preservados. Baseline
   RLS/policies/triggers têm referência independente arquivada. Campos estruturais
   novos sem referência arquivada são capturados no baseline bootstrap confiável e
   comparados após extras; não declarar aprovação histórica desses campos.
5. Conjunto279 completo obrigatório em public/private. Igualdade final agora compara
  161+118 resolvidos com TODAS as funções coletadas. Não há projeção filtrada.
   Outras namespaces de funções não entram nesse número; objetos de todas as
   extensões são capturados, mas isso não é auditoria universal de corpos externos.
6. Pins de código/contrato/manifests e source/payload preservados. CREATE OR REPLACE
   permite somente2/4 corpos de aplicação; todo restante, inclusive adicionais,
   permanece igual no mesmo cluster, sem pins de OIDs históricos entre clusters.

Extensão adulterada por troca de body/ACL/module/membership/identidade/versão é
recusada. Aplicação não pode esconder-se como extensão. Campos ausentes são NO-GO.
GO_CATALOG_ONLY nunca equivale a segurança global, compilação ou prova funcional.

## Revisão dos pacotes e ensaio

Pacotes2469 originais e2475 revisados050 permanecem intactos. Novos pacotes
`.tmp/single-item-budget-lock-proof-20261009-052-full-catalog-r2`, schemaVersion3,
827/828/829 arquivos,2484total, compartilham o mesmo contrato e harness. Revisão r1
intermediária preservada; r2 inclui proteção adicional de dependências/aggregates,
roles/event triggers/index flags. Receitas272/+1/+2,556bootstrap e334asserções
(incluindo quatro FAIL históricos) inalteradas. Metadados de catálogo apontam o
contrato full por path/hash; migrations e payloads canônicos não editados.

[Diff, pins, inventário, logs e ensaio](../registros/2026-10-09-single-item-catalogo-completo-evidencias/).

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'bootstrap*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 docs/registros/2026-10-09-single-item-catalogo-completo-evidencias/offline-pipeline.py
```

Ensaio: verifica arquivos/pins; compõe e reconcilia272receipts/ledger MODELO sem SQL;
aplica previstas0/1/2 migrations por transporte fake com bytes/hash exatos; coleta
simulada integral279; executor→comparador→GO/NO-GO; renderiza preparação de fixtures
com aprovação/classificação/routing e cenários naturais/adversariais; prepara13
suítes/334pgTAP com rollback e sem bypass. Não executa nenhum deles no PostgreSQL.

Corpos/atributos/ACL/guardas antigas são reais arquivados, sem filtragem. Tipos/OIDs
canônicos ausentes, memberships/módulos/estruturas novas, after snapshots candidatas,
ledger e fatos de fixtures são **modelados**, marcados no JSON. O ensaio prova o
fluxo do harness com contrato completo e negativos, não observação dos dados faltantes.

## Próxima campanha — procedimento exato após revisão humana

1. Revisar diff/pins052, inclusive a classificação condicional das118. Verificar
   catálogo/contrato completo e modelos, sem executar adapters/slots antigos.
2. Usar apenas os três pacotes r2 e seus pins em bundle.json. Importar adapter/
   comparador da mesma revisão e implementationHashes de review.json (inclui
   full contract). Recusar cópias antigas051/050. Referências originais de atributos
   de aplicação/RLS permanecem as051 pinadas; não alterar owner/ACL para conseguir GO.
3. Preflight integral049: Git Windows/WIPs/46worktrees,2484novos hashes e antigos,
  156migrations,556bootstrap, Docker/imagem/recursos/DB/Auth. Vector só com nova
   prova de independência. Proibir todos os containers e clusters históricos.
4. Novos três ambientes sequenciais, limites049. Bootstrap272 com novo nonce e
   source/template/dispatch receipts/ledgers. Contexto novo do transporte validado;
   bind_existing_transport e run usam raízes/pins r2 e mesmo contrato.
5. Coletar baseline REAL completo279, tipos, pg_depend/extensionObjects/módulos/
   aggregates e guardas. Validar origem esperada, versão e memberships individuais
   antes das extras. Ausência/contradição ou query inválida: NO-GO, evidência, sem
   corrigir produto/expectativas durante a prova. Persistir novos campos observados.
6. Aplicar somente receitas0/1/2 e exigir full gate/identidades/ACL/RLS invariantes.
   Apenas depois executar toda matriz049:334pgTAP e quatro FAIL históricos visíveis,
   deadlocks naturais/adversariais, replay/retomada/release/revogação/foreign claims/
   orçamento/rollback/cleanup, SQLSTATE/waits/tempos e contenção comparável.
7. Preservar evidências externas/hashs e estado do residente, encerrar somente os
   criados nesta campanha sem remover históricos, parar para revisão. Não promover
   migrations nem retirar gate, não iniciar INV-11/Resident Host.

Pendências PostgreSQL: compilação da coleta, memberships/módulos/classificação
reais, estruturas não arquivadas, defaults/overloads/casts/MVCC, fixtures e controles
positivos, autorização/ACL/RLS efetiva, semântica e contenção. Não são falhas
previsíveis de cardinalidade do harness; são verificações reais ainda necessárias.


## Resultado final offline

153 testes Single-Item PASS (186,584s);30bootstrap PASS (10,874s). Pipeline r2:279functions,272bootstrap previstos,334pgTAP preparados,3GO_CATALOG_ONLY modelados e10NO-GO negativos.2484novos arquivos/156migrations/556bootstrap/3253protegidos integro; antigos intactos. Git dev/HEAD6bc4aade/indice vazio/46worktrees preservadas. Nenhum Docker/SQL nesta sessao.


## Prova real autorizada — parada antes de initdb

[Registro](../registros/2026-10-09-single-item-052-prova.md): único baseline novo, guard kernel recusou fonte/dev/sdd dos mounts Docker hosts/hostname/resolv.conf porque espera/dev/sde. Restante rootRO/tmpfs/config conferido; sem relaxar guard.0/272 SQL, sem catálogo ou membership real,0/334 asserts em todas variantes. Novo26d5e1d5599d1baee3dda2b8777240b499118a449f3d08ee4f4e0af909407e10 encerrado, clusterNone, sem remover; DB/Auth preservados. Próximo passo offline é guard de proveniência/isolation pinado e testes, não reconstruir comparador ou alterar migrations.


## Guard Docker corrigido offline — checkpoint

[Registro/diff/pin](../registros/2026-10-09-single-item-guard-docker.md): origem gerada por CID/arquivo cruzada inspect/kernel, ext4/major8/dispositivo sd variável porém consistente, RO estrito; demais controles preservados. Não editar pacotes r2 congelados: importar guard revisado e registrar guard-review.json no novo contexto. Revisão humana antes de nova criação; seguir procedimento de retomada no registro. Nenhum Docker/SQL nesta correção.


## Prova real após guard — catálogo GO, funcional parcial

[Registro](../registros/2026-10-09-single-item-guard-prova.md): dois clusters independentes272/272,279GO integral e118memberships individuais vector0.8.0; item/claim delta somente2 corpos.330/334PASS por variante com4FAIL históricos. Dois controles naturais do candidato bloqueados por Broken pipe após55000 e retorno0 do runner; combinado não criado. NO-GO da comparação/promoção. Novos e98c9c4d... e2bead858... encerrados (IDs completos/cluster no registro), nunca reutilizar. Corrigir sessões/FAIL offline antes de novo preflight/revisão; contrato/comparador052 não reconstruir.


## Continuidade do runner natural

[Plano053](053-single-item-natural-session-results.md) corrige offline a coleta A/B e propagação dos dois FAIL instrumentais, sem modificar contrato052/pacotes/migrations.170Single-Item/33bootstrap PASS. Usar rota053 pinada para dois cenários, nunca evidências antigas como runner atualizado. Prova real/revisão/autorização posterior pendentes; resultados anteriores indeterminados preservados.
