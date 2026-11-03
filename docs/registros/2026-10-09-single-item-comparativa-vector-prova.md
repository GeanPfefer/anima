# Single-Item V1 — Vector admitido com exceção; comparação PostgreSQL real

2026-10-09. Tipo: diagnóstico/prova. Branch dev, HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`, nenhum commit.
**GO para a exceção operacional do Vector; NO-GO para promoção ao residente ou
liberação Single-Item.** Candidato resolve a inversão item/claim nos quatro pares
controlados, mas o ciclo item/orçamento permanece comprovadamente real.

[Resultado estruturado](2026-10-09-single-item-comparativa-evidencias/comparison-results.json),
[catálogo comparado](2026-10-09-single-item-comparativa-evidencias/catalog-comparison.json),
[integridade residente](2026-10-09-single-item-comparativa-evidencias/resident-comparison.json).
[ADR](../arquitetura/single-item-lock-strategy-decision.md),
[matriz 046](../planos/046-single-item-lock-strategy-proof.md),
[roteiro 047](../planos/047-single-item-claim-lock-candidate.md).

## Admissibilidade do Vector

Logs recentes: fonte docker_logs tenta listar containers pela API Docker via TCP,
recebe NetworkUnreachable (OS 101), encerra as fontes e sai com código 0. Policy
unless-stopped provoca o restart loop. Healthcheck 127.0.0.1:9001 falha quando o
processo encerra; falhas já existiam em 08/10. Não foi determinada a causa da rota/
endpoint TCP inválido; não se alterou configuração nem se classificou Vector healthy.
[Logs finais](2026-10-09-single-item-comparativa-evidencias/vector-logs-final.txt) e
[exceção explícita](2026-10-09-single-item-comparativa-evidencias/vector-exception.json).

Vector sem mounts/binds/volumes-from/portas host, na rede supabase_network_anima;
provas com network none, tmpfs exclusivos e socket por namespace, sem credenciais
residentes. A coleta Docker logs não tem acesso a arquivos/socket PG dos descartáveis;
não se afirma isolamento contra administrador privilegiado do daemon. Amostras
Vector entre reinícios: 0% CPU/0B, não estimativa de pico. Sem eventos OOM no período
coletado, sem warnings daemon, sem reinícios novos de DB/Auth; nenhuma pressão nova
observada. Não há prova universal de ausência de picos ou falha futura.

Daemon 18caadf3-1887-45ef-857e-4e71fcef77e9, Docker 29.8.2, 16 CPUs,
8.259.198.976 bytes RAM. Memória livre Windows antes dos slots: 6.203.012 e
6.017.520 KiB; uso aproximado containers 1,66/1,67 GB. Limites mantidos: 1 CPU,
1 GiB sem swap adicional, 64 PIDs, PGDATA tmpfs 512 MiB/socket 16 MiB, postgres
UID105/GID106, rootfs RO, cap-drop ALL, no-new-privileges, IPC/cgroup privados,
sem bind/volume/porta. Execução sequencial; preflight kernel de mounts/identidade
passou antes de SQL nos dois. Imagem local por digest validada, sem pull.

## Identidades e integridade

| Slot | Container completo | Cluster system_identifier |
|---|---|---|
| Baseline | dc4be077b3559a61d42122671669a412af2de59fe5096cad06895747fead93a5 | 7694565793221283969 |
| Candidato | 7d878a682ca9c66f495e10bd239b8830d119d279ae42b32c52743aa78033d86c | 7694570259207483520 |

Nonces/database names nos identity-manifest de cada slot. Imagem
sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b.
PostgreSQL 15.8, listen_addresses vazio, psql -X por socket explícito/env -i/full ID.
Sem reutilização dos dois descartáveis anteriores. Bootstrap 272/272 em cada slot,
544 etapas reconciliadas por ledger; mesmas fontes congeladas, wrappers com run IDs
novos e hashes próprios. 556 hashes canônicos conferidos antes/depois; 154 fontes
Anima baseline exatamente iguais ao snapshot; imagem/env/labels pinados e validados.

Migration candidata aplicada **uma vez**, só no candidato, hash
0fdb36b28c7bacfb534a943bea2bbb5a812938295ad5c185cb7faadbe0df8b72, bytes inalterados.
Catálogos iniciais dos clusters iguais. Depois, somente prosrc de start/release
difere: assinaturas/retornos, owners, ACL, securityDefiner/search_path e demais
atributos, conjunto de funções, RLS/policies/triggers permanecem iguais. Hash do
prosrc aplicado corresponde ao candidato. OIDs numéricos antes/depois não foram
arquivados no comparador: não declarar uma medição de preservação de OID; o diff
não contém DROP e usa OR REPLACE. ACL/RLS negativos também exercitados no pgTAP.

## Matriz pgTAP completa

Mesmos arquivos/payloads em ambos, guardas ativas; todas as suítes terminaram com
ROLLBACK e igualdade dos snapshots das oito tabelas acompanhadas.

| Suíte | Plano | Baseline ok/fail | Candidato ok/fail |
|---|---:|---:|---:|
| Single-Item | 55 | 55/0 | 55/0 |
| work_claim | 31 | 31/0 | 31/0 |
| target_exclusivity | 31 | 31/0 | 31/0 |
| commanded_target_exclusivity | 25 | 25/0 | 25/0 |
| autonomous_intelligence_gate | 25 | 25/0 | 25/0 |
| work_routing_decision | 20 | 20/0 | 20/0 |
| work_routing_adjustment | 10 | 10/0 | 10/0 |
| work_budget | 15 | 15/0 | 15/0 |
| work_budget_local_vs_external | 12 | 8/4 | 8/4 |
| budget_blocked_human_resume | 16 | 16/0 | 16/0 |
| work_budget_interruption_resumption | 15 | 15/0 | 15/0 |
| work_resumption | 14 | 14/0 | 14/0 |
| supervisor_reconciliation | 65 | 65/0 | 65/0 |
| **Total emitido** | **334** | **330/4** | **330/4** |

26 execuções/668 asserções emitidas, 660 ok e oito FAIL (quatro propriedades repetidas).
55 Single-Item PASS nos dois; cinco históricas: 123 emitidas, 119 ok/quatro FAIL
por ambiente. Quatro falhas local/externo: assertions 1,2,6,10, expectativas de
admissão local/externa distintas da política V1-supervision atual. FAIL mantidos,
exit psql 0 não foi interpretado como suíte PASS. Sem SQLSTATE externo nessas
quatro falhas TAP; diagnóstico/política separados do candidato, sem skips/bypass.

## Concorrência, deadlocks e autorização

| Prova | Baseline | Candidato |
|---|---|---|
| same_item | PASS; B 55000 active claim | Igual |
| same_target | PASS; B 55000 single_item_foreign_claim_open | Igual |
| mixed_global | PASS; B 55000 single_item_foreign_claim_open | Igual |
| última admissão budget | PASS; B P0001 user_attempt_budget_exhausted | Igual |
| Original com pré-locks I/C opostos | 40P01 reproduzido | 40P01 reproduzido, controle fora do novo contrato de entrada |
| acquire/start, B RPC natural | 40P01 | Sem deadlock; A 55000 active claim, B termina após rollback A |
| release/start, B RPC natural | 40P01 | Ambos terminam sem deadlock |
| start/release, B RPC natural | 40P01 | Ambos terminam sem deadlock |
| release/release, B RPC natural | 40P01 | Ambos terminam sem deadlock |
| start versus block_work_on_budget | **40P01 item/B** | **40P01 item/B permanece** |
| allowlist revogada durante espera start | Ainda admite | 42501, nenhuma escrita parcial |
| allowlist revogada durante espera release | Ainda admite | 42501, nenhuma escrita parcial |

Oito disputas originais PASS, 12 cenários de locks conclusivos (seis por slot),
quatro provas de revogação. Controles A/B em ROLLBACK e provas de A commit/B recusa
separados. Seeds/estrutura de fixtures iguais; nonces e IDs de items gerados pelo
banco naturalmente distintos. Nenhum provider chamado para fixtures backend openai.
Foreigner ledger/claims/eventos/autorizações preservados pelas comparações integrais
fora de itemA. Quota 5→6, sem sétima admissão; concessão humana de uso único/replay
coberta nas 55 assertions. Cleanup das fixtures sintéticas confirmado em cada fase.

Os seis cenários usam A com pré-lock manual de item para tornar interleaving
controlável. B usa RPC natural exceto o controle original, que também pré-bloqueia C.
Não representam stress de chamadas naturais sem instrumentação, nem ausência
universal de deadlocks. Deadlock item/B envolve advisory do orçamento no trigger
execution_started versus block_work_on_budget B-first→I; logs/PIDs/trx/pg_locks
confirmam o ciclo nos dois. Não modificar essa política nesta prova.

## Desempenho e limites

| Medida | Baseline | Candidato |
|---|---:|---:|
| Samples replay | 1000 | 1000 |
| p50 RPC (ms) | 0,032 | 0,042 |
| p95 RPC (ms) | 0,051 | 0,066 |
| p99 RPC (ms) | 0,176 | 0,207 |
| Média RPC (ms) | 0,041168 | 0,053372 |
| Wall host (s) | 0,207380 | 0,223205 |
| Espera controlada mesma attempt (ms) | 339,656 | 339,098 |

p95 +29,4%, delta absoluto +0,015 ms; razão ilustrativa throughput wall 92,9%.
Nesse recorte, limites propostos p95 ≤10% e throughput ≥95% não foram atingidos.
**Microbenchmark** de replay em dois itens/alvos independentes do mesmo owner,
500 chamadas em cada uma de duas transações: locks reentrantes mantidos até rollback.
Não são 1000 transações/admissões independentes ou SLA geral, e wall inclui setup.
Não se executaram 100 repetições por disputa, stress multiowner/recovery/foco nem
prova de justiça/starvation. performance_transactions.py ficou preparado e NÃO
executado, pois o baseline já estava encerrado; não conta como evidência.

## Falhas exclusivas do adaptador preservadas

1. Baseline bootstrap: FileExistsError ao arquivar executor.py já existente,
   após ledger 272/catalog/result salvos; exit 1 preservado, nenhum payload repetido.
   Candidato arquiva sob outro nome e terminou exit 0.
2. Primeira montagem concorrente baseline: NameError append_event após commit da
   primeira fixture, antes das disputas. Falha preservada; cleanup somente do
   usuário sintético salvo; nova passagem v2 em diretório distinto completou 4/4.
3. Primeiro controle original baseline: EPIPE buffered após ON_ERROR_STOP; raw
   sessões já continham 40P01/55000. Resultado formal FAIL mantido. Passagem separada
   após tratar pipe fechado coletou 40P01 com rollback/cleanup verificados, sem retry
   automático de uma transação falhada.
4. Comparador candidato: regprocedure omitiu public visível no search_path e causou
   erro de comparação após aplicação única. Normalização schema-aware validou apenas
   os dois corpos; migration não foi reaplicada; suites rodaram na passagem v2.
5. Application_name longo no controle budget baseline gerou NOTICE 42622/truncamento;
   PIDs e sessões encerradas, backend count final 0 confirma cleanup independente.
   Nomes curtos no candidato; não tratar NOTICE como SQLSTATE de falha de produto.
6. pg_ctl via Docker exec baseline retornou 137 quando PID1 encerrou; container
   independently exited 0, OOMKilled=false, backends prévios 0. Falha do helper
   preservada e encerramento confirmado por inspect, sem reinício. Candidato conserva
   esse retorno bruto e verifica estado final, não aceita 137 indiscriminadamente.

Healthcheck TCP herdado da imagem dos descartáveis reporta unhealthy porque só
socket está habilitado. Não desativado nem considerado prontidão SQL: cluster/socket/
versão/identidade validados independentemente. Fontes/adaptadores foram ajustados
entre passagens com falhas, sem alterar candidato/canonical fixtures/runners; dados
brutos de SQL/sessões/erro são evidência primária. Não alegar harness imutável para
todas as tentativas ou reclassificar as passagens falhas como PASS.

## Encerramento, efeitos e decisão humana

Snapshot detalhado final versus antes: somente dois novos containers adicionados;
nenhum removido, volumes/redes inalterados. Todos os containers preexistentes
inalterados exceto State/RestartCount do Vector em seu loop previamente admitido.
DB/Auth metadata/config/status exatamente iguais e healthy; horários de início e
restarts 0/7 mantidos. Dois anteriores exited/intocados; edge runtime permanece
encerrado, sem ação. Integridade de dados residente não foi auditada via SQL;
nenhum comando SQL foi dirigido a seu ID ou usado com suas credenciais.

Os dois NOVOS clusters encerrados sequencialmente após snapshots/catálogos/logs,
zero backends e baseline de tabelas acompanhado restaurado. Containers mantidos,
sem remoção/restart. Tmpfs perdido após encerramento, como previsto: qualquer nova
prova requer reconstrução nova autorizada, não retomada fictícia desses clusters.

Git inicial 24 tracked modificados/120 entradas untracked; final 24 tracked/122
entradas untracked; índice vazio, 46 worktrees preservados. Mudanças nesta sessão
apenas evidências/registro e adendos PRD/047. Migrations/candidato/políticas/código
executado governado/harness canônico intactos; 556 hashes finais PASS. 84 testes
Single-Item offline PASS antes do bootstrap (10,288 s). Sem staging/commit/push/
reset/clean/prune, Host/INV-11, compute pago, integração ou liberação do gate.

Recomendação: **NO-GO para promover ao residente/liberar Single-Item**. Há evidência
favorável à correção localizada de dois corpos, sem regressão canônica nova observada,
mas o ciclo real item/B exige revisão de escopo/ordem, benchmark de admissões/
transações independentes e campanha com harness congelado; divergência histórica
permanece decisão de política separada. Revisão humana deste relatório primeiro.
Nenhum diff de produção adicional ou aplicação residente automaticamente autorizado.

## Fechamento das evidências

[SHA256SUMS](2026-10-09-single-item-comparativa-evidencias/SHA256SUMS) registra
5.645 arquivos de evidência (cache compilado excluído). Links locais conferidos.
Consulta OOM explícita retornou exit 0/count 0; retenção Docker é finita, portanto
não certificar ausência universal de OOM histórico a partir disso. Vector final
restarting/unhealthy, restartCount 54; nenhuma mudança de configuração.
Snapshot protegido anterior à implementação candidata mostrou apenas a alteração
já autorizada naquela sessão em single_item_lock_review_test.py; não houve nova
alteração nos arquivos preexistentes de produção/testes durante esta prova.
