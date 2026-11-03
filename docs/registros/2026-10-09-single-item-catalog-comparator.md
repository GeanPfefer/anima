# Continuidade Codex e correção offline do comparador de catálogo

2026-10-09; desenvolvimento offline. Branch Windows `dev`, HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit/staging/push/reset/clean/prune.
[Plano/checkpoint 050](../planos/050-single-item-catalog-comparator.md),
[estado vivo](../../anima-prd.md), [runbook](../operacao/codex-wsl.md),
[evidências](2026-10-09-single-item-catalog-comparator-evidencias/).

Launcher, resume --all e atualização pelo npm NVM documentados; versão local
`codex-cli 0.162.0` conferida. Nenhuma atualização/reinstalação executada.
EACCES informado pelo operador: npm do sistema tentou `/usr/local/lib/node_modules`.
Caminhos absolutos limitados à configuração desta máquina. Runbook referenciado
em AGENTS.md; execução governada/CoderBackend não alterados.

Causa do bloqueio anterior confirmada no scanner/compositor: read_text convertia
CRLF antes do hash. Agora opt-in raw UTF-8 no scanner e obrigatório no compositor;
manifest schemaVersion2, revisão 050-raw-prosrc-oid-r1, hash de source separado de
payload e prosrc. Identidades de argumento canônicas, resolução por tipos/OID,
sem matching textual nem normalização permissiva. Comparador offline exige pin
externo de manifest e hash exato dos arquivos. Interface renderiza coleta read-only
para integração futura; nenhum SELECT executado nesta sessão.

125 testes Single-Item PASS (79,348 s), incluindo 13 novos adversariais; 30 testes
bootstrap PASS (11,050 s). Os 161 corpos baseline arquivados coincidem exatamente
com a extração raw independente: 53 diferenças CRLF/LF explicadas, zero outras.
Rejeições verificadas: mudança real/line endings, função errada, ambiguidades,
argumento de outro tipo/OID, ACL modificada, source/payload/prosrc adulterados.
Manifest adulterado também recusado no audit de revisão por pin externo.
Não são provas PostgreSQL, ACL real, compilação, MVCC ou throughput.

Pacotes originais intactos; revisão em destino novo explícito do plano 050, com
manifest/logs/hashs e diff de metadados por slot no revision-audit.json. Receitas
272/+1/+2 preservadas, harness comum às variantes, SQL/asserções sem alteração.
As quatro falhas históricas local/externo continuam FAIL, sem reexecução nem
mudança de expectativas. As 334 asserções ficam pendentes da prova real; o último
run interrompido executou zero em cada variante. Bootstrap 556 hashes verificados
pelo compositor. Migrations históricas e duas candidatas não editadas.

Git inicial Windows: 24 tracked modificados preexistentes, índice vazio, 46 worktrees.
Git Linux reportou muitos arquivos como modificados por convenção de EOL; o estado
operacional foi conferido com Git Windows. Nenhum worktree criado/removido ou
WIP descartado. Mudanças desta sessão: docs operacionais/AGENTS/PRD/049/050/registro,
scanner, compositor, comparador/testes e novos pacotes/evidências.
Estado final detalhado em git-final.json das evidências.

Nenhum Docker, container, banco, SQL, migration aplicada, INV-11, Resident Host ou
compute/API paga nesta sessão. Estado atual de DB/Auth/Vector **não consultado**;
saúde histórica não é saúde atual. Gate single_item_atomic_claim_unavailable ativo,
políticas e execução governada intactas.

Fronteira humana: revisar harness/manifests e integração do executor live antes da
nova campanha. Próximo passo exato no 050: preflight integral, novos descartáveis,
coleta de OIDs/tipos e invariantes completos, payload dispatch receipts, receitas
sequenciais e toda matriz 049. Adapters arquivados falhos não devem ser relançados.
NO-GO para promoção; correção combinada continua indeterminada em PostgreSQL.
Parada após checkpoint, sem executar a campanha SQL.


Integridade final: 2475 arquivos nos novos slots (824/825/826), 53/53/51 correções de hash somente CRLF; 3253 arquivos protegidos inalterados. Git Windows final: 25 tracked modificados (AGENTS acrescido aos 24 anteriores), 146 entradas untracked agregadas, índice vazio, HEAD inalterado e 46 worktrees com metadados idênticos à sessão anterior.
