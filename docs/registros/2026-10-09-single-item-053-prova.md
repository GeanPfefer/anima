# Single-Item — prova focada real do runner053 e combinado

2026-10-09. **GO do runner053 em PostgreSQL real; GO de catálogo dos dois
candidatos; NO-GO da correção combinada/promoção por falha SQL23514.**
[Plano053](../planos/053-single-item-natural-session-results.md),
[contrato052](../planos/052-single-item-full-catalog-contract.md),
[baseline histórico real](2026-10-09-single-item-guard-prova.md),
[evidências novas](2026-10-09-single-item-053-prova-evidencias/).

## Preflight e invariantes

Git Windows dev, HEAD inicial/final6bc4aadef9414d655600c2ea37c6be436b3628c8,
índice vazio,46worktrees/WIPs preservados.2484arquivos052r2,156migrations,
556bootstrap e fontes/contrato/adapters conferidos.17 testes offline053 PASS
(0,076s); review998098fabe9cc6810994e2afbf51b02b59d7b06a8f38627c0c7631e121bbb206
validado. Guard corrigido b88c848c50dd231a518bf72af2c5b77f9eafce57c2c0e46a37620a899726235c
importado explicitamente nos novos contextos. Dois controles naturais chamam
supabase/tests/single_item_natural_campaign.py e seus fontes revisados; nenhuma
cópia histórica Broken pipe usada nesses dois casos.

Docker29.8.2, daemon18caadf3-1887-45ef-857e-4e71fcef77e9,16CPUs,
8259190784bytes; host livre5161528KiB, uso estimado containers1679000863bytes.
Imagem af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b
pinada. DB/Auth healthy. Vector unhealthy/restarting preexistente, sem mounts,
rede distinta; exceção por independência/headroom, sem intervenção.20containers
pré-existentes identificados e preservados; nenhum reutilizado/iniciado/removido.

Somente dois novos PG, sequenciais: networknone, portas/binds/volumes persistentes
ausentes; rootRO, PGDATA512MiB/socket16MiB tmpfs,postgres105:106,cap-dropALL/
no-new-privileges,1CPU/1GiB sem swap extra/64PIDs. Guard inspect+mountinfo+paths/
permissões antes de initdb, IDs/postmaster/ledger e isolamento antes de SQL.

| Variante | CID completo | Cluster |
|---|---|---|
| Item/claim novo |a6bcf32f99d80f5fd5ed034c620bcc517f94a1a1937ac2b9d6315d7434fb70fd|7694790142787158145|
| Combinado novo |b00839da82bdc0ca2e17894836dbf3252f53ee8c668c527574b28c97fb52be03|7694793386080690305|
| Baseline histórico, só referência |e98c9c4dadc3760eb8950b5f8495f4aafd7e743ed9284ac818aaca1357b41dcb|7694776481414918274|

Bancos/nonces exatos em identity-manifest.json/slots.json. Bootstrap272/272 por
ambiente,544etapas reais, sem falha. Baseline não reconstruído nesta sessão.

## Catálogo e aplicação permitida

Mesmo adapter/comparador052r2 e catálogo integral279,161aplicação+118memberships
individuais vector0.8.0 reconciliadas por pg_depend/inventário. OIDs/tipos canônicos,
corpos raw, owners/ACL/grants/RLS/policies/triggers/constraints/índices e demais
objetos protegidos passaram nos dois ambientes, sem projeções ou metadados fake.

Primeira migration: somente release_work_claim e start_claimed_work_attempt.
Segunda, somente no combinado: start_claimed_work_attempt,
begin_budget_interruption_resumed_attempt, begin_human_decision_resumed_attempt,
begin_resumed_work_attempt. São2+4overrides,5corpos efetivos distintos. Headers,
owners/ACL/identidades/objetos restantes preservados. Recibos com hashes fonte/
payload e snapshots de cada estágio em catalog-gate. Nada aplicado ao residente.

## Matriz consolidada — histórico identificado, sem reclassificação

| Prova | Baseline histórico real | Item/claim revalidado | Combinado novo |
|---|---|---|---|
| Bootstrap/catálogo |272/279GO históricos|272/279GO novos|272/279GO novos|
| pgTAP |330PASS/334,4FAIL históricos|não repetido;330/334 histórico preservado|330PASS/334,mesmos4FAIL|
| Single-Item canônico |55/55 histórico|55/55 histórico, não repetido|55/55 novo|
| Natural acquire/start |40P01 histórico|PASS com A55000/B0 completos|FAIL: A55000/B23514 completos|
| Natural acquire/release |40P01 histórico|PASS com A55000/B0 completos|não executado: dispatcher parou no FAIL anterior|
| Natural start/block_budget |40P01 histórico|40P01 novo, controle positivo residual|não executado após FAIL|
| Mesmo item/alvo/global/orçamento |4PASS históricos|4PASS novos|não executado após FAIL|
| Revogação durante espera start/release |admite após revogação histórico|2recusas42501, PASS_REVALIDATION novos|não executado após FAIL|
| Pré-locks adversariais |6resultados históricos40P01|histórico preservado, não repetido|não executado após FAIL|
| Contenção/microbenchmark |histórico disponível|não medido nesta sessão|não medido após FAIL|
| Rollback/cleanup final |histórico comprovado|comprovado novo|comprovado novo mesmo após23514|

Os dois naturais anteriormente indeterminados têm agora **novas provas completas**
no item/claim; evidências antigas continuam intactas/indeterminadas. Em ambos:
S exit0 completo; A exit3/55000 completo; B exit0 completo; sem forced/timeout/
readerErrors, sem Broken pipe, snapshots iguais após rollback, cleanupEqualtrue,
backendsAfter0. Recusa esperada distinta de sucessoB e de deadlock. Waits/locks/
comandos/stdout/stderr e resultados pré/pós-cleanup individuais preservados.

No combinado, S0/A3(55000)/B3(23514), todas coletas completas, nenhuma terminação
forçada ou erro instrumental. StatusFAIL_FUNCTIONAL; child/dispatcher exit1 e
segundo cenário não iniciado. Isso valida em PostgreSQL a propagação real de FAIL
do053, não apenas seu caminho PASS. Ausência de40P01 nessa execução que falhou
não é demonstração suficiente de correção funcional ou do ciclo orçamento.

Quatro FAIL work_budget_local_vs_external1,2,6,10 permanecem FAIL; nenhuma quinta
falha pgTAP. Divergência histórica quota só externa versus política supervisionada
atual, separada da23514 e da estratégia de locks; expectativas/políticas intactas.
334 novas asserções do combinado não substituem as668 já registradas historicamente.
Replay/retomadas/expiração/claims estrangeiros/orçamento/ACL/RLS exercitados nas
suítes; concorrência correspondente no combinado permanece incompleta.

## Falha23514 e limite de atribuição causal

B tentou UPDATE public.work_items SET state='in_progress',updated_at=now()
WHERE id=v_item.id RETURNING * em private.begin_work_attempt, linha76, chamada
por public.start_claimed_work_attempt, linha133. Constraint work_items_check:
CHECK(updated_at>=created_at), validada e não deferrable. Linha rejeitada:
created_at2026-10-09 22:16:01.252507+00;
updated_at2026-10-09 22:15:59.931977+00. Log do erro22:16:00.250UTC, anterior
ao created_at da linha. stdout/stderrB e server log concordam. Nenhuma atualização
inválida foi persistida; rollbackEqualtrue, cleanupEqualtrue, backendsAfter0.

**Falha SQL comprovada; causa raiz produto versus infraestrutura temporal ainda
não estabelecida.** O helper private.begin_work_attempt e essa constraint não
foram alterados pelas migrations candidatas. O fixture é anterior ao BEGIN de B
na sequência do runner e criado pelas RPCs originais; não houve ajuste temporal
manual nos novos cenários. Timestamps sugerem investigar regressão de relógio/
proveniência temporal; não certificam sozinhos NTP/WSL como causa. Nenhuma medição
coordenada host/daemon/transaction time foi arquivada para provar essa hipótese.
Não atribuir automaticamente23514 à mudança de locks, nem tratá-la como flake/PASS.

SQL-failure-diagnostic.json separa observação e hipótese. Não houve retries,
GREATEST/clock_timestamp inserido no produto, edição de fixture, troca de
expectativa ou remoção da constraint. Campanha interrompida no FAIL.

## Encerramento, residente e recomendação

Evidências externas preservadas antes de pg_ctl fast stop de cada CID novo.
Ambos exited/containerExit0, OOMKilledfalse,RestartCount0; Docker exec pg_ctl137
por saída do PID1 confirmada independentemente. Sem remoção, tmpfs perdido após
stop. DB/Auth healthy e metadados iguais ao preflight; daemon estável;20históricos
preservados e redes/volumes sem mudança. Só Vector State/RestartCount mudou pela
policy automática preexistente. Nenhum dado ou SQL residente acessado.

**NO-GO combinado/promoção; GO do runner053 e catálogo no domínio comprovado.**
Investigar offline o caminho temporal e obter revisão/autorização antes de nova
prova focada com relógios host/daemon e transaction_timestamp/clock_timestamp
registrados antes/depois de fixture e esperas. Se integridade temporal falhar,
NO-GO de infraestrutura antes da prova; não ajustar SQL para verde. Se estável,
comparar novo baseline/combinação apenas onde necessário para atribuir23514 e
concluir os controles naturais restantes. Ambientes sempre novos, jamais estes
IDs/clusters/nonces. Quotas locais/externas e riscos de pré-locks/transações
compostas/outros callers continuam separados. Sem medida nova de throughput ou
starvation e sem garantia global contra deadlocks.

Mudanças somente em novo registro/contextos/evidências e checkpoint PRD/053;
nenhum fonte do runner/guard/comparador/migration/fixture/expectativa alterado.
Sem staging/commit/push/reset/clean/prune, INV-11/Resident Host/compute pago,
promoção, gate removido ou execução governada. Parada para revisão humana.

Integridade final:2484pacotes/156migrations/556bootstrap e fontes053/guard/052
conferidos;3253arquivos protegidos verificados. Git final25tracked modificados
(preexistentes),173entradas untracked agregadas, índice vazio; HEAD e46worktrees
idênticos ao início. Evidências finais SHA256SUMS acompanham o diretório novo.
