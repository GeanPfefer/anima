# Single-Item — PostgreSQL real após correção do guard Docker

2026-10-09; campanha real interrompida por falha instrumental nas RPCs naturais
do candidato item/claim. **GO de catálogo nas duas variantes executadas;
NO-GO da comparação completa e da promoção. Combinado não criado.**
[Plano052](../planos/052-single-item-full-catalog-contract.md),
[guard revisado](2026-10-09-single-item-guard-docker.md),
[evidências](2026-10-09-single-item-guard-prova-evidencias/).

## Preflight, isolamento e identidade

Git Windows dev, HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`, índice vazio e 46 worktrees
preservadas. WIPs preservados; sem staging/commit/push/reset/clean/prune.
2484 arquivos052r2,156 migrations,556 bootstrap e pins do comparador/executor/
contrato conferidos. O contexto novo importa explicitamente o guard revisado
`b88c848c50dd231a518bf72af2c5b77f9eafce57c2c0e46a37620a899726235c`;
não altera as cópias antigas congeladas. Oito testes atuais do guard PASS.

Docker29.8.2, daemon18caadf3-1887-45ef-857e-4e71fcef77e9,16 CPUs,8259190784bytes;
imagem pinada af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b.
Host livre5335620KiB, containers estimados1641965158bytes. DB/Auth healthy.
Vector unhealthy/restarting preexistente, sem mounts e em rede distinta; exceção
por independência e headroom, não reparado nem classificado saudável. Todos os
18 IDs preexistentes registrados e excluídos de reutilização/alteração/remoção.

Somente dois novos ambientes, sequenciais. Cada um: network none, sem portas,
binds ou volumes persistentes, rootfs RO, PGDATA512MiB/socket16MiB tmpfs,
postgres105:106, cap-dropALL/no-new-privileges,1CPU/1GiB sem swap extra/64PIDs.
Inspect + mountinfo + paths/permissões validados antes de initdb e SQL; guard
corrigido aceitou a evidência real. Identidades/postmaster/ledger conferidos.

| Variante | CID completo | Cluster | Banco de prova |
|---|---|---|---|
| Baseline | e98c9c4dadc3760eb8950b5f8495f4aafd7e743ed9284ac818aaca1357b41dcb |7694776481414918274|anima_single_item_proof_879056e0c2104f5795f220062acc2d85|
| Item/claim |2bead85887c33f4a5ca219d85a78b83f96586321739f7135cbfbf11f60337468|7694779444401729657|anima_single_item_proof_07b49ed68e5b4fe1a63fb180f7784412|
| Combinado |não criado|não criado|não criado|

Bootstrap:272/272 em cada ambiente, sem falha SQL;544 etapas reais no total.
Nenhum container histórico iniciado, reiniciado, modificado ou removido.

## Contrato integral confirmado em PostgreSQL

Mesmo adapter/comparador052r2, sem filtros ou metadados modelados. Nas duas
variantes,279 funções:161 de aplicação e118 membros individuais vector0.8.0.
pg_depend pg_proc→pg_extension deptype e e inventário de objetos reconciliados;
tipos/OIDs, owners, ACL, raw prosrc, módulos/kinds e nove extensões aceitos.
Baseline membership-real.json detalha118, catálogo bruto preserva todos os fatos.
RLS/policies/triggers, constraints/FKs, índices/flags, schemas/grants, roles e
demais atributos protegidos passaram no gate. Isso não audita universalmente
corpos de funções fora de public/private, conforme limite052.

No item/claim, só a migration20261009000000 foi aplicada. Hash fonte
0fdb36b28c7bacfb534a943bea2bbb5a812938295ad5c185cb7faadbe0df8b72,
payload998460bd9648f6bb61ae1e39e3a4346de29fbe677c293757395a671d6e0637b6.
Somente corpos public.start_claimed_work_attempt(uuid,uuid,text) e
public.release_work_claim(uuid,text) alterados; OIDs/signatures/owner/ACL e
atributos/guardas restantes idênticos antes/depois. Segunda migration não aplicada.

## Matriz funcional — resultados preservados

| Prova | Baseline | Item/claim | Combinado |
|---|---|---|---|
| Catálogo integral |GO279|GO279, delta2|não executado|
| pgTAP |330PASS/334;4FAIL históricos|330PASS/334;mesmos4FAIL|não executado|
| Single-Item canônico |55/55 PASS|55/55 PASS|não executado|
| Concorrência mesmo item/alvo/global/orçamento |4PASS|4PASS|não executado|
| Pré-lock original item + claim |40P01, controle positivo|40P01 residual artificial|não executado|
| acquire→start, release→start, start→release, release→release (prefixo manual item) |40P01 nos4|sem40P01 nos4;55000 em acquire→start|não executado|
| Pré-lock item/orçamento |40P01|40P01|não executado|
| RPC natural start/block_budget, barreira target |40P01|40P01|não executado|
| RPC natural acquire/start e acquire/release |40P01 nos2|FAIL_HARNESS_OR_PRECONDITION nos2|não executado|
| Revogação durante espera, início/liberação |admite após revogação nos2|recusa42501 nos2|não executado|
| Cleanup final |nenhuma linha sintética restante|nenhuma linha sintética restante|não executado|

26 suítes,668 asserções:660PASS/8FAIL;110 asserções canônicas Single-Item PASS.
Quatro FAIL de work_budget_local_vs_external por variante:1,2,6,10, expectativas
de quota só externa versus política atual supervisionada. Não convertidos em
PASS, skip ou defeito novo do candidato. Sem quinta falha pgTAP.
Autorização/ACL/RLS efetiva, expiração, replay/retomadas e claims estrangeiros
exercitados pelas suítes; snapshots/rollback e ledger estrangeiro dos cenários
concorrentes conferidos. Não equivalem a cobertura universal de todos os callers.

Waits/pids/transações e pg_locks foram preservados por cenário. O controle
item/claim tem espera por transação/tupla work_claims versus item. O orçamento
residual envolve advisory autonomous_work_budget do owner versus item; contexto
SQL real aponta private.enforce_autonomous_work_budget/private.begin_work_attempt.
A barreira target apenas coordena o escalonamento nas RPCs naturais; não é um
caller com pré-lock manual de item/claim/orçamento. Nenhuma dessas provas dá
garantia global de ausência de deadlocks.

## Bloqueio instrumental comprovado

natural_pairs.py envia ROLLBACK/quit antes de coletar finish das sessões. Nos
dois casos naturais item/claim do candidato, sessãoA recebe55000 (active claim),
psql ON_ERROR_STOP termina com exit3. Enviar ao stdin fechado causa Broken pipe.
O except grava FAIL_HARNESS_OR_PRECONDITION; o finally termina sessãoB (exit-15),
cujo resultado completo não é coletado. Não inferir sucesso pela ausência de40P01.
concurrent-session-*.json conserva55000 e comandos; instrumental-diagnostic.json
deriva esses fatos sem substituir os resultados originais.

Segundo defeito: o cenário retorna exit0 mesmo com status FAIL interno. O dispatcher
seguiu revogação/performance antes da leitura desses resultados pela revisão.
Esses testes seguintes têm evidências próprias; não tornam os dois FAIL em PASS.
Ao identificar o bloqueio, novas variantes foram recusadas; combinado não criado.
Nenhuma expectativa, fixture, SQL, migration ou runner de cenário corrigido durante
a campanha. Contextos/dispatcher novos só parametrizam e chamam o harness existente.

## Contenção e limites

| Métrica (ms) | Baseline | Item/claim |
|---|---:|---:|
| p50 replay |0,099|0,197|
| p95 |0,140|0,285|
| p99 |0,256|0,429|
| média |0,113836|0,217495|
| máxima |3,459|3,662|
| espera controlada observada |396,362|358,348|

1000 transações separadas por variante em duas sessões, cada qual replay de
item próprio, mesmo owner e alvos distintos; dois inícios reais de preparação.
Não são1000 admissões novas nem benchmark de throughput/fairness. Uma amostra por
variante, sem conclusão causal de regressão geral; starvation não demonstrada nem
excluída. Microtempos/histogramas e locks brutos nas evidências; combinado não medido.

## Encerramento, decisão e retomada

Logs persistidos antes do pg_ctl fast stop, somente em cada CID novo. Ambos
exited, containerExitCode0, OOMKilledfalse, RestartCount0; Docker exec pg_ctl137
por saída do PID1 confirmada separadamente. Sem remoção; tmpfs perdido após stop,
evidências duráveis externas preservadas. DB/Auth healthy e metadados exatamente
iguais ao preflight; daemon estável;18 históricos e redes/volumes preservados.
Vector mudou State/RestartCount pela policy preexistente, sem intervenção.

**NO-GO para comparação completa/promoção.** Catálogo052 e guard confirmados
nos ambientes executados; correção item/claim tem evidência localizada positiva
nos quatro controles, mas as duas provas naturais ficaram incompletas. Correção
combinada continua funcionalmente indeterminada. Primeiro corrigir offline o
tratamento de sessões já encerradas e propagação de FAIL interno, preservando
55000/40P01, resultado de ambas as sessões e rollback/cleanup; testes offline
adversariais, pin/revisão humana antes de nova campanha. Não alterar SQL para
resolver transporte. Revalidar baseline positivo e três variantes com os mesmos
cenários após novo preflight; não reutilizar nenhum CID/cluster/nonce desta sessão.

Mudanças desta sessão: novo registro/evidências e checkpoint PRD/plano052;
nenhuma mudança em migrations, comparador, guard, orçamento, fixtures ou expectativas.
Residente não recebeu SQL/migrations. Gate single_item_atomic_claim_unavailable
ativo; sem INV-11/Resident Host/compute pago, promoção ou liberação Single-Item.
Parada para revisão humana; próxima correção do harness não executada nesta sessão.

Verificação final:2484/156/556 PASS e guard/comparador/migrations sem drift;
Git final25 tracked modificados e164 entradas untracked agregadas, índice vazio,
HEAD/worktrees idênticos ao início. Hashes finais das evidências em SHA256SUMS.
