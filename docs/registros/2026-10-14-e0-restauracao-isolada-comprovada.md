# E-0 — restauração isolada comprovada (RUN e0-20261014T193034Z)

- **Data:** 2026-10-14 · **Tipo:** prova (operacional, sem código)
- **Branch:** dev · **HEAD inicial = final:** `f7c629aa` (= `origin/dev`)
- **Commits criados:** nenhum. **Código, migrations, banco residente e ledger: não modificados.**
- **Referências:** plano [070](../planos/070-d1-preparacao-e0-v2.md) §6 (procedimento), [069](../planos/069-e0-preflight-e-procedimento.md), ferramentas `supabase/restore-proof/`, registro V0.1 [2026-09-28](2026-09-28-operational-durability-backup-restore-v0-1.md).
- **Sem** senhas, segredos, tokens ou conteúdo de linhas neste registro.

## Objetivo

Provar que um backup lógico do banco residente, passando por um repositório restic, restaura num banco descartável com equivalência exata ao estado de origem (PRE).

## Cadeia (backup → restauração)

1. **PRE** no residente (quiescência PASS; seq 86765; 0 claims/leases vigentes; 1 stale histórica `85000000:2026-07-27`, preservada). Projeções: 12 digests de segurança, `data-snapshot`, `memory-snapshot`, `roles-projection`, âncora do ledger.
2. **Dump** (5 arquivos do CLI) e **POST** (PRE == POST) e um `pre-recheck` (idêntico).
3. **restic** 0.19.1: snapshot `77b180ce`, repositório `336573507f` (ato humano, senha interativa); `restic check --read-data` **PASS**; `restic restore` concluído.
4. **SHA-256 dos 5 dumps restaurados == originais (5/5)**, conferido de novo imediatamente antes de usá-los:

| Arquivo | Bytes | SHA-256 |
|---|---|---|
| data.sql | 9644496 | `7099843c9cdb6a8b2b92a821fb0845dcc83efd97b653d62d1df52786ebe2fd12` |
| history_data.sql | 1016874 | `585be95f2e1337ca3b3c3e291b1d96a281a474238afa53f54b494235d4133975` |
| history_schema.sql | 885 | `9c15cd48dec925fc43383625c328a2fb2202f81797178f87f8b5c005701c12b4` |
| roles.sql | 426 | `6a0eae5d294eb28de5780cf62c925c75c7633b89a195e0f792f42ea535da4352` |
| schema.sql | 692022 | `0347cda90256806ee1a2deffb34126307f8843444b6e2bc7838207e86e87e5d5` |

5. **Alvo descartável** `anima-restore-proof-e0` (autorizado em chat): API 56320, DB 56321, shadow 56322; volume `supabase_db_anima-restore-proof-e0` e rede próprios (mounts distintos do `supabase_db_anima`). Imagens iguais às do residente (postgres 15.8.1.085, gotrue v2.189.0); CLI 2.105.0.
6. **Restauração só no alvo:**
   - alvo virgem: `default_acl` 319 linhas `f5ea13c7…` (= vivo);
   - neutralização de defaults (3 `ALTER DEFAULT PRIVILEGES … REVOKE ALL`);
   - uma transação, `ON_ERROR_STOP=1`: `roles.sql` → bootstrap idempotente de `anima_system_writer` (linhas 29–34 da migration `20260928000003`, extraídas literalmente) → `schema.sql` → `data.sql`: **exit 0, 0 ERROR, 472 WARNING** (todos "no privileges were granted", funções da extensão `vector`; esperados);
   - histórico de migrations: exit 0, 0 ERROR;
   - `CREATE TRIGGER on_auth_user_created`, extraído de `20260528000001` (SHA-256 do trecho `c30eea443d5508f1b04acf4294b37212da6213b38ca40d02e806f52bc6146912`): exit 0.

## Resultados

Comparação byte a byte com o PRE, **duas verificações** (run 1 após o restore; run 2 após reiniciar o alvo): **5/5 idênticos em ambas**.

| Projeção | Resultado |
|---|---|
| security.digest (12/12) | idêntico |
| data-snapshot | idêntico (work_events 3236; work_items 210; auth.users 25; identities 24; migrations 156) |
| memory-snapshot | idêntico: 48 tabelas em escopo (cobertura == escopo), constraints 279 (`35fee779…`), indexes 134 (`d06067fa…`), columns 369 (`eac67a72…`) iguais, sequências iguais (`work_events_seq_seq=86765:t`), digests por tabela iguais (perfis, pilares, evidências de identidade, notas, conversas, ledger) |
| roles-projection | idêntico (papéis, memberships, EXECUTE do writer, `auth_users_by_role`) |
| ledger-anchor | idêntico (`seq_max=86765`, count 3236, mesmo `last_id`) |

Verificações diretas no alvo: `anima_system_writer` NOLOGIN/NOINHERIT; `authenticator` é membro; `auth.users.role=anima_system_writer` em 1 linha; trigger habilitado; gate de quiescência PASS (mesma stale).

## Exceção das 14 órfãs de FK (decisão humana, só neste RUN)

Preservadas, não corrigidas: `profiles.profiles_id_fkey` = **9**, `work_contexts.work_contexts_work_item_id_fkey` = **5**, as outras 86 FKs = **0**. O alvo reproduziu exatamente esses números nos dois runs. Continua sendo **dívida de integridade** aberta, causa histórica não determinada; ver `EXCECAO-orfas-fk.md` nas evidências.

## Desvios e erros

- **Realtime:** o alvo foi criado com Realtime desligado. A primeira comparação mostrou 2 linhas de diferença em `roles-projection` (papel `supabase_realtime_admin` e sua membership), criado pelo serviço Realtime. **Resolução:** Realtime habilitado no config do alvo (mesmo conjunto de serviços do residente) e alvo reiniciado; o papel não foi criado à mão. Os runs 1 e 2 válidos foram ambos feitos depois disso.
- **data-snapshot:** a primeira execução falhou por erro de ferramenta (faltava `-v email`, variável `ANIMA_RESIDENT_EMAIL` lida em memória, nunca impressa). Reexecutada corretamente. Único erro SQL do RUN; nenhum erro de dados.
- O diff transitório das duas ocorrências acima foi de ferramenta/configuração, não de dados restaurados.

## Reinício e residente

- Reinício só do alvo (`supabase stop` + `start`, volume preservado): StartedAt 19:56:31Z → 19:57:36Z; provas repetidas (run 2) idênticas.
- **Residente inalterado:** `supabase_db_anima` StartedAt 18:12:31Z, 0 restarts, healthy; projeções finais do residente **5/5 == PRE**; gate PASS; seq 86765; 0 claims/leases vigentes; mesma stale; volumes = `open-webui`, `supabase_db_anima` + o do alvo. `supabase_vector_anima` já estava em loop de restart antes do RUN (preexistente, sem relação).

## Invariantes e efeitos externos

Nenhum SQL de restauração contra o residente; nenhum attempt, Host ou lease; nenhuma escrita no ledger; nenhuma migration/código; nada commitado ou publicado; custo US$0; nenhuma rede externa além de containers locais.

## Limitações — o que o E-0 NÃO prova

- Prova **local**: mesma máquina, mesmo Docker, mesmo disco; **sem failover** nem recuperação em **outra máquina**.
- `restic-repo` está na mesma máquina (G:); uma falha do disco/máquina perde banco e backup. Sem cópia off-site.
- Chave de recuperação única = a senha do humano (há 2 chaves no repositório, ambas dependentes de senhas guardadas pelo humano).
- Prova o lógico (SQL dump/restore) de **um instante**; não prova PITR, restauração de storage (vazio) nem tempo de recuperação sob carga.
- As 14 órfãs são reproduzidas fielmente, não validadas como corretas.
- `restic check --read-data` e `restic restore` foram atos humanos relatados no RUN; este registro não os reexecutou (exigem senha).

## Riscos residuais (plaintext)

- Os dumps são texto claro em `G:\anima-durability\scratch\e0-…\dumps` e `from-restic`; apagar no NTFS/SSD **não é apagamento seguro** (blocos permanecem até reescrita; TRIM não garante).
- O volume do alvo vive no `docker_data.vhdx` em C:; remover o volume não zera os blocos do VHDX.
- Dumps passaram por `pagefile.sys`/cache; antivírus em tempo real pode ter lido os arquivos.
- Administradores locais têm controle da pasta (ACL não protege contra admin).
- Nenhuma shadow copy verificada em G:.

## Estado ao encerrar este registro

Alvo **ainda ativo**; dumps, scratch, evidências e restic-repo **preservados**. Limpeza pendente de autorização separada; inventário em conversa (sessão 2026-10-14).

## Evidências (sanitizadas: hashes e contagens)

`G:\anima-durability\evidence\e0-20261014T193034Z\` (fora do Git): `pre/`, `pre-recheck/`, `post/`, `target-run1/`, `target-run2/`, `resident-final/`, `target/` (config, scripts, logs de erro), `dumps.sha256`, `dumps.bytes`, `EXCECAO-orfas-fk.md`.

## Próximo ponto de retomada

1. Humano autoriza (ou não) a limpeza do passo 10 do plano 070 §6.
2. Depois: atualizar este registro por **novo** registro apontando a limpeza concluída (append-only).
3. Pendências de durabilidade fora do E-0: cópia off-site, teste em outra máquina, tratamento das 14 órfãs.
