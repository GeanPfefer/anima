# Single-Item V1 — pgTAP e concorrência reais (2026-10-08)

Tipo: prova. Mandato humano reafirmou banco com nonce, mantendo postgres fora das
escritas. Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Sem commit/staging/push/reset/clean/prune. WIPs/worktrees preservados.

## Identidade e invariantes

Container exclusivo `8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`;
cluster `7694431622913864120`, PostgreSQL 15.8, banco
`anima_single_item_proof_396f38b1036a47ba92d51890cdf252ba`.
Imagem digest `sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`.
Guardas Docker/imagem/labels/env/rede none/portas/ns/privilégios/1CPU/1GiB/64PIDs/
restart no/rootfs ro/tmpfs e mountinfo/stat/readlink confirmadas antes das escritas
e de cada conexão/consulta; ID/contexto/daemon, PG system identifier e postmaster
inalterados. Todos os transportes docker exec usam CID completo, env-i, socket,
user e banco explícitos; nenhum fallback/TCP/credencial residente.
272 registros audit e seus hashes exatos antes/depois; pacote 556 hashes íntegros.
pgTAP 1.2.0 instalado, vector 0.8.0 disponível; extensão existente não foi recriada.
ACL/RPC/assinatura/enforcement pré/pós-testes íntegros, quatro triggers ativos.

## pgTAP — contagem sem ocultar interrupções

13 suítes previstas, 334 asserções. Oito suítes canônicas executadas: sete PASS,
Single-Item FAIL/interrompida. 183 asserções emitidas, todas 183 ok, zero not ok;
151 asserções canônicas não emitidas. Uma interrupção SQL não é PASS da suíte.

| Suíte canônica | Planejadas | ok | Resultado |
|---|---:|---:|---|
| single_item_work_claim | 55 | 27 | interrompida 42501 |
| work_claim | 31 | 31 | PASS |
| target_exclusivity | 31 | 31 | PASS |
| commanded_target_exclusivity | 25 | 25 | PASS |
| autonomous_intelligence_gate | 25 | 25 | PASS |
| work_routing_decision | 20 | 20 | PASS |
| work_routing_adjustment | 10 | 10 | PASS |
| work_resumption | 14 | 14 | PASS |
| work_budget | 15 | 0 | não executada: desabilita triggers |
| work_budget_local_vs_external | 12 | 0 | não executada: desabilita triggers |
| budget_blocked_human_resume | 16 | 0 | não executada: desabilita triggers |
| work_budget_interruption_resumption | 15 | 0 | não executada: desabilita triggers |
| supervisor_reconciliation | 65 | 0 | não executada: desabilita orçamento |

O [protocolo](../../supabase/tests/single_item_concurrency.md) exige: “Nenhum trigger
de orçamento/classificação/routing pode ser desabilitado na prova nova.” Essa
regra explícita bloqueou as cinco regressões (123 asserções), não a autorização
SQL em geral. Não remover instruções ou afrouxar guardas para tornar verde.

Falha original 42501 permission denied for schema private: a 28ª asserção resolve
assinatura privada pelo nome enquanto authenticated não tem USAGE. A restrição
é correta; a consulta de introspecção do teste é inadequada. Não é falha da RPC.
Diagnóstico suplementar resolve OID exato como postgres antes de trocar papel:
47 ok, depois 22023 no attempt was started under this claim. A fixture pede
attempt_finished para b2 sem attempt (a admissão anterior foi recusada).
Diagnóstico final só ajusta essa fixture para released_without_attempt e conserva
asserções/expectativas/guardas: **55/55 ok**, inclusive autenticação/owner/RLS,
claim alheio ativo/vencido, replay, classificação revogada, ocupação sem claim,
consumo único de autorização/replay e recusa posterior de orçamento com rollback.
[Diff exato exclusivamente diagnóstico](2026-10-08-single-item-provas-diagnostico.diff).
Canonical SQL/testes/ACL/migrations não alterados. Falhas originais permanecem FAIL.

Total de execuções pgTAP (inclui repetições diagnósticas): 285 ok, zero not ok;
duas execuções interrompidas e uma suplementar 55/55. Cobertura de asserções distintas
com diagnóstico: 211; 123 seguem não executadas. Não somar repetição como cobertura.

## Concorrência — evidências individuais

Fixtures são quatro usuários UUID aleatórios novos, @test.invalid, owner/alvo
independentes. Caso budget tem cinco starts externos sintéticos legítimos com
triggers/routing/classificação ativos, claims históricos liberados e dois novos
candidatos aprovados; fatos preflight exigem uso=5 e remaining=1. Não há provider
ou compute invocado: openai é somente classificação JSON sintética de custo.

Primeira passagem: quatro FAIL do harness JSONDecodeError. SELECT EXISTS retorna
t/f, mas runner usa json.loads diretamente. Locks foram registrados em stdout;
A/B não foram commitados nesta passagem interrompida e cleanup confirmado.
Adaptador temporário de transporte corrige só decodificação t/f, com seis checks
determinísticos; não muda SQL/erros esperados. Segunda passagem registra:

| Cenário | Espera/A | B real | Resultado formal |
|---|---|---|---|
| same_item | transactionid observado; A commit | 55000 work item is held by an active claim | PASS |
| same_target | advisory work_target owner/alvo; A commit | 55000 single_item_foreign_claim_open | FAIL infraestrutura cleanup EPIPE |
| mixed_global | advisory work_target global→scoped; A commit | 55000 single_item_foreign_claim_open | FAIL infraestrutura cleanup EPIPE |
| budget | advisory autonomous_work_budget user; A commit | P0001 user_attempt_budget_exhausted | FAIL infraestrutura cleanup EPIPE |

Nos três últimos, todas as verificações funcionais terminaram antes de
Session.close lançar Broken pipe ao fechar stdin do psql já encerrado por
ON_ERROR_STOP. Erro original e status FAIL preservados; não converter em PASS.
Snapshots integrais de itens/claims/eventos/autorização fora de itemA permaneceram
idênticos. Budget terminou com seis execution_started (cinco históricos + A),
nenhum sétimo/B; nenhuma associação/evento/estado parcial de B. A correção do
snapshot STABLE não é inferida de locks: o efeito real após espera foi medido.
Esta evidência estreita não elimina todos os riscos de orçamento/replay/concessão.

Oito tentativas de cenários no total: uma PASS e sete FAIL de instrumentação,
sendo quatro serialização e três cleanup; não são oito cenários distintos.
Logs, PIDs/xids, SQL enviados, stderr/SQLSTATE, observações de blocker/lock e
snapshots individuais preservados, inclusive resultados formais e cleanup final.

## Deadlock real, atomicidade e rollback

Prova negativa adicional com uma fixture independente e locks de staging apenas
em suas linhas: A toma item antes de adquirir claim novo; B toma claim antes de
start_claimed_work_attempt, reproduzindo ordens naturais de ambas as RPCs.
Espera B→A comprovada, então A→B: PostgreSQL detectou **40P01**.
A pid26510 abortada enquanto bloqueava work_claims, B pid26567 prosseguiu e foi
explicitamente ROLLBACK. Zero retry; rows/snapshot idênticos à fixture, backend
count=0, cleanup sintético confirmado. PASS do teste negativo/rollback, **não**
prova de ausência de deadlock. Ordem item→claim vs claim→item é risco real para
produção: interromper/falhar fechado em 40P01, sem retry implícito, até revisão.

## Estado final e parecer

**NO-GO para liberar Single-Item V1**. Contratos funcionais acima observados;
correção canônica/revisão dos dois bugs de fixture e dos dois bugs de runner
continua pendente. Cinco regressões guardas-unsafe precisam reformulação separada
com todos os triggers ativos. Resolver/analisar a ordem de locks e provar os
complementos do protocolo (inversão global/scoped, start comandado, versões em
corrida etc.) antes de alegar cobertura integral ou ausência de deadlock.

Todas as fixtures foram removidas somente pelos UUIDs auth.users criados;
cascades foram conferidas por snapshots dos dados sintéticos. Sem DELETE geral,
TRUNCATE, reset de sequências, trigger bypass ou dados reais copiados.
Baseline de linhas anterior vazio restaurado; backends próprios=0; ledger e
ACL/triggers intactos. Sequências PostgreSQL podem avançar em testes mesmo sob
ROLLBACK; não foram rebobinadas. Testes não foram executados no banco postgres.
Banco residente healthy, mesmo ID/StartedAt/PID/RestartCount/configuração antes/
depois; não houve SQL residente ou operação sobre containers residentes/antigo.
Sem Resident Host, INV-11, compute pago, commit/push ou remoção do gate
single_item_atomic_claim_unavailable.

Evidências host sem segredos: G:\anima-provas\single-item-7694431622913864120-real,
-concurrency-decoder e -deadlock; manifests, adapters/SQL derivados, registros
individuais, snapshots/ledgers/Git/resultados e SHA256SUMS. Recuperação pelo
[plano](../planos/043-single-item-governed-execution-v0.md),
[bootstrap](2026-10-08-bootstrap-tmpfs-execucao-real.md) e
[preflight anterior](2026-10-08-single-item-provas-preflight-destino.md).
Parar aqui; revisão humana antes de corrigir código canônico, ampliar testes ou
considerar qualquer promoção de gate/INV-11.
