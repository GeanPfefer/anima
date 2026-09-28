# 2026-09-28 — Operational Durability V0.1: restore com equivalência de segurança

## Veredito

| Dimensão | V0 | V0.1 |
|---|---|---|
| Backup consistente (PRE == POST) | PASS | **PASS** (dados **e** 12 projeções de segurança) |
| Equivalência de dados | PASS | **PASS** (todas as chaves, incluindo `auth.identities`) |
| Equivalência de segurança | FAIL | **PASS**: 12/12 projeções iguais, 0 linhas de diferença |
| SECURITY DEFINER extra / missing | +82 anon | **0 / 0** |
| Restart do target descartável | PASS | **PASS** |
| Resident Host → restore | adiado | **DEFERRED**: o host grava inevitavelmente (ver abaixo) |
| Banco vivo | zero mutação | **zero mutação** (dados + segurança finais == iniciais) |

O registro V0 ([`2026-09-28-operational-durability-backup-restore-v0.md`](2026-09-28-operational-durability-backup-restore-v0.md))
fica preservado como histórico da falha.

Esta unidade prova um **procedimento** de restore com equivalência de
segurança. Os artefatos continuam plaintext e locais e foram destruídos: isto
**não é um backup durável fora da máquina** (próxima unidade).

## Falha V0 e causa-raiz

Na V0, o restore oficial saiu com +213 grants de tabela, +92 EXECUTE (82 para
`anon`, todos SECURITY DEFINER) e sem o trigger
`auth.users:on_auth_user_created`.

Causa-raiz (entregue pela auditoria do Codex e **confirmada empiricamente
aqui**):

1. **ACL.** Um Supabase recém-criado já tem `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS TO anon, authenticated, service_role`. Ao criar os objetos, o `schema.sql` herda esses defaults. O `pg_dump` emite GRANT/REVOKE relativos ao `acldefault` embutido do Postgres, e não aos default privileges do alvo. Assim, os REVOKEs que migrations posteriores fizeram no vivo não são reemitidos e sobram grants.
2. **Trigger.** O Supabase CLI exclui DDL do schema gerenciado `auth`. A função `public.handle_new_user` vem no dump; o trigger em `auth.users` não vem.

Fontes de verdade versionadas: ACL final = histórico de migrations + estado
final; default privileges = `20260620000000_grant_default_privileges.sql` (a
única migration que mexe em defaults); trigger de signup =
`20260528000001_functions_triggers.sql`. O dump é transporte, não fonte de
verdade suficiente.

## Fase 0: reconciliação de auth (read-only, sem PII)

| Métrica | Valor |
|---|---|
| `auth.users` | 24 |
| `auth.identities` | 23 (um por usuário distinto, todos `email`) |
| usuários sem identity | 1 (não é o residente) |
| busca da identidade residente (email = `ANIMA_RESIDENT_EMAIL`) | 1 usuário, 1 identity |
| fingerprint residente | `6bb3c9ce147b492a` |

**Explicação da divergência "1 user / 23 identities" × "24 users":** os
dois números são verdadeiros, mas medem coisas diferentes. O "1" é o
resultado da busca **filtrada** da identidade residente (1 usuário). O "23" é
a contagem **global** de `auth.identities`. O total global de `auth.users` é
24, porque um usuário não residente não tem linha em `auth.identities`. A V0
reportava apenas `auth.users` global. A V0.1 passa a registrar as quatro
métricas.

## Fase 1: snapshot canônico de segurança do LIVE (oracle)

Ferramenta versionada (read-only): `supabase/restore-proof/security-projection.sql`
e `supabase/restore-proof/digest.sh`. Escopo: `public`/`private` (+ `auth`/`storage`
para triggers; defaults de todos os schemas). ACL efetiva: `NULL` vira
`acldefault`; grantee 0 vira `PUBLIC`. Policies e triggers têm whitespace
normalizado. Digest = sha256 das linhas da projeção ordenadas com `LC_ALL=C`.

| Projeção | O que é | Linhas | SHA-256 |
|---|---|---|---|
| table_acl | ACL efetiva de tabelas/views (rel, grantee, privilégio, grantable) | 929 | `f7746693ebd74ae6ca6f7ed713a1e4db5314053c16ecfc9dd84a4d8f7a730911` |
| sequence_acl | idem para sequences | 36 | `c9d14639df712f7623371c09f17f061faddb9ce8dae3ec7f63daa9b93b09b85b` |
| function_acl | ACL efetiva de funções (marca membro de extensão) | 1075 | `eb808c561811ff5d376da35d06709a47b5e01fa6cf024b03d7124d1b1e7112f4` |
| secdef_exposure | `has_function_privilege` EXECUTE de anon/authenticated/service_role/authenticator/postgres em cada SECURITY DEFINER | 460 | `061c35bb0a8f8476556d22ac2906933324ded1336e56bb7c4e4c22e77c334a5b` |
| owners | donos de relações, funções e schemas | 308 | `b9f97d0d90fb90cb016e8135d38c0b21cfcd330a268350346334f5f9f66482fa` |
| schema_acl | ACL de `public`/`private` | 10 | `57f5a6eb13e35f294c87c457ce42948681a975348635b7e486064738930039c6` |
| rls | RLS por tabela | 39 | `a455099f940a564aaae1e1aecf958fb7f7e6bf558043d069b956c1bef5cfeeed` |
| force_rls | FORCE RLS por tabela | 39 | `41ddb55fc7e6c4bebdf504bdbd510ca419bac5261a6b89675fd463572ebd26d8` |
| policies | texto semântico integral | 65 | `f0e0f0ec1b4551c2d2e53e0510bb643ca47bebb98faa18ee2db3ea9fd6af40be` |
| triggers | `pg_get_triggerdef` + estado habilitado | 18 | `7e48920432af19f559a33eaf3ecc201459bd84e1ed16851b7583e9ceb2b94fd1` |
| default_acl | `pg_default_acl` explodido (objetos FUTUROS) | 319 | `f5ea13c7963b2419d0a99f8affba821609d973db859c364ad6f6c1d9ed549ba7` |
| publication_membership | tabelas ANIMA na publication realtime | 1 | `4ce901aeb072e4d576c920b800baa70349e43104a1b8208af2a991c8f9761ed0` |

Não há column ACL no escopo (0 linhas). As linhas completas ficaram só em
disco local e foram apagadas; no Git ficam descrição, contagem e digest.

## Fase 2: backup

Mesmos 5 artefatos do CLI da V0, com **hashes idênticos aos da V0** (estado
inalterado): `roles` `25873cec…`, `schema` `c953ca04…`, `data` `2c8e1a59…`,
`history_schema` `9c15cd48…`, `history_data` `59d7ba97…`. Janela:
`07:00:44.1Z → 07:00:55.4Z`. PRE == POST em dados **e** nos 12 digests de
segurança. Nenhum backend não ocioso no LIVE durante a janela.

`schema.sql` termina com os 12 `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON {TABLES,SEQUENCES,FUNCTIONS} TO {anon,authenticated,postgres,service_role}`
(linhas 12242+ de 12295), **depois** de todos os CREATE/GRANT/REVOKE.

## Fase 3: novo target descartável

`project_id = anima-restore-proof-v01`, API 56321, DB 56322, shadow 56320,
volume **`supabase_db_anima-restore-proof-v01`** (novo; o da V0 já não
existia). Imagens `postgres:15.8.1.085`, `gotrue:v2.189.0`, iguais às do vivo.
Subida em 31 s. Nenhum processo ANIMA apontou para ele.

## Fases 4–5 e 8: default privileges do target

| Momento | Linhas | SHA-256 |
|---|---|---|
| **before** (target virgem) | 319 | `f5ea13c7963b2419d0a99f8affba821609d973db859c364ad6f6c1d9ed549ba7` (**idêntico ao LIVE**) |
| **neutralized** | 286 | `05ce4d5a002d7a59e2f829d31fecd61d6a5275d6c241034c7f02b444d30e24f5` |
| **final** (após restore) | 319 | `f5ea13c7963b2419d0a99f8affba821609d973db859c364ad6f6c1d9ed549ba7` (**idêntico ao LIVE**) |

Neutralização **derivada do target observado**, sem lista inventada: para
`defaclrole = postgres` (o papel que cria os objetos restaurados), schema
`public`, todos os grantees exceto o próprio dono:

```
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
```

A neutralização removeu exatamente 33 linhas (as dessa combinação) e nada mais.

**ACL_EXISTING_OBJECTS ≠ DEFAULT_ACL_FUTURE_OBJECTS:**

- *Objetos existentes:* criados com defaults neutralizados, recebem só o `acldefault` embutido mais os GRANT/REVOKE do dump. Resultado: table/sequence/function ACL e secdef_exposure idênticos ao LIVE.
- *Objetos futuros:* o estado final dos defaults é o da migration `20260620000000` (ALL em TABLES/SEQUENCES/ROUTINES para anon, authenticated e service_role, com role postgres, em public), mais a entrada de dono `postgres` do bootstrap. Ele é reinstalado pelos próprios `ALTER DEFAULT PRIVILEGES` no fim do `schema.sql` e fica igual ao LIVE (`f5ea13c7…`). Nenhuma outra migration altera defaults.

Um nunca substituiu o outro: os defaults amplos voltam **depois** que os
objetos existentes já foram criados.

## Fase 6: restore

`roles → schema → SET session_replication_role = replica → data` numa
transação, com `ON_ERROR_STOP` (exit 0, ≈ 1,8 s), mais o histórico de
migrations (exit 0, ≈ 0,25 s). 0 ERROR. Os mesmos 472 WARNING da V0 (GRANT
em funções membro da extensão `vector`, que `postgres` não possui). A
function_acl, que inclui essas funções, bateu com o LIVE.

Antes do trigger, 11/12 projeções já eram iguais. A única diferença era 1
linha: o trigger ausente.

## Fase 7: trigger de signup (objeto ANIMA em schema gerenciado)

- **Fonte:** statement extraído literalmente de `supabase/migrations/20260528000001_functions_triggers.sql` (blob `15ad0506fce09bffb61688a325e5875bc7f50d8a`), da linha `CREATE TRIGGER on_auth_user_created` até o `;`. SHA-256 do trecho: `c30eea443d5508f1b04acf4294b37212da6213b38ca40d02e806f52bc6146912`. A migration inteira não foi executada.
- **Bootstrap:** aplicado sozinho, numa transação, no target.
- **Comparação:** `pg_get_triggerdef` e o estado habilitado batem com o LIVE (projeção `triggers` 18/18, `7e489204…`).
- **Outros objetos ANIMA em schemas gerenciados:** nenhum. Varredura das migrations: o único DDL em `auth`/`storage`/`realtime` é esse trigger. A inclusão de `public.work_events` em `supabase_realtime` veio pelo dump (projeção `publication_membership` igual).

## Fase 9: security equivalence gate

LIVE × RESTORED: **12/12 projeções iguais, 0 linhas de diferença**, logo
EXTRA ACL = 0 e MISSING ACL = 0.

| SECURITY DEFINER (92 funções) | LIVE | RESTORED |
|---|---|---|
| executáveis por anon | 4 | 4 |
| executáveis por authenticated | 85 | 85 |
| executáveis por service_role | 79 | 79 |

Nenhum papel executa algo que não executava no LIVE (extra 0, missing 0).

## Fase 10: data equivalence

Snapshot `supabase/restore-proof/data-snapshot.sql`, idêntico em todas as
chaves: auth users 24 / identities 23 / sem identity 1 / identities do
residente 1; fingerprint `6bb3c9ce147b492a`; work_items 124; work_events 1733;
last seq/id 54738 / `8ae122fc-…`; `work_events_digest` `8f46ca2a…`;
lineages 30; harness recoveries 3; claims 106; authorizations 44 (+1 event);
resume authorizations 1; reserved/settled/voided 58/18/2; digests de
work_items/budget/authorizations/lineage; storage 0/0; migrations
`20260927000001`/143, com histórico (version+name) `f69ad501…` igual.

## Fase 11: restart

`supabase stop` e `start` **só no target** (29 s). Depois do restart, o
snapshot de dados, os 12 digests de segurança (incluindo default ACL e
triggers) e o fingerprint ficaram idênticos ao pré-restart. As linhas de
segurança continuaram iguais ao LIVE.

## Fase 12: Resident Host (DEFERRED)

O caminho de boot do Resident Host (`scripts/resident-host.ts` →
`lib/resident-host/resident-host.ts`) **grava inevitavelmente**:

- `acquireIdentity`: sign-in GoTrue (grava sessão/refresh token e `last_sign_in_at` em `auth`);
- `reconcile` de arranque: resolve attempts/claims abertos;
- ciclos: host turns (claims/eventos) e materialização idle opcional.

Não há modo read-only. Conforme a regra da unidade, a prova **não foi
executada** e o host não foi modificado.

> Resident Host recovery proof requires a read-only recovery/probe mode.

## Fase 13: cleanup

- Target removido (`supabase stop --no-backup` em `anima-restore-proof-v01`); o volume `supabase_db_anima-restore-proof-v01` foi apagado. Só `supabase_db_anima` existe.
- Dumps plaintext, diretório do projeto descartável, logs de restore e arquivos `.rows` (linhas completas das projeções) apagados.
- LIVE final (07:05:37Z): snapshot de dados e 12 digests de segurança **idênticos** aos iniciais. O stack vivo seguiu no ar sem interrupção.

## Procedimento reproduzível (resumo)

1. `digest.sh` e `data-snapshot.sql` no LIVE (PRE).
2. Os 5 dumps do CLI (V0) e depois o POST, exigindo PRE == POST.
3. Target novo; `digest.sh` para capturar os defaults virgens.
4. Neutralizar os defaults de `postgres`/`public` para grantees não donos, derivados do passo 3.
5. Restore oficial (roles → schema → replica → data) e o histórico de migrations.
6. Aplicar o `CREATE TRIGGER on_auth_user_created` extraído da migration versionada.
7. Gate: 12 digests iguais e diff de linhas = 0; depois dados iguais; restart; repetir.

## Implementação

Só ferramentas read-only em `supabase/restore-proof/` (`security-projection.sql`,
`data-snapshot.sql`, `digest.sh`). Sem framework, scheduler, destino ou
dashboard. Neutralização e trigger continuam passos manuais documentados.

## Próximo

- Resident Host: exige um modo read-only de recovery/probe (unidade própria).
- Off-machine durability (destino, criptografia, retenção): não iniciado.

US$0. Sem provider, sem paid attempt.
