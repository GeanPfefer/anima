# 050 — Continuidade operacional e revisão estrita do catálogo

2026-10-09. Somente documentação, harness e testes offline. Segue o
[049](049-single-item-budget-lock-candidate.md) e corrige o bloqueio do
[registro real](../registros/2026-10-09-single-item-combinada-prova.md).
Launcher humano: [runbook WSL](../operacao/codex-wsl.md).

## Causa e implementação

`definitions()` usava `Path.read_text()`, convertendo CRLF para LF antes de
calcular prosrc. O scanner agora possui opção `preserve_newlines=True`, usando
`read_bytes().decode('utf-8')`; o compositor de três variantes a exige. O default
normalizado permanece para os contratos históricos de análise offline; não usar
esse default para hash de catálogo. Nenhum byte SQL foi reescrito.

O novo comparador `supabase/tests/single_item_catalog_compare.py` resolve tipos
por `(pg_namespace.nspname, pg_type.typname)` únicos e funções por namespace,
nome e vetor ordenado de OIDs de argumentos. Depois compara prosrc pelo OID da
função no mesmo snapshot. OIDs históricos não são pinados entre clusters.
Aliases int/float/timestamptz são mapeados no compositor para int4/float8/timestamptz
de pg_catalog; vector(768) tem identidade de argumento public.vector (typmod não
participa da identidade da função), conforme prerequisite congelado. Vocabulário
fechado de tipos do corpus: qualquer tipo novo exige revisão e falha fechado.
Não há matching por hash de corpo nem fallback por nome/assinatura textual.

O gate exige hashes raw exatos. CRLF→LF explica a falha histórica, mas não é uma
transformação permitida no catálogo durante a prova nova. Os 161 corpos raw do
baseline foram reconciliados offline com o JSON histórico: 108 já coincidiam,
53 só divergiam pela conversão do scanner, zero divergências inexplicadas.
Metadados corrigidos são derivados das fontes, nunca substituídos pelos hashes
observados para obter aprovação.

## Três domínios de integridade

1. Arquivo-fonte: SHA256 de bytes originais, migrations e bootstrap/sources.
2. Payload: SHA256 do arquivo prepared congelado, separado do fonte; durante
   preflight fresco produzir wrappers de runId em destino novo e registrar SHA256
   dos bytes efetivamente enviados ao psql. Para candidatas registrar hash do
   payload com quaisquer BEGIN/COMMIT adicionados. Não confundir hash do template
   congelado com receipt de dispatch de outro nonce. Nenhum dispatch nesta sessão.
3. Corpo de catálogo: SHA256 do UTF-8 prosrc raw, obtido por OID; sem strip,
   newline conversion, parser de assinatura textual ou tolerância semântica.

`verify_manifest` exige pin externo do hash do manifesto, verifica todos os arquivos
e rejeita paths que escapem do pacote. O novo manifesto schemaVersion2 registra
revision `050-raw-prosrc-oid-r1`, identidades canônicas e os domínios separados.
ExpectedHeaders históricos continuam como diagnóstico textual; não constituem
resolução de função. `catalog_read_query()` apenas renderiza SELECT de types,
functions/OIDs/prosrc/atributos; esta sessão não o executou.

## Revisão dos pacotes

Pacote original ba6404a7ae634e9c9ab0002308405658 permanece intacto. Novo destino:
`.tmp/single-item-budget-lock-proof-20261009-050-raw-prosrc-oid-r1`.
[Evidências da revisão](../registros/2026-10-09-single-item-catalog-comparator-evidencias/)
registram por slot hash original/revisado de manifest, diferenças de campos e
arquivos. Fontes SQL, 272 payloads e expectativas das 334 asserções são invariantes.
Harness compartilhado novo nos três slots; receitas 272/+1/+2 e quatro FAIL
históricos local/externo continuam visíveis. Revisão não autoriza execução.

## Checkpoint exato para próxima prova — requer revisão humana

1. Revisar este diff/harness/manifest e seu pin externo. Não executar os adapters
   arquivados `apply_variants.py` da campanha falha: eles continuam evidência.
   Adaptar o executor futuro para chamar `verify_manifest`, a coleta por OID e
   `compare` com atributos esperados completos, antes/depois das extras. Fixar
   owner/ACL/secdef/config/volatility/parallel/strict/leakproof/cost/rows e identidade
   canônica do retorno; comparar também RLS/policies/triggers/FKs/índices com o
   baseline validado. Argumentos/retornos e defaults precisam de gate de catálogo
   além do hash raw do corpo; não considerar só prosrc como aprovação.
2. Repetir integralmente preflight 049: Git Windows/worktrees/WIPs, imagem pinada,
   hashes novos e originais, recursos/daemon/DB/Auth; Vector independente exige
   exceção novamente comprovada. Não inferir saúde atual do snapshot histórico.
3. Criar três ambientes NOVOS independentes sequencialmente, limites 049 sem
   ampliação. Negar todos os containers anteriores, inclusive
   2073d5af7365cb6a37d99df2a87f7505a63e2489f9d10062b295c540ec738305 e cluster
   7694595591914635392. Nunca reiniciar/reutilizar/remover anteriores.
4. Validar identidade/isolamento antes de cada dispatch; gerar wrappers fresh em
   destino novo sem alterar 272 payloads canônicos. Pin de source/template/dispatch
   por etapa, ledger 272/272. Baseline sem extras, claim +000000,
   combinado +000000 e +000001. Resolver canonical types/OIDs no próprio cluster,
   comparar hashes raw e invariantes. Qualquer discrepância não explicada: NO-GO.
5. Somente após gate de catálogo completo executar a matriz 049 inteira: 334
   pgTAP, controle positivo item/claim e item/orçamento natural, candidatos,
   adversariais de pré-lock, replay/admissão/retomada/expiry/foreign claims,
   revogação após waits, orçamento/rollback/ACL/RLS/cleanup. Manter quatro FAIL
   históricos separados, sem ajustar expectativas. Preservar waits/SQLSTATE,
   stdout/stderr/catálogos e server logs por tentativa. Ausência de log não é PASS.
6. Medidas comparáveis de transações reais conforme 049, sem extrapolar replays
   agrupados para throughput. Snapshot residente antes/depois só leitura permitida
   pela autorização futura; nenhum dado/modificação residente. Final ledger,
   snapshots cleanup/backends e evidências externas com hashes. Parar para revisão,
   sem promoção nem retirada do gate.

Bloqueio restante: integração/revisão do executor live com esta interface e prova
PostgreSQL completa ainda pendentes; modelos/testes offline não compilam SQL nem
provam ACL/MVCC ou ausência global de deadlock. A parada anterior continua NO-GO,
com 0/334 testes SQL por variante. Nenhum novo estado do Docker/residente observado.


## Resultado offline e pins externos

125 testes Single-Item PASS e 30 bootstrap PASS. Revisão: baseline824 / claim825 / combinado826 arquivos, total2475; todas as verificações de arquivos/manifests passaram. 53/53/51 hashes de corpo corrigidos exclusivamente CRLF. Combinado já substituía dois corpos históricos CRLF por corpos candidatos LF. 3253 arquivos protegidos iguais ao snapshot, incluindo 2469 dos pacotes originais, 156 migrations e 272 payloads canônicos. Os 46 metadados de worktrees são idênticos ao snapshot final anterior. Pins externos em revision-audit.json e SHA256SUMS das evidências.


## Retomada da campanha — NO-GO de integração

[Registro de preflight](../registros/2026-10-09-single-item-retomada-bloqueio-executor.md): interface nova ainda só utilizada pelo compositor e testes, sem integração ao executor PostgreSQL. Adapter arquivado segue textual. Mandato exigiu parar em bloqueio instrumental; nenhum ambiente criado nem SQL executado. Preparar executor separado com gates completos e testes de integração antes da próxima prova.


## Integração offline do executor — plano051

[Adapter/checkpoint051](051-single-item-executor-catalog-integration.md) substitui a comparação textual do adapter histórico, preservado. Implementação corrente e referências pinadas separadamente; mesmos manifests050. 144 testes Single-Item e30 bootstrap PASS; nova campanha PostgreSQL não executada. Retomada deve chamar run do adapter051 com contexto novo e pins revisados, após preflight integral e revisão humana.
