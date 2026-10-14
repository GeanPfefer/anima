# Provas D1 de restore

As ferramentas `memory-snapshot.sql`, `roles-projection.sql` e
`quiescence-gate.sql` são read-only: usam uma transação REPEATABLE READ READ ONLY,
não alteram dados ou objetos e nunca imprimem conteúdo de linhas nem material de
senha. Execute somente contra o container explicitamente autorizado para a prova.
Esta suíte de testes usa exclusivamente containers sintéticos isolados.

```bash
docker exec -i <container> psql -U postgres -d postgres -X -A -t -q -v ON_ERROR_STOP=1 < supabase/restore-proof/memory-snapshot.sql > memory.out
docker exec -i <container> psql -U postgres -d postgres -X -A -t -q -v ON_ERROR_STOP=1 < supabase/restore-proof/roles-projection.sql > roles.out
docker exec -i <container> psql -U postgres -d postgres -X -A -t -q -v ON_ERROR_STOP=1 -v min_quiet_seconds=300 < supabase/restore-proof/quiescence-gate.sql > quiet.out
LC_ALL=C sort memory.out
LC_ALL=C sort roles.out
LC_ALL=C sort quiet.out
```

Preserve o código de saída do psql antes de ordenar: não o esconda numa pipeline.
O gate imprime os diagnósticos em ordem canônica; ordenar serve para comparação.
Janela padrão: 300 segundos. Uma janela 0 ainda recusa ledger vazio.

Gramática de `memory-snapshot.sql` (n é inteiro não negativo; hex tem 64
caracteres hexadecimais minúsculos; nomes vêm do catálogo):

```text
table:<schema.tabela>=<n>:<hex>
coverage_tables_in_scope=<n>
fk_orphans:<schema.tabela.constraint>=<n>
constraints=<n>:<hex>
indexes=<n>:<hex>
columns=<n>:<hex>
sequence:<schema.seq>=<last_value>:<t|f>
```

Os digests preservam NULL versus string vazia, ordenam JSON por collation C,
unem por LF e usam SHA-256 UTF-8; tabelas vazias usam o hash da string vazia.
O escopo inclui tabelas base public/private/storage/supabase_migrations e
somente auth.users/auth.identities em auth. Constraints, índices, colunas,
sequências e órfãs de FK são projetados em public/private. Partições aparecem
individualmente e também no agregado da tabela particionada.
`session_replication_role=replica` desliga FKs na carga de um restore; por isso
`fk_orphans` verifica os relacionamentos independentemente da carga e da flag
convalidated. A contagem usa semântica MATCH SIMPLE (ignora FK com algum NULL).

Gramática de `roles-projection.sql`: `role|nome|login=bool|inherit=bool|super=bool|
createrole=bool|createdb=bool|repl=bool|bypassrls=bool|conn=inteiro|has_expiry=bool`,
`membership|papel|member=membro|admin=bool`, `role_setting|papel|banco|setting`,
`writer_schema_usage|schema|bool`, `writer_exec|schema.func(args)|secdef=bool`,
`writer_table|schema.rel|privilégio` e `auth_users_by_role|papel|n`.
Booleanos são true/false; papel/banco global usa `<all>`, papel NULL usa `<null>`.
Privilégios de tabela são SELECT/INSERT/UPDATE/DELETE efetivos. Funções de
extensões são excluídas. O papel anima_system_writer NÃO é restaurado por
pg_dump/roles.sql: exige bootstrap extraído da migration 20260928000003 antes do
schema. Sua ausência falha fechada com P0001 e código psql 3.

Gramática de `quiescence-gate.sql`, nesta ordem: `claims_open=n`, `claims_live=n`,
`claims_stale=n`, zero ou mais `stale_claim=hex8:AAAA-MM-DD` (UTC),
`supervision_leases_live=n`, `active_backends_other=n`, `ledger_seq_max=n|-`,
`ledger_last_event_age_s=inteiro|-`, `quiet_window_s=N`,
`quiescence_failures=códigos|-` e `quiescence_verdict=PASS|FAIL`.
Códigos, em ordem: claims_live, leases_live, backends_active, recent_events.
Ledger vazio ou evento mais novo que a janela falha fechado. Claim stale é
histórica: é reportada, preservada e nunca causa falha. Lease revogada não bloqueia.
FAIL imprime primeiro os diagnósticos e depois gera P0001 (`quiescence_failed`),
código psql 3. PASS termina com código 0. Outros erros SQL também encerram o
psql com código 3; erros de conexão/execução podem ter outros códigos não zero.

```bash
PYTHONDONTWRITEBYTECODE=1 python -B -m unittest discover -s supabase/tests -p restore_proof_snapshot_test.py -v
```

Requer Docker e imagem local `public.ecr.aws/supabase/postgres:15.8.1.085`.
Não faz pull nem usa portas/volumes. Indisponibilidade falha com mensagem clara;
`ANIMA_RESTORE_PROOF_ALLOW_SKIP=1` permite skip explícito para diagnóstico, mas o
gate Jest recusa qualquer skip. Nenhum teste usa o banco real.
