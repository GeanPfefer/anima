# Project Builder V0 — T5: integração Git governada de candidato externo — 2026-10-26

Append-only. Tipo: **implementação** (migration incremental testada só em banco descartável + código + testes com repositórios Git reais). Formato de [`README.md`](README.md). Antecede: [`2026-10-25-project-builder-v0-t4-revisao-e-aceite-externo.md`](2026-10-25-project-builder-v0-t4-revisao-e-aceite-externo.md).

## Dados

- Branch `claude/t5-external-integration`, base `dev` = `origin/dev` = `c7be388f5a5f12b7149d2290a99bbc416c46b482`. `origin/main` = `99bec54e`, intacta. Não integrado em `dev`, não publicado.
- **Migration `20261026000000_external_integration_effect.sql` NÃO foi aplicada ao Supabase residente.** Foi aplicada (limpa, numa transação) e testada somente numa réplica descartável (`pg_dump` do residente restaurado em contêiner `t5-pg`, porta 54999).
- Nenhuma escrita nos work items reais (PROOF-EXT-01 `af70498b…`, PROOF-EXT-02 `2cf13fc8…`), no laboratório real, em `refs/heads/main` de qualquer repositório real, nem remoto/publicação.

## Contratos reutilizados (sem segundo pipeline)

`result_accepted` → `integration_effect_authorized` (evento do mesmo tipo, `author=user`) → executor → `integration_completed` pelo **mesmo** `record_integration_completed` e pelo Trusted System Writer. Reuso no core: `planIntegrationEffect`, `classifyIntegrationTarget`, `buildIntegrationEffectReceipt`, `integrationReceiptMatchesAuthorization`, `projectIntegrationStatus`, `integrationOperationKey` (todos generalizados com política por TIPO de autorização; o default interno é byte a byte o anterior). Reuso no web: `verifyExternalTargetForContract` (T1), `readExternalCandidate` e `externalAcceptanceRefusal` (T4), `evaluateVerifierRequirement`, `trusted-git`. Recibo `ff_only`: `mergeCommitSha` nulo, `mergeParents` `[]`, `resultingTargetSha` = commit candidato.

## Arquivos

- `supabase/migrations/20261026000000_external_integration_effect.sql` (aditiva) e `supabase/tests/external_integration_effect.test.sql` (62 asserções).
- `packages/core/src/work-orchestration/integration-effect.ts` (política externa opcional; `scope` em `planIntegrationEffect`) e `integration-effect.external.test.ts`.
- `apps/web/lib/work-orchestration/external-integration.ts` (config do host, provider Git, executor, autorização humana, lease) e `external-integration.test.ts` (21 testes, Git real).
- `apps/web/scripts/external-integration-run.ts` (operador: `authorize` / `execute`; não executado).
- `packages/types/src/database.ts`: três RPCs acrescentadas à mão (regenerar o typegen depois de aplicar a migration).

## Exclusividade física (persistente e transacional)

- Chave física derivada **no servidor** do `git_common_dir_canonical` do intent (`private.external_repo_key`: sha256 do caminho normalizado — barras, barra final, caixa só em caminhos Windows/UNC). Independe da referência textual: `ext:a` e `ext:b` sobre o mesmo repositório colidem.
- Tabela `external_repo_leases` com índice único parcial `(user_id, repo_key) WHERE released_at IS NULL`; escrita só por RPC (`acquire_external_repo_lease`, `release_external_repo_lease`); RLS de leitura própria. Aquisição serializada por `pg_advisory_xact_lock(user:key)`, recusa se houver lease vigente, **claim vigente** ou outro item **`in_progress`** com a mesma chave; lease vencido é liberado como `expired` (recuperação de queda sem intervenção); mesmo item+dono renova (idempotente).
- Trigger `BEFORE INSERT` em `work_claims` aplica a mesma regra a itens externos: nenhuma execução nasce enquanto há lease ativo no mesmo repositório (o inverso — lease recusado por claim/in_progress — também). Itens internos não são afetados.
- Item retido (`in_progress` sem claim, caso da PROOF-EXT-01) **bloqueia** a integração de outra referência no mesmo repositório: é intencional (ver GO/NO-GO).

## Estratégia Git com a branch em checkout

1. Destino **fora de checkout**: `update-ref <ref> <candidato> <esperado>` (CAS atômico do Git). 2. Destino em checkout na **worktree principal**: só se (a) config local sem filtro/driver/include/hooksPath/etc. (`unsafe_repository_config`), (b) nenhuma operação em andamento (MERGE_HEAD, rebase…), (c) `HEAD` simbólico no destino e no SHA esperado, (d) `status --untracked-files=all` vazio; então `merge --ff-only` (Git atualiza ref, índice e árvore) e confirmação posterior de que o valor anterior do ref (reflog) é o esperado; senão `reconciliation_required` sem recibo. 3. Destino em checkout numa worktree **vinculada**: recusa (`human_required`). Nunca merge commit, force, cherry-pick, hooks do repositório, fetch/push. O Git confiável (`--git-dir`, ambiente zerado, hooks/fsmonitor desligados) ignora a config global/sistema; por isso o `core.autocrlf` do operador é repassado só às operações de árvore (`operatorWorkTreeOptions`) — sem isso o `status` acusaria CRLF como edição.

## Recuperação e idempotência

Ordem: plano revalidado → gates (item `completed`, aceite vigente, Verifier `verified` correlacionado, revisão humana T4, candidato da attempt aceita) → identidade física relida → recibo já persistido? (prova pelo Git; `already_persisted`) → **lease** → identidade relida de novo, branch da attempt = candidato, destino classificado → mutação → releitura independente → recibo. Queda entre Git e Postgres: o retry classifica `already_effected` e grava recibo `reconciled` **sem nova escrita no ref**. Corrida no CAS: reclassifica sobre o fato observado. Lease não liberado expira.

## Compatibilidade com o banco residente

Migration só adiciona (tabela, funções, dois triggers). Réplica do residente: 215 itens internos → chave nula; os dois itens `ext:` existentes → mesma chave física; 0 leases. Suítes pgTAP existentes verdes com a migration aplicada na réplica: `integration_effect` 40, `integration_decision` 37, `target_exclusivity` 31, `commanded_target_exclusivity` 25, `work_claim` 31, `single_item_work_claim` 55. Os triggers só atuam em itens externos (claim) e em `integration_effect_authorized` (tipo coerente com o item).

## Provas

- pgTAP novo: 62/62 (chave/aliases, autorização válida/replay/conflito, destinos inseguros, Verifier ausente/inconclusive, tipo cruzado, recibo, lease/renovação/expiração/liberação/RLS, claim × lease × `in_progress`).
- **Concorrência real no banco** (duas sessões `psql` paralelas, mesma chave): uma adquiriu, a outra recebeu `external repository is held by an active lease`; um único lease aberto.
- Jest web (Git real): 21/21 — ff fora de checkout; ff em checkout (árvore/índice acompanham, sem merge commit); sujo; worktree vinculada; filtro hostil; destino divergente; corrida no CAS; queda antes do recibo + retry reconciliado sem nova escrita; retry idempotente e detecção de recibo não provado; sem revisão humana; Verifier ausente; item não `completed`; candidato errado; base divergente; destino/referência não configurados; identidade alterada (outro repo e clone); alias de referência bloqueado por lease; duas execuções simultâneas; CAS concorrente (exatamente um vence); hooks hostis (`post-merge`, `reference-transaction`, `post-checkout`, `pre-commit`) **não** executam, com controle provando que o Git comum os executaria; `GIT_DIR`/`GIT_WORK_TREE` do pai ignorados; repositório sem remoto.
- Core: 130 suítes / 3254 testes; `tsc` core e web limpos (ruído conhecido só em `scripts/_session`). Web: 19 suítes / 303 testes nas áreas tocadas (inclui `integration-effect.integration`, Single-Item, executor-selection, trusted-git/writer, T1–T4).

## Limites declarados

- A revisão humana (T4) e a identidade física são verificadas pelo **executor**; o banco garante Verifier `verified`, tipo, destino seguro e exclusividade, mas não lê mensagens do operador nem o Git.
- O banco serializa por repositório físico **do mesmo usuário**; ações Git feitas por humanos fora do Anima não passam pelo lease (o CAS e as pré-condições do checkout cobrem a corrida).
- Destino local único por host (`ANIMA_EXTERNAL_INTEGRATION`); publicação remota continua fora (`external_target_not_supported_downstream` permanece para o caminho interno).
