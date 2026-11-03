# 051 — Executor PostgreSQL integrado ao comparador 050

2026-10-09; implementação e validação exclusivamente offline. Resolve o bloqueio
de integração registrado na [retomada](../registros/2026-10-09-single-item-retomada-bloqueio-executor.md).
Segue os planos [050](050-single-item-catalog-comparator.md) e [049](049-single-item-budget-lock-candidate.md).

## Caminho efetivo e substituição

A campanha arquivada executava `apply_variants.py`, importando `live_common.py`.
Este fornece check/read_json/sql/write, valida identidade/recursos/full-ID/socket,
e assume bootstrap completo. apply_variants era o único gate anterior às provas:
assinaturas regprocedure textuais, hashes, atributos, ownership/ACL/RLS/policies/triggers.
Os dois arquivos históricos continuam intactos como evidência.

O adapter corrente é [single_item_postgres_executor.py](../../supabase/tests/single_item_postgres_executor.py).
`run()` é a entrada única de aplicação/gate das três variantes; usa o transporte
existente por injeção. `bind_existing_transport(namespace)` vincula exatamente
check/read_json/sql/write e resultado B, sem importar/executar o antigo launcher.
Não cria conexão, container ou outra rota de comparação. Funções importadas não
executam SQL; chamadas live somente durante campanha novamente autorizada.

**Na próxima campanha substituir a chamada ao antigo apply_variants por run**;
nunca executar o adapter histórico ou importar o live_common arquivado com seu
argv/path/container antigo. O contexto do transporte deve ser o novo cluster,
identidade/isolamento/nonce/ledgers já validados pelo bootstrap. Check é chamado
antes de coleta e dispatch. O adapter recusa bootstrap incompleto e os cinco
containers históricos, incluindo2073d5af...; não reaproveitar scripts com contexto
histórico. Esta integração não implementa provisionamento nem amplia autoridade.

## Gate preservado e fortalecido

- Pins externos dos três manifests 050 e todos os arquivos verificados antes de
  SQL. Slot/receita 272/+1/+2 e bootstrap556 obrigatórios, inputs comuns idênticos.
- Pin externo dos arquivos do adapter e do comparador efetivamente importados:
  implementações stale/frozen diferentes são recusadas antes do transporte.
- Scanner raw verifica hash esperado independentemente das fontes; tipos de
  argumentos e namespace/nome resolvidos pelo comparador existente, depois OID.
  Tipo de retorno canônico e set-returning derivados do header fonte; funções
  ausentes/extra/duplicadas/ambíguas e tipos desconhecidos recusados.
- Antes das extras validar todas as161 funções do baseline e atributos obrigatórios
  owner/ACL/securityDefiner/search_path/volatility/parallel/strict/leakproof/cost/rows,
  pg_get_function_arguments e result contra referência arquivada revisada. Inputs
  names/defaults são cobertos pelo registro completo de argumentos; OIDs de retorno
  e estrutura de argumentos também capturados explicitamente.
- Após cada extra resolver todas as161 funções e conferir expectedProsrc raw do
  manifesto correspondente. OIDs devem permanecer iguais no MESMO cluster.
  Todos os campos capturados, salvo prosrc, permanecem idênticos, incluindo modes,
  names/allArgumentTypeOids/defaults, language/kind/support/returnSet. Mudanças de
  prosrc devem ser exatamente as2 ou4 permitidas nos contratos, com hashes finais
  derivados das fontes. Nenhum matching por hash ou assinatura textual.
- ACL/grants originais comparados estritamente; baseline RLS/policies/triggers
  contra referência pinada e preservados após cada migration. Coleta dessas guardas
  reutiliza a consulta histórica, sem segunda implementação de comparação de corpo.
- Query por OID centralizada em single_item_catalog_compare; snapshot contém tipos
  e funções no mesmo SELECT, arrays ordenados por OID. Nenhuma conversão de newline.
  Não confundir schema enforcement com compilação ou exercitação das políticas.
- SourceSha256 e payloadSha256 de BEGIN/source/COMMIT registrados antes de dispatch;
  transporte recebe exatamente os bytes calculados. Bootstrap conserva seus
  receipts/ledgers existentes: o adapter não apresenta hash de template congelado
  como receipt de outro nonce. Nenhum dispatch nesta sessão.

GO_CATALOG_ONLY nunca aprova comportamento, deadlocks, orçamento, pgTAP ou promoção.
Falha de catálogo impede alcançar as provas funcionais. A captura após aplicação
pode detectar discrepância apenas depois do DDL no descartável; nunca implica
aplicação no residente nem recuperação automática para obter PASS.

## Prova offline reproduzível

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'bootstrap*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 supabase/tests/single_item_postgres_executor_test.py --archive-replay
```

O replay usa o MESMO run/compare e um transporte fake, sem subprocesso/SQL/Docker;
verifica efetivamente os2475 arquivos e pins. Corpos/ownership/ACL/argumentos e
RLS/policies/triggers baseline vêm do catálogo arquivado da campanha real.
**Metadados canônicos de tipos não coletados na campanha antiga são sintéticos**;
after snapshots das candidatas são modelados a partir das fontes congeladas,
não observações PostgreSQL. Essa complementação é declarada no teste e no JSON
final; não prova funcionamento da query nem aplicação das candidatas.

Testes negativos: corpo alterado/CRLF convertido, função ausente/extra/ambígua,
tipo de argumento/retorno divergente, alteração de owner/ACL/secdef/defaults/names,
RLS/policies/triggers, mudança de corpo não autorizada, candidata noop, atributos
obrigatórios ausentes, pin adulterado, bootstrap incompleto e container anterior.
Spy exige chamadas reais ao comparador; baseline adulterado é recusado antes de DDL.
O pin completo e alterações dos arquivos do pacote são cobertos por verify_manifest
usado no adapter e pelo verificador offline do pacote, sem mock no replay CLI.

[Diff completo e evidências](../registros/2026-10-09-single-item-executor-integrado-evidencias/).
Pacotes originais/revisados050 não sobrescritos. Overlay do executor corrente
pinado separadamente: eles contêm a versão antiga do comparador; não importar
acidentalmente a versão frozen sobre a revisão corrente. Harness ativo é o mesmo
para as três variantes, manifests/SQL continuam os050 correspondentes.

## Retomada exata, após revisão humana

1. Conferir pins/README do overlay e referências de atributos/guardas; importar o
   adapter/comparador da revisão051, não da cópia antiga dos pacotes050.
2. Repetir todo preflight 049/050: Git/WIPs/46worktrees,2475hashs,156migrations,
   bootstrap556, Docker/imagem pinada/recursos/DB/Auth/Vector independente. Nenhum
   snapshot desta sessão confirma saúde atual de Docker/residente.
3. Novos clusters sequenciais com limites049. Bootstrap272 e receipts/identidade/
   ledgers completos. Contexto fresco do transporte deve negar IDs anteriores e
   estar revisado; vincular suas funções por bind_existing_transport.
4. Carregar pins dos manifests e referências externas das evidências051. Invocar
   run(transport, roots, pins, slot, attributes, guards, implementation_pin).
   Não passar hashes calculados ad hoc da implementação corrente como aprovação:
   usar os pins revisados do checkpoint. Baseline sem extras, claim uma, combinado
   duas. Persistir snapshots/receipts/GO_CATALOG_ONLY ou NO-GO fora do container.
5. Só depois do gate executar toda matriz049:334pgTAP e quatro FAIL históricos
   visíveis, controles positivos naturais/adversariais, replay/retomada/release,
   revogação, orçamento, rollback/ACL/RLS/foreign-items/cleanup e contenção.
   Preservar SQLSTATE/locks/tempos e parar depois da comparação, sem promoção.

PostgreSQL real ainda deve validar query/coerência dos tipos/defaults/ACL, compile
PLPGSQL, fontes de bootstrap instaladas, controles naturais/negativos, semântica,
latência e isolamento. FKs/índices administrativos/recovery/multiowner e composição
com pré-locks não adquirem garantia global por este gate. Não remover Single-Item.


## Resultado final offline

144 testes Single-Item PASS, incluindo19 de executor;30 bootstrap PASS. Replay CLI: três GO_CATALOG_ONLY offline e três NO-GO negativos, sem SQL. Pacotes2475/migrations156/bootstrap556/protegidos3253 íntegros. Pins do executor e referências em executor-review.json das evidências; SHA256SUMS inclui diff/logs/snapshots. Git dev/HEAD6bc4aade/índice vazio,46 worktrees inalteradas. Critério instrumental de integração atendido offline; coleta/semântica PostgreSQL e campanha049 pendentes de revisão e preflight.


## Campanha autorizada — novo NO-GO antes de criar ambientes

[Registro/evidências](../registros/2026-10-09-single-item-executor-campanha.md): catálogo real arquivado279 versus manifesto161; igualdade final de inventário recusa118 funções adicionais legítimas. Fixture de replay filtrava o catálogo e não demonstrou essa condição. 144 testes PASS, artefatos íntegros e operação disponível não superam esse bloqueio. Nenhum Docker criado/SQL aplicado. Próximo passo exclusivamente instrumental: tratar inventário completo e funções adicionais com identidade/proveniência/atributos/hashes protegidos, provar negativos e revisar/pinar antes de repetir preflight.


## Contrato completo substituído pelo052

[Plano052](052-single-item-full-catalog-contract.md): mantém279 funções protegidas por identidade/body/atributos/proveniência, sem projeção.161 fontes e118 adicionais condicionadas a membership vector real (não arquivada). Novos pacotes052r2/schema3;153 testes Single-Item e30 bootstrap PASS, ensaio pipeline integral modelado. Usar novos pins/contrato e contexto fresco, após revisão/preflight. Antigos adapters/pacotes preservados.
