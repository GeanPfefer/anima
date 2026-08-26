# Recovery lineage — idempotência estrita

- **Data/tipo:** 2026-08-26 — desenvolvimento + prova local.
- **Objetivo:** reconciliar o substrato já existente de recovery lineage e fechar a menor lacuna real antes de materializar sucessores canônicos.
- **Branch / HEAD inicial:** `dev` / `23e1541`, igual a `origin/dev`; `origin/main` em `99bec54`, intocada.
- **Estado encontrado:** o commit `7556d03` já havia criado `work_recovery_lineage` e `propose_recovery_successor`: original precisa estar `failed`; sucessor nasce `proposed`; original/attempts permanecem intactos; 1..N sucessores; completion do sucessor não satisfaz automaticamente dependências do original; owner/RLS e ausência de autoridade financeira cobertos. O pgTAP original passou 14/14.
- **Lacuna real:** a mesma `idempotency_key` devolvia replay mesmo com razão/envelope divergentes; duas chamadas concorrentes podiam disputar o índice único em vez de convergir pelo contrato.
- **Mudança:** migration incremental `20260826000004` serializa owner+key por advisory transaction lock e aceita replay somente quando original, sequência, razão, impacto, capacidade, intent e proposal coincidem. Divergência falha com `22023/recovery successor idempotency conflict` antes de qualquer novo efeito.
- **Tipos:** `database.ts` foi regenerado do schema local; passa a incluir a tabela e a RPC de recovery que estavam ausentes no arquivo gerado.
- **Gate adjacente recuperado:** o typecheck amplo revelou três fixtures mobile antigas sem `manualReleaseAvailable`; apenas as fixtures receberam `false`, sem alteração de produção.
- **Provas:** pgTAP focado 16/16 PASS; mobile focado 2 suítes/28 testes PASS; typecheck de mobile, web, core, supabase e types PASS; `git diff --check` PASS.
- **Efeitos externos:** migration aplicada somente ao Supabase local; nenhum work item real, successor, approval, classification, claim, attempt, budget, provider, worktree, PR, merge ou deploy foi criado. `.worktrees/` e `.claude/settings.local.json` preservados.
- **Próxima lacuna:** o substrato persistente está seguro, mas ainda não existe uma capacidade da aplicação que interprete evidência terminal e formule/materialize, sob governança, o successor mínimo. O próximo recorte deve começar por classificação determinística da falha, sem transformar toda falha em retry.

