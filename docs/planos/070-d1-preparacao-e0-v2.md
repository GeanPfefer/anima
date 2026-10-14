# 070 — D1: preparação do E-0, bloqueios A/B/C e procedimento v2

Atualiza `069-e0-preflight-e-procedimento.md` (o passo a passo do 069 é
substituído pela seção 6 deste documento). Nenhum dado real do ANIMA foi
dumpado, copiado ou usado para inicializar repositório. US$0. Git e Supabase
intactos (`HEAD b6d2dda`; `work_events` seq 86721 antes e depois).

## 1. Ambiente preparado

| Item | Resultado |
|---|---|
| restic | **0.19.1** (`go1.26.4 windows/amd64`), instalado via WinGet (`restic.restic`, fornecedor restic, repositório `github.com/restic/restic`, instalador portable `restic_0.19.1_windows_amd64.zip`). SHA-256 do instalador `da948ad7…de67d` = linha do `SHA256SUMS` oficial do release v0.19.1 = verificação do WinGet. Assinatura GPG do `SHA256SUMS` não verificada (a tag do release aparece como “Verified” na página). Alias: `C:\Users\GeanTeco\AppData\Local\Microsoft\WinGet\Links\restic.exe` |
| Estrutura | `G:\anima-durability\{restic-repo, scratch, evidence}` criada. `restic-repo` **vazio** (sem `init`) |
| ACL | Aplicada **antes** de qualquer subdiretório ou arquivo, com SIDs (sem `%USERNAME%`): `S-1-5-21-…-1001` (GOMA\GeanTeco), `S-1-5-18` (SYSTEM), `S-1-5-32-544` (Administradores), todos `(OI)(CI)F`, herança desativada. Proprietário: `GOMA\GeanTeco`. Verificado: 3 ACEs explícitas, nenhuma de Users/Authenticated Users/Everyone, subdiretórios e arquivos herdam o mesmo conjunto. `G:\` e `G:\anima` não foram alterados (`G:\` ainda tem “Usuários autenticados: Modificar”, como antes) |
| Aviso | Administradores locais mantêm controle total (por necessidade); a restrição não vale contra um administrador |

### 1.1 Teste sintético do restic (diretório e repositório apagados depois)

Dados aleatórios/sintéticos (3 MB aleatórios + texto + 100 B); senha descartável gerada e usada só em processo.

| Verificação | Resultado |
|---|---|
| `init`, `backup`, `check --read-data` | OK (`no errors were found`, 2/2 packs lidos) |
| `restore latest` → hashes dos 3 arquivos | **iguais** ao original |
| Senha errada | `Fatal: wrong password or no key found` |
| `key add` (segunda chave) | OK; a 2ª senha abre o repositório; `key list` com 2 chaves |
| Corrupção: 1 byte alterado em cópia de um pack | `check --read-data` → `repository contains errors`, **exit 1** |
| Senha em argumentos / ambiente persistente | Nenhum processo restic vivo ao final; `RESTIC_PASSWORD` ausente em escopo User e Machine |
| Layout do restore | restic restaura o caminho absoluto (`restored\G\…`). **No E-0 executar a partir do diretório de scratch com caminhos relativos** para obter árvore previsível |
| Não testável sem terminal | O prompt interativo oculto (exige TTY). Mantido como requisito de aceite do primeiro `init` real |

## 2. Bloqueio A — snapshot de memória: contrato

### Diagnóstico
`data-snapshot.sql` (V0.1) cobre auth e o ledger de trabalho. **Nenhuma** tabela de memória, identidade, diário, quests ou XP tem digest. Também não havia prova de integridade relacional: o restore roda com `session_replication_role = replica`, que **desativa as FKs na carga** (88 FKs em `public`/`private`, 14 para `auth`).

### Inventário (todas as 41 tabelas de `public`/`private` têm chave primária)

| Domínio | Tabelas | Linhas |
|---|---|---|
| Identidade | `profiles` 34, `user_pillars` 88, `identity_hypotheses` 24, `identity_evidence` 97, `semantic_entities` 42, `entity_mentions` 5, `entity_pillars`, `pillar_catalog`, `pillar_relationships` | — |
| Memória narrativa | `ai_conversations` 394, `conversation_sessions` 50, `notes` 19, `insights` 2, `entry_embeddings` 26 | — |
| Diário/progresso | `life_events` 0, `quests` 6, `quest_missions` 0, `xp_records` 26 | — |
| Ledger e governança | `work_*`, `paid_compute_*`, `project_backlog_*`, `project_decision_*`, `private.*` | `work_events` 3192 |
| Conta | `auth.users` 25, `auth.identities` | — |

Tipos presentes: uuid, text, timestamptz, jsonb, enum, `vector`, bytea, inet, arrays, json.

### Contrato da projeção (rascunho testado: `evidence\prep-d1\memory-snapshot.sql`, SHA-256 `65db6653…a3d`)

1. **Escopo por catálogo**: toda tabela base de `public`, `private`, `storage`, `supabase_migrations` + `auth.users` e `auth.identities`. Uma tabela futura entra sozinha; a linha `coverage_tables_in_scope` deve ser igual ao número de linhas `table:`.
2. **Linha** = `to_jsonb(t)::text` com `TIME ZONE 'UTC'`: NULL JSON ≠ `''`; chaves jsonb canônicas; `vector`, bytea, inet, array e enum serializados pelo próprio Postgres.
3. **Ordem** = pelo texto canônico da linha sob `COLLATE "C"` (não depende do tipo ou da collation da PK nem da ordem física de inserção).
4. **Digest** = `contagem:sha256(linhas unidas por LF)`; tabela vazia = `sha256('')`.
5. **Relações**: por FK, contagem de órfãs (MATCH SIMPLE) = **0**; digest de constraints (inclui `convalidated`), de índices e de colunas; estado de cada sequência (`last_value:is_called`), para que o ledger não reuse `seq` após o restore.
6. **Saída**: só `chave=valor`; sem conteúdo de linhas. `auth.users` entra como digest agregado (a coluna de hash de senha participa do SHA-256, nunca é impressa).
7. Executa em `REPEATABLE READ READ ONLY`, sem criar funções (usa `\gexec`).

### Teste sintético (container descartável da imagem pinada `postgres:15.8.1.085`, já removido)

| Teste | Resultado |
|---|---|
| Reexecução | idêntica |
| Mesmas linhas inseridas em ordem inversa (outro banco) | idêntica |
| Alterar 1 célula, NULL→`''`, 1 componente de `vector`, 1 chave jsonb | cada um muda **só** o digest da tabela afetada |
| Mudar `setval` da sequência do ledger | muda só `sequence:` |
| Órfã criada com `session_replication_role=replica` | `fk_orphans` passa a 1 |
| Coluna adicionada | mudam `columns` e o digest da tabela |
| Revertendo tudo | igual ao baseline |
| Bug encontrado e corrigido no rascunho | `"char" || text` ambíguo (`contype`); corrigido com `::text` |

**Limite**: o rascunho não foi executado contra o banco real (fora do mandato). A primeira execução real (PRE do E-0) será o aceite; em caso de erro de SQL, parar.

## 3. Bloqueio B — papéis PostgreSQL: diagnóstico definitivo

Fatos lidos (somente catálogo do banco vivo):

- `anima_system_writer` é criado **só** pela migration `20260928000003_trusted_system_writer.sql`: `CREATE ROLE … NOLOGIN NOINHERIT` (dentro de `DO … IF NOT EXISTS`), seguido de `GRANT anima_system_writer TO authenticator` e `GRANT USAGE ON SCHEMA public`. A `20261003000000` acrescenta `GRANT EXECUTE … record_integration_completed`.
- Atributos no vivo: `login=f inherit=f super=f createrole=f createdb=f repl=f bypassrls=f connlimit=-1`, sem validade, sem `pg_db_role_setting`.
- Membership: **`authenticator` é membro** de `anima_system_writer` (`admin=f`). Nenhum outro papel é membro dele.
- Privilégios: EXECUTE em 12 funções de `public` (5 não herdadas de `anon`); USAGE em `public`. Estes entram no dump de schema como `GRANT … TO anima_system_writer`.
- Dados: `auth.users.role = 'anima_system_writer'` em 1 linha; `private.trusted_system_writers` com 1 registro.

Comportamento empírico (cluster sintético, mesma imagem):

| Ferramenta | CREATE ROLE | GRANT de privilégios ao papel | Membership `→ authenticator` |
|---|---|---|---|
| `pg_dump -s` (base do `schema.sql`) | **não** | sim (2 linhas) | **não** |
| `pg_dumpall --roles-only` | sim | — | sim |
| Restore do `schema.sql` num cluster sem o papel | **aborta**: `role "anima_system_writer" does not exist` (`ON_ERROR_STOP`) | — | — |

O `roles.sql` do CLI (`--role-only`) teve 297 bytes na V0/V0.1: é filtrado e quase certamente **não** contém o papel (conferência real = `grep -c` no arquivo, sem ler conteúdo). **Conclusão**: o procedimento `roles → schema → data` **não restaura** o papel por si. Sem tratamento, o restore falha de forma segura (aborta), mas a prova V0.1 não o cobriria.

### Contrato
1. **Passo de bootstrap de papel** antes do `schema.sql`: executar, no alvo descartável, o bloco `DO … CREATE ROLE anima_system_writer NOLOGIN NOINHERIT` e `GRANT anima_system_writer TO authenticator` **extraídos literalmente** da migration versionada `20260928000003` (com SHA-256 do trecho registrado, como foi feito para o trigger de `auth.users`). Não executar a migration inteira.
2. **Projeção de papéis** (rascunho testado: `roles-projection.sql`, SHA-256 `fed00b81…07`): `role|…`, `membership|…`, `role_setting|…`, EXECUTE efetivo do writer nas SECURITY DEFINER e `auth_users_by_role`. Nunca lê `rolpassword`. Teste sintético: sem o papel, a projeção diverge nas linhas `role|` e `membership|`.
3. Aceite: projeção do alvo == projeção do vivo; `function_acl`/`table_acl` já cobrem os GRANTs ao writer (a projeção V0.1 lista todos os grantees).
4. Nada foi criado, alterado ou concedido no banco residente.

## 4. Bloqueio C — claims: definição canônica

Fontes: `20260721000001_work_claims.sql` (tabela, índice único por item entre abertos, `acquire_work_claim` libera claim vencido “com razão declarada, linha preservada”), `20260721000004` (exclusividade por `(user, target_reference)`), `20260721000007` (supervisor: lease = `expires_at`), `work_supervision_leases`.

| Termo | Definição |
|---|---|
| Claim **aberta** | `released_at IS NULL` (invariante: no máximo 1 por item e por alvo) |
| Claim **vigente (live)** | aberta **e** `expires_at > now()` — segura o item; `acquire` falha com `55000` |
| Claim **vencida não liberada (stale)** | aberta **e** `expires_at <= now()` — o lease acabou; é recuperável: o próximo `acquire`/reconciliação a libera com `release_reason='expired'` e registra evento |
| Claim liberada | `released_at IS NOT NULL` (`attempt_finished`, `released_without_attempt`, `expired`) |
| Lease de supervisão **vigente** | `revoked_at IS NULL AND expires_at > now()` |

Estado medido: 184 claims; **0 vigentes**; **1 stale** (aberta, vencida, item em `in_progress`, 8 eventos, `2026-07-27`, id iniciando em `85000000`); 2 liberadas por `expired`; 181 `attempt_finished`; 62 leases de supervisão, **0 vigentes**; 0 backends não ociosos; último evento do ledger às 06:20 UTC, sem escrita desde então (seq 86721 estável). O “1” do preflight era a stale; **não há claim vigente** e a conta “0 claims vigentes” estava correta.

### Contrato do gate de quiescência (rascunho testado: `claims-gate.sql`, SHA-256 `84791d0f…29`)
- **PASS** se: `claims_live = 0`, `supervision_leases_live = 0`, `active_backends_other = 0`, `ledger_last_event_age_s >= 300`, nenhum Resident Host/`next dev`/attempt em execução (verificação de processos fora do SQL).
- **Stale não bloqueia, mas é enumerada** (`stale_claim=<8 hex>:<data>`) e deve ser idêntica no PRE e POST: é dado histórico, e **liberar a stale é escrita no ledger e fica proibido** durante o E-0.
- A linha de julho não é modificada.
- Efeito colateral a registrar: a stale pode impedir novo `acquire` do item até a reconciliação; não afeta o backup.

## 5. Item governado proposto (NÃO criado, NÃO aprovado)

**Título**: “Durability D1: ferramentas de prova read-only para o E-0”.
**Escopo exato** (arquivos novos; nenhum existente é alterado):
- `supabase/restore-proof/memory-snapshot.sql`
- `supabase/restore-proof/roles-projection.sql`
- `supabase/restore-proof/quiescence-gate.sql`
- `supabase/restore-proof/README.md` (comandos, saída esperada, o que não imprimir)
- Teste `supabase/tests/restore_proof_snapshot_test.py` (unittest) que sobe um container sintético da imagem pinada e reproduz a tabela de testes das seções 2–4 (reexecução, ordem, mutações, órfã, sequência, papel ausente, gate com stale); pula se Docker/imagem ausentes; **sem tocar** `supabase_db_anima`.
**Fora de escopo**: runner do E-0, restic, qualquer dump real, migrations, código de produção em `apps/web`/`packages`.
**Aceite**: teste sintético verde; `git diff --check` limpo; arquivos `.sql`/`.sh` com LF; nenhum dado real em fixtures; a saída das ferramentas não contém conteúdo de linhas.
**Origem do conteúdo**: os rascunhos em `G:\anima-durability\evidence\prep-d1\` (hashes na seção 2/3/4). Precisa de novo mandato para aprovar e executar.

## 6. Procedimento E-0 v2 (não executado)

Convenções: `E=G:\anima-durability`, `RUN=e0-<UTC>`. **[H]** = você digita em seu próprio terminal (senha interativa); demais passos, o Claude prepara/confere.

0. **Pré-condição**: item governado da seção 5 integrado (ou, alternativa autorizada, rascunhos executados a partir de `evidence\prep-d1` com hashes conferidos). Gate de entrada: `HEAD` registrado; `git status` sem mudança além do esperado; Docker saudável; só `supabase_db_anima` e `open-webui` como volumes; versões iguais (CLI 2.105.0, Postgres 15.8, imagens `15.8.1.085`/`v2.189.0`, restic 0.19.1); RAM livre ≥ 4 GB; `C:` ≥ 10 GB; nenhum host residente/`next dev`/attempt; `quiescence-gate.sql` em PASS; portas 56320–56324 livres.
1. **PRE**: `digest.sh` (12 projeções), `data-snapshot.sql`, `memory-snapshot.sql`, `roles-projection.sql`, âncora do ledger. Saída só em `evidence\<RUN>\pre\` (hashes e contagens); `.rows` em `scratch`.
2. **Dump** (5 arquivos do CLI) para `scratch\<RUN>\dumps\`; **POST** (mesmos digests); exigir PRE == POST. SHA-256 e bytes de cada arquivo. Conferir por `grep -c` se `roles.sql` menciona `anima_system_writer` (só contagem).
3. **[H]** `restic init --repo G:\anima-durability\restic-repo` (prompt oculto) e `restic key add` (2ª chave, guardada à parte).
4. **[H]** A partir de `scratch\<RUN>`: `restic backup --tag e0 --repo … dumps pre-manifest` (caminhos relativos).
5. **[H]** `restic check --read-data` e `restic snapshots`.
6. **[H]** `restic restore latest --target scratch\<RUN>\from-restic`; comparar SHA-256 dos 5 arquivos com os do passo 2; só então apagar os dumps originais.
7. **Alvo descartável** (`anima-restore-proof-e0`, portas 56320–56324, volume próprio; serviços não essenciais desligados se RAM < 2,5 GB; GoTrue mantido): `digest.sh` no alvo virgem; neutralizar defaults (3 `ALTER DEFAULT PRIVILEGES … REVOKE ALL`); **bootstrap do papel** (seção 3.1); `roles → schema → replica → data` em transação com `ON_ERROR_STOP`; histórico de migrations; `CREATE TRIGGER on_auth_user_created` extraído (SHA `c30eea44…`).
8. **Comparação**: 12/12 digests, `data-snapshot`, `memory-snapshot` (incluindo `fk_orphans=0`, sequências, constraints/índices/colunas), `roles-projection`, âncora do ledger; reiniciar **só o alvo** e repetir.
9. **Vivo intacto**: digests/snapshots do vivo == PRE; sem reinício; `seq` inalterado; mesma stale claim.
10. **Encerramento**: `supabase stop --no-backup` do alvo, remoção do volume `supabase_db_anima-restore-proof-e0` (nome exato conferido), apagar `scratch\<RUN>`; permanecem `restic-repo` e `evidence`.
11. **Registro** sem conteúdo, sem segredos e sem senha, com o risco residual (NTFS/SSD sem apagamento seguro; blocos do VHDX em C:; pagefile; antivírus; repositório na mesma máquina; chave única = sua senha).

### Condições de parada (acrescenta às do 069)
Gate de quiescência ≠ PASS; erro de SQL na primeira execução dos rascunhos; `fk_orphans` ≠ 0 ou cobertura ≠ tabelas em escopo; papel `anima_system_writer` ausente após o bootstrap; stale diferente entre PRE e POST; qualquer diferença nas projeções.

## 7. GO / NO-GO para o backup real

**NO-GO hoje para gerar dump real**, por um motivo só: as três ferramentas (`memory-snapshot`, `roles-projection`, `quiescence-gate`) existem como rascunhos validados em ambiente sintético, mas **não estão versionadas, integradas nem executadas contra o banco real**; criá-las no repositório exige o item governado da seção 5 e novo mandato.

**GO condicionado** para o E-0 após: (1) mandato do item da seção 5 (ou autorização explícita para usar os rascunhos de `evidence\prep-d1` diretamente); (2) você gerar a senha e estar presente nos passos **[H]**; (3) RAM ≥ 4 GB livres no dia (era 4,9 GB); (4) aceitar o risco residual da seção 6.11.
Tudo o mais está pronto: restic instalado e testado, diretório e ACL verificados, bloqueios A/B/C diagnosticados com contrato.
