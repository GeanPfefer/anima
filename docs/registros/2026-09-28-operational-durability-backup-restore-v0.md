# 2026-09-28 — Operational Durability V0: backup manual + prova de restore

## Veredito

| Dimensão | Resultado |
|---|---|
| Backup lógico consistente (PRE == POST) | **PASS** |
| Equivalência de **dados** no restore | **PASS** (counts, anchor e 5 digests idênticos) |
| Persistência pós-restart do stack descartável | **PASS** |
| Equivalência de **segurança** no restore | **FAIL** (drift de ACL + 1 trigger ausente) |
| Resident Host apontando para o restore (#18) | **Adiado para V0.1** |
| Banco vivo | **Zero mutação** (snapshot final == PRE) |

O estado operacional do Anima é **restaurável quanto aos dados**. O restore
oficial do Supabase CLI, porém, **não reproduz fielmente a postura de
privilégios**: o banco restaurado sai mais permissivo que o vivo. Enquanto essa
barreira não for resolvida, um restore não pode assumir o lugar do banco vivo.

Este registro é uma **prova de restorability**, **não um backup durável**.
Os artefatos eram plaintext, nunca saíram da Goma e foram destruídos. Onde
guardar o backup fora da máquina é a próxima unidade.

Manifesto: [`2026-09-28-operational-durability-manifest-v0.json`](2026-09-28-operational-durability-manifest-v0.json).

## Preflight (read-only)

- Git: `dev` = `origin/dev` = `d0e64bb`; `main` = `origin/main` = `99bec54`; só o WIP conhecido não rastreado.
- Supabase CLI 2.105.0; Docker 29.8.0; PostgreSQL 15.8 (`supabase/postgres:15.8.1.085`); GoTrue v2.189.0.
- Stack vivo `anima`: db, auth, rest, kong e realtime (sem storage e sem studio). Volume `supabase_db_anima`. Container db no ar desde 05:17:28Z, ou seja, não foi reiniciado nesta prova.
- Migration: `20260927000001` (143 registros em `supabase_migrations.schema_migrations`).
- Storage: 0 buckets, 0 objetos.
- `pg_cron`: o launcher roda, mas a extensão não está instalada em `postgres`, então não há jobs.
- Writers: **nenhum processo ANIMA em execução** (sem Resident Host e sem web/dev). Os únicos `node.exe` vistos eram do runtime do Codex. Conexões no banco: realtime e PostgREST, todas `idle`.

## Estado vivo (redigido)

| Métrica | Valor |
|---|---|
| auth users | 24 |
| work_items | 124 |
| work_events | 1733 |
| work_events last seq / id | 54738 / `8ae122fc-f0d0-4918-a49d-8d1cdf1facf3` |
| work_recovery_lineage | 30 |
| work_harness_recoveries | 3 |
| paid_compute_authorizations | 44 (+1 authorization event) |
| budget reserved / settled / voided | 58 / 18 / 2 |
| work_claims | 106 |
| RLS habilitada (public+private) | 37 tabelas |
| policies (public/private/storage) | 65 |
| funções public+private | 261 |
| triggers não internos (public/private/auth/storage) | 18 |
| resident identity fingerprint | `6bb3c9ce147b492a` (derivado, ver manifesto) |

## Quiescência

Nenhum writer da aplicação estava rodando no início, então **nada foi
parado**. O Postgres ficou disponível o tempo todo. A quiescência foi
**observada, não imposta**: o PostgREST/Kong continuou exposto em
`0.0.0.0:54321`. A garantia de consistência vem da comparação PRE/POST, e
não da ausência presumida de clientes.

- Janela dos 3 dumps principais: `05:33:07.512Z → 05:33:14.083Z` (≈ 6,6 s). O snapshot POST é idêntico ao PRE em todas as chaves.
- Dumps de histórico de migrations: `05:33:59.458Z → 05:34:03.908Z`. O snapshot POST2 também é idêntico ao PRE.
- Snapshot final do vivo às `05:38:47.744Z`, depois de restore e restart: idêntico ao PRE.

### Digest do ledger (equality proof, não autoridade de domínio)

Transação `REPEATABLE READ READ ONLY`, `TIME ZONE 'UTC'`:

```
work_events_digest = sha256( UTF8( string_agg(
  concat_ws(E'\t', seq, id, work_item_id, event_type, author,
            coalesce(proposal_version::text,''),
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            payload::text),
  E'\n' ORDER BY seq) ) )
= 8f46ca2af11ef1b637c7a6413239a151a9ff5a42abfaed614eed078633fdca24
```

Digests auxiliares (`to_jsonb(row)::text` ordenado por `id`) de `work_items`,
`paid_compute_budget_events`, `paid_compute_authorizations` e
`work_recovery_lineage` estão no manifesto.

## Backup

Mecanismo oficial: Supabase CLI `db dump --local`, gravando num diretório
temporário fora do repositório (scratchpad da sessão, em outro volume).

| Artefato | Comando | Bytes | SHA-256 |
|---|---|---|---|
| roles.sql | `--role-only` | 297 | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| schema.sql | (default) | 624 578 | `c953ca04358214a5453b45fb7c9c21de9c20c91a985d5b2d54efba02740bbd65` |
| data.sql | `--data-only --use-copy` | 3 927 514 | `2c8e1a598b61ad7f8184138be6ba4c7818cabd71494feedae12c2adca59b136d` |
| history_schema.sql | `--schema supabase_migrations` | 885 | `9c15cd48dec925fc43383625c328a2fb2202f81797178f87f8b5c005701c12b4` |
| history_data.sql | `--data-only --use-copy --schema supabase_migrations` | 835 292 | `59d7ba97835d06199aa1f8cd1e2afb7fcbb4ee53e50e941924afa3252d82b809` |

`data.sql` traz 64 blocos `COPY`: 37 public, 2 private, 22 auth, 2 storage
e 1 supabase_functions. Os três dumps pedidos **não incluem**
`supabase_migrations`, porque o CLI exclui esse schema. Por isso usei os
artefatos 4–5, que seguem o passo "preservar histórico de migrations" da doc
oficial de backup/restore do CLI. `schema.sql` cobre `public` e `private`,
mas **não** objetos criados pelo projeto dentro de schemas gerenciados como
`auth` (ver gap 2).

`seed.sql` não foi usado. O conteúdo dos artefatos não foi impresso.

## Ambiente descartável

- Diretório de projeto separado, fora do repo, com `config.toml` próprio: `project_id = "anima-restore-proof-v0"`, API 55321, DB 55322, shadow 55320, seed desabilitado, studio/storage/analytics/edge desabilitados, sem pasta de migrations.
- `supabase start -x realtime,studio,imgproxy,postgres-meta,mailpit,logflare,vector,supavisor,edge-runtime` levou 31 s. Containers `supabase_{db,auth,rest,kong}_anima-restore-proof-v0`; volume **`supabase_db_anima-restore-proof-v0`** (nunca `supabase_db_anima`).
- Mesmas imagens do vivo (`postgres:15.8.1.085`, `gotrue:v2.189.0`). Os segredos JWT/service_role são os defaults do próprio stack local, e nenhum segredo foi transportado por arquivo.

## Restore

Os artefatos foram copiados para o container descartável, e os SHA-256
conferiram dentro dele antes do restore. Comando da doc oficial:

```
psql --single-transaction -v ON_ERROR_STOP=1 \
  -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql
psql --single-transaction -v ON_ERROR_STOP=1 -f history_schema.sql -f history_data.sql
```

- Lote principal: exit 0, ≈ 1,9 s. Histórico: exit 0, ≈ 0,3 s.
- 0 ERROR. 472 `WARNING: no privileges were granted for ...`, todos em funções membro da extensão `vector`, que `postgres` não possui. O conjunto de funções e suas ACLs de extensão não entrou no diff abaixo.
- Uma primeira tentativa falhou antes de executar qualquer SQL (`file not found`), por conversão de paths do Git Bash. Nenhum efeito.

## Restore proof

| # | Check | Resultado |
|---|---|---|
| 1 | Checksums dos artefatos (host e dentro do container) | PASS |
| 2 | PostgreSQL major (15.8) | PASS |
| 3 | Migration version `20260927000001` / 143 | PASS |
| 4 | Resident identity fingerprint | PASS (`6bb3c9ce147b492a`) |
| 5 | Auth user residente existe (24 users) | PASS |
| 6 | work_items 124 | PASS |
| 7 | work_events 1733 | PASS |
| 8 | last seq/id | PASS |
| 9 | Ledger digest + 4 digests auxiliares | PASS |
| 10 | Recovery lineages 30 / harness recoveries 3 | PASS |
| 11 | Authorities 44 (+1 event), resume authorizations 1, claims 106 | PASS |
| 12 | reserved/settled/voided 58/18/2 | PASS |
| 13a | RLS habilitada/forçada por tabela; policies (texto integral) | PASS |
| 13b | **ACLs de tabelas e funções** | **FAIL (gap 1)** |
| 14a | Funções public/private: conjunto de assinaturas, `secdef`, owner | PASS |
| 14b | **Triggers** | **FAIL (gap 2)**: 17 vs 18 |
| 15 | Extensões (9, mesmas versões) | PASS |
| 16 | Storage metadata (0/0) | PASS |
| 17 | 33 MUST alcançáveis por 21 refs `archive/anima/*`, local e remoto | PASS |
| 18 | Resident Host → restore | ADIADO (V0.1) |
| — | Roles (super/login/bypassrls) | PASS |
| — | Publications | só diferem as partições diárias de `realtime.messages` (realtime não sobe no descartável; não é estado ANIMA) |

### Gap 1: drift de ACL (security equivalence FAIL)

O banco restaurado tem **só privilégios a mais**, nenhum a menos:

- **213 privilégios de tabela extras** em 21 tabelas de `public`/`private`, para `anon` (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) e `authenticated` (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER).
- **92 EXECUTE extras** em funções `public`: 82 para `anon`, **todas SECURITY DEFINER**, mais 9 para `service_role` e 1 para `authenticated`.

A RLS e as policies são idênticas, o que atenua o lado das tabelas. Mas
EXECUTE de `anon` em funções SECURITY DEFINER contorna a RLS por construção.
**Um restore neste estado não é seguro para exposição.**

Hipótese de causa, ainda não verificada: num Supabase novo, os
`ALTER DEFAULT PRIVILEGES` do schema `public` concedem tudo a
`anon`/`authenticated`/`service_role` sobre objetos criados por `postgres`. O
`pg_dump` emite GRANT/REVOKE relativos ao `acldefault` do Postgres, e não aos
default privileges do alvo. Assim, os REVOKEs que as migrations fizeram no
vivo não são reemitidos.

**Barreira:** a doc oficial não cobre a reconciliação de ACL pós-restore. Não
apliquei SQL corretivo. Ficam como opções para decisão humana na V0.1, por
exemplo: (a) reconciliar ACL a partir de um snapshot de ACL do vivo;
(b) restaurar com os default privileges do alvo neutralizados; (c) validar a
ACL como gate obrigatório do restore.

### Gap 2: trigger em schema gerenciado ausente

`auth.users : on_auth_user_created → public.handle_new_user` (criado em
`supabase/migrations/20260528000001_functions_triggers.sql`) não existe no
restore, porque o dump do CLI exclui objetos do schema `auth`. Os dados de
perfis já restaurados estão íntegros, mas novos signups no ambiente
restaurado **não** criariam perfil. O remédio fica para a V0.1, junto com o
gap 1.

### Resident Host (#18): adiado

Apontar o Resident Host para o restore exigiria sobrescrever
URL/chaves Supabase do ambiente residente e fazer login GoTrue contra um banco
com o gap 1 aberto. Isso é risco desnecessário para uma prova V0 e não
acrescenta evidência sobre os dados. Fica para a V0.1, depois da decisão sobre
ACL.

## Restart proof

`supabase stop` seguido de `supabase start` **só no projeto descartável**
(29 s; o volume foi preservado pelo CLI). O snapshot completo depois do
restart é **idêntico** ao snapshot pós-restore: fingerprint, work_items,
work_events, anchor e todos os digests. O stack vivo ficou no ar
ininterruptamente.

## Falhas e correções durante a prova

- Na versão inicial, os digests de assinatura de funções e de triggers usavam `string_agg(... ORDER BY 1)`, que ordena por constante e dá resultado não determinístico entre bancos. Corrigi para ordenar pela própria expressão. Com isso, as assinaturas de funções ficaram iguais (`e29a4af2…`). O digest de triggers diverge de fato por causa do gap 2.
- A primeira cópia dos artefatos falhou por conversão de paths do Git Bash (`MSYS_NO_PATHCONV`), sem efeito no banco.

## Banco vivo: zero mutação

Todas as consultas ao vivo rodaram com `default_transaction_read_only=on` ou
dentro de transação `READ ONLY`. Os dumps são leitura do CLI. Nenhum reset,
migration, seed, push, repair, INSERT/UPDATE/DELETE, authority, reservation
ou provider. O snapshot final (05:38:47Z) é idêntico ao PRE em todas as chaves.

## Cleanup

Tudo acima foi registrado antes da limpeza. Depois:

- stack descartável removido (`supabase stop --no-backup` no projeto `anima-restore-proof-v0`) e o volume `supabase_db_anima-restore-proof-v0` apagado;
- dumps plaintext e o diretório de projeto descartável apagados do scratchpad.

A prova é reproduzível em cerca de 1 minuto com o procedimento acima, então
não há necessidade de manter plaintext com dados de auth. No repo ficam só este
registro e o manifesto: sem dumps, dados de auth, hashes de senha ou PII.

## Tempos observados

| Etapa | Tempo |
|---|---|
| 3 dumps principais | ≈ 6,2 s |
| 2 dumps de histórico | ≈ 4,4 s |
| Subida do stack descartável | 31 s |
| Restore (principal + histórico) | ≈ 2,2 s |
| Restart do descartável | 29 s |

## Próximas unidades (não iniciadas)

- **V0.1:** barreira de ACL (gap 1), trigger `auth` (gap 2) e Resident Host → restore.
- **Off-machine durability:** destino, criptografia, retenção. Nenhum destino escolhido e nenhum upload feito.
- Automação e agendamento: fora do escopo.

US$0. Nenhum provider, nenhuma paid attempt.
