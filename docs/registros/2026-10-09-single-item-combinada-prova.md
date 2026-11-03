# Single-Item V1 — comparação combinada interrompida na integridade do catálogo

2026-10-09; prova PostgreSQL parcial. **NO-GO por defeito do harness/manifests**;
segurança da correção combinada não avaliada. Não é uma reprovação empírica do
SQL candidato. [Plano 049](../planos/049-single-item-budget-lock-candidate.md).
[Artefatos individuais](2026-10-09-single-item-combinada-prova-evidencias/).
Branch Windows dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Nenhum staging, commit, push, reset, clean ou prune; WIPs/worktrees preservados.

## Preflight e alcance autorizado

Conferidos 2.469 hashes dos três pacotes, seus três manifests arquivados e 556 hashes
do bootstrap: zero drift. As 156 migrations atuais coincidem com o contrato (155
anteriores + candidata nova), sem alterações nesta sessão. Git inicial: 24 tracked
modificados, 138 entradas untracked agregadas, índice vazio, 46 worktrees.
Manifests/corpos propostos indicam somente duas substituições original→item/claim,
quatro item/claim→combinado, união de cinco original→combinado. Harness/fixtures
congelados comuns; não foram alterados. Novos adaptadores live estão neste registro
como instrumentos separados e suas falhas permanecem arquivadas.

Docker disponível, daemon `18caadf3-1887-45ef-857e-4e71fcef77e9`, versão 29.8.2,
16 CPUs/8.259.198.976 bytes. Host livre 7.806.268 KiB; uso aproximado dos containers
1.707.511.644 bytes. Banco/Auth healthy. Imagem local pinada
`sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`,
ambiente/labels conferidos, sem pull. Exceção Vector preexistente admitida somente
operacionalmente: fonte docker_host/docker_logs falha TCP NetworkUnreachable OS101,
restart loop (contador inicial 127), sem mounts ou rede compartilhados com provas,
sem pressão relevante no snapshot do host. Não classificado como saudável.
Nenhum início/restart/configuração de serviços residentes efetuado.

Quatro descartáveis anteriores inspecionados por metadados e IDs completos,
encerrados, network none; nenhum reutilizado, iniciado ou removido. Nova criação
somente após GO operacional e integridade offline dos bytes. A falha de metadados
de hash de função surgiu na verificação real depois do bootstrap; parou a campanha
antes de pgTAP ou criação das outras variantes. O GO operacional não é GO da prova.

## Matriz desta sessão — nenhuma inferência de resultados anteriores

| Prova | baseline | item/claim | combinado |
|---|---|---|---|
| Ambiente criado | um novo, depois encerrado | não criado | não criado |
| Bootstrap congelado | 272/272, ledger reconciliado | não executado | não executado |
| Migrations adicionais | nenhuma | não aplicadas | não aplicadas |
| Catálogo esperado | 161 identidades resolvidas; 108 raw hashes coincidem, 53 divergem por CRLF | não medido | não medido |
| 334 asserções pgTAP | **0 executadas** | **0 executadas** | **0 executadas** |
| Deadlock item/claim natural/adversarial | não executado | não executado | não executado |
| Deadlock item/orçamento natural/adversarial | não executado | não executado | não executado |
| Concorrência, retomada, revogação, orçamento | não executado | não executado | não executado |
| Contenção, throughput, starvation | não medidos | não medidos | não medidos |
| Resultado | NO-GO de catálogo/harness | bloqueado pela integridade | bloqueado pela integridade |

Não houve 40P01 nem outro SQLSTATE de teste nesta sessão: os testes não começaram.
A falha é RuntimeError Python, sem SQLSTATE; consultas diagnósticas concluíram.
O bootstrap não valida o comportamento das funções. Quatro FAIL históricos
local/externo (1,2,6,10; 8/12 nessa suíte, 330/334 nos dois slots anteriores) continuam
visíveis nos pacotes/manifests, **não reexecutados, corrigidos, convertidos em PASS
ou misturados com esta matriz**. Resultados prévios item/claim permanecem no registro
anterior; combinado ainda não tem prova PostgreSQL funcional.

## Defeito confirmado e evidências

1. `apply_variants.py` parou em `effective body mismatch match_entries(vector(768),float,int)`.
   O runner comparava strings do manifesto com `regprocedure::text`: typmod vector(768),
   aliases float/int e timestamptz são apresentados canonicamente pelo catálogo.
   Não era suficiente acrescentar schema public à string. Stderr original em
   `baseline/variants-runner.stderr`, catálogo antes em `baseline/variants/catalog-before.json`.
2. Diagnóstico **somente leitura**, `to_regprocedure` com search_path explícito
   pg_catalog/public/private/extensions, resolveu as 161 identidades aos OIDs reais.
   Não alterou nenhum hash esperado; salvou mapping e comparações em
   `baseline/signature-diagnostic/`. OID normaliza identidade de tipos, não concede
   licença para aceitar um corpo diferente.
3. Depois de resolver identidade, **53/161 hashes brutos prosrc realmente diferem**.
   O scanner/compositor usa `Path.read_text()`, que normaliza CRLF para LF; os
   manifests expectedProsrcSha256 desses corpos foram calculados com LF. O bootstrap
   preserva os bytes congelados, e PostgreSQL registra CRLF nesses corpos.
4. `baseline/body-diagnostic/raw-prosrc.json` preserva prosrc bruto via JSON com
   escapes CRLF. `line-ending-comparisons.json` registra por função hash esperado,
   raw observado, normalizado e fonte. **Todas as 53 divergências são explicadas
   somente por CRLF→LF, zero divergências inexplicadas**. A reconciliação offline
   adicional prova que cada corpo raw observado corresponde exatamente à seção
   CRLF da fonte congelada, em `raw-source-reconciliation.json`. Nada foi normalizado
   ou reescrito para fazer o gate PASS; o resultado original permanece FAIL.

Inclui leitores, triggers, budget/routing e duas retomadas. Os hashes de arquivo
conferem mesmo assim: integridade dos arquivos não certifica que um manifesto de
hash de **prosrc** represente a mesma convenção de bytes que PostgreSQL. Não foi
uma troca de imagem, migration, política ou conteúdo semântico demonstrada. O
manifesto de artefatos tem um defeito verificável e o gate estrito não pode passar
com seus hashes atuais. A falha não deve ser rotulada como defeito das quatro funções.

## Identidade, isolamento e encerramento

Baseline novo: container completo
`2073d5af7365cb6a37d99df2a87f7505a63e2489f9d10062b295c540ec738305`;
cluster `7694595591914635392`; nonce `ec5b0f1923ce4953adc79476d505130d`;
banco `anima_single_item_proof_ec5b0f1923ce4953adc79476d505130d`.
Kernel mounts/ownership/namespace e identidade/cluster validados antes de SQL e
por etapa. 1 CPU/1 GiB sem swap extra/64 PIDs, rootfs RO, cap-drop ALL,
no-new-privileges, network none, sem portas/binds/volumes; tmpfs data512MiB/socket16MiB,
postgres UID105/GID106, env -i/psql -X/socket explícito/full ID. Sem credenciais residentes.
272/272 fontes/payloads conferidos antes de dispatch, read identity e ledger antes/
depois de cada etapa, sem retries de payload. A parametrização de runId muda somente
wrappers/ledger por nonce; as fontes de schema permanecem congeladas.

Catálogo/ledgers/logs arquivados fora do container antes do encerramento. Oito tabelas
sintéticas acompanhadas vazias, backends adicionais zero; pg_ctl fast stop somente
no container novo, exit final 0, sem OOM/restart/removal. Tmpfs perdido após parada,
como previsto. Qualquer futura retomada precisa de ambiente novo; **adicionar este
container/cluster à lista de não reutilização**, além dos quatro anteriores.

Comparação final de metadados: DB/Auth idênticos, saudáveis; nenhum preexistente
removido, rede/volumes idênticos. Somente State/RestartCount do Vector mudou devido
à policy automática preexistente. Não inferir saúde residente por uma consulta SQL:
nenhuma consulta a banco/dados residentes foi efetuada. Daemon/headroom foram
avaliados por snapshots, não por stress longitudinal ou prova universal de ausência
de pressão. Não há número de desempenho da correção combinada para reportar.

## Retomada mínima e recomendação

**NO-GO para continuar com os manifests atuais; correção combinada indeterminada.**
Revisar uma correção **offline apenas do compositor/catalog comparator**:

- Calcular expectedProsrcSha256 com a representação raw da fonte congelada, sem
  conversão universal de newline. Preservar todos os bytes das migrations e
  expectativas das 334 asserções, incluindo os quatro FAIL históricos.
- Resolver identidade por OID/tipos canônicos, respeitando schema/overload/typmod,
  sem associar funções diferentes porque seus corpos têm hashes iguais.
- Criar teste determinístico CRLF/LF e aliases, validar strict raw equality contra
  estas evidências, gerar **novos** três pacotes/manifests, sem sobrescrever os antigos.
- Revisão humana e retomada pelo preflight integral e novos descartáveis, com as
  mesmas receitas (272; +item/claim; +item/claim+budget) e matriz 049 completa.

Não editar SQL para corrigir esse problema de metadados nem trocar expectativas
por valores observados sem derivação independente das fontes. Não prosseguir com
normalização ad hoc escondida no runner. O diagnóstico não aprova a comparação
sem controles positivos/334 pgTAP/negativos/medidas previstos no plano.

Nenhum SQL candidato aplicado, serviço residente alterado, INV-11/Resident Host/
compute pago usado, política ou gate alterado. PRD/plano recebem ponteiros de
retomada; registros históricos e pacotes antigos ficam intactos. Parada após
preservar evidências, antes de qualquer promoção. Revisão humana necessária.

Git final: dev no mesmo HEAD; índice vazio; 24 tracked modificados, 140 entradas untracked agregadas, 46 worktrees com metadados idênticos ao snapshot inicial. Novas entradas somente registro/evidências; PRD/049 acrescidos para retomada. [Resumo estruturado](2026-10-09-single-item-combinada-prova-evidencias/comparison-summary.json).
