# 2026-08-19 (4ª) — Causa raiz da prova viva falha (gate fan-out no monorepo) + consolidação

**Tipo:** desenvolvimento + prova.

**Objetivo:** investigar a falha concreta da prova viva real (coder→gate) do handoff, consolidar o trabalho local não commitado, corrigir o menor recorte e reprovar ao vivo. Continua [2026-08-19 (2ª/3ª)](2026-08-19-planejador-local-selecionavel.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `d3de6e4`. **HEAD final:** `533ce86`. **`main`:** `99bec54` = `origin/main`, intacta, sem push.

## Evidência real da falha (Supabase local, work_events)

Attempt `025e5067-59f9-4485-a835-8d5b00e9e204` (item `e72138ed`), execução mais recente:
- `host_observed_coder_evidence`: outcome **succeeded**, backend `deepseek-harness:qwen3-coder:latest`, `durationMs` **174209** (a persistência SOMA os turns e usa o outcome do ÚLTIMO — não é prova de 1 único turn).
- `host_observed_gate_evidence`: 1 gate `npm.cmd test -- project-work-planner-selectable.test.ts`, outcome **failed**, exitCode **1**, `durationMs` 8774, não-timeout/não-cancel.
- `execution_failed`: **"O backend não produziu nenhuma alteração para revisão."**

## Causa raiz (classificação: (d) incompatibilidade contrato/infra — NÃO erro do coder)

O `validation_command` da proposta era `npm test -- project-work-planner-selectable.test.ts` **sem `--workspace`**. Na RAIZ do monorepo, `npm test` = `npm run test --workspaces --if-present` → fan-out para `apps/web`, `packages/core`, `packages/supabase`. O jest de core e supabase **não acha o arquivo → "No tests found, exiting with code 1"** → o gate reprova com exitCode 1 **SEMPRE**, independentemente da edição do coder. Reproduzido diretamente na raiz (`ROOT_GATE_EXIT=1`) e confirmado que a forma escopada passa (`npm test --workspace=apps/web -- … ` → 13/13). O `safeValidationCommand` aceitava a forma unscoped, então nada barrava a montagem de um gate inexecutável.

Secundariamente, nesta rodada o coder também não produziu mudança (no-op — variância do qwen3-coder). Mesmo uma edição perfeita falharia por causa do fan-out.

## Retry (step 7): política CORRETA, NÃO alterada

`gateRetryLimitForCoderBackend('deepseek-harness') = 1`. Pela lógica do `WorktreeExecutorAdapter`: o gate rodou (passou o early-return `noChanges && retryIndex>=gateRetryLimit`, logo `retryIndex(0) < gateRetryLimit(1)`), e `canRetry = exitCode≠0 && !timedOut && !cancelled && retryIndex<limit` foi verdadeiro → o retry **muito provavelmente disparou** (2º turn), somado na evidência agregada. A condição de retry é exatamente a exigida (só falha ordinária de gate; scope violation e backend throw retornam/lançam ANTES). **Nenhuma mudança de política** — sem prova de necessidade, e a correção do gate remove a falha estrutural que confundia o caso.

## Consolidação do trabalho local do handoff (verde) — commits

- `0b24938` — bin do DSH por CAMINHO FÍSICO (`resolveDeepSeekHarnessBinPath`), evitando `require.resolve` virar id de bundle Webpack (o que matava o DSH no bootstrap); `summarizeHarnessFailure` preserva o detalhe `MODULE_NOT_FOUND`.
- `95a4d32` — bridge de classificação do supervisor aceita `local_ollama_project_tools_v1` além de `openai_project_tools_v1`.
- `381ea7b` — planner local: observabilidade de timeout/transporte; `evidenceCalls` só conta quando a tool retorna `ok:true`; `includedScopeAnchoredInProject` (arquivo existente / novo com pai existente; dir inventado rejeitado) revalidado no adapter, host revalida por último.
- `4d56ef5` — correção de proposta faz REPLANEJAMENTO semântico (`planExecutableProjectWorkRevision`) em vez de anexar feedback ao escopo.

## Correção do menor recorte (causa raiz) — commit

- `533ce86` — `scopeTestCommandToWorkspace` + `workspaceForScope` (puros): o HOST reescreve `npm test -- <arquivo>` para `npm test --workspace=<ws> -- <arquivo>` quando todo o `included_scope` vive num único workspace (`apps/*`/`packages/*`). Aplicado no orquestrador ao montar `validation_criteria`, então a proposta que o humano aprova já fica correta. Escopo ambíguo/sem filtro/typecheck/build → inalterado. `safeValidationCommand` passou a aceitar `--workspace=` (o `GATE_PATTERN` já aceitava). NÃO afrouxa: o jest do workspace ainda exige o teste existir e passar.

## Prova viva do fluxo REAL após a correção (scratch, removida)

`planExecutableProjectWork` (planner unscoped) → HOST escopou para `npm test --workspace=apps/web -- project-work-planner-selectable.test.ts` → `WorktreeExecutorAdapter` + worktree Anima@HEAD + `createNodeDeepSeekHarnessBackend` (DSH real + qwen3-coder) → coder criou o arquivo em escopo → **gate exitCode 0** → handoff → **Verifier = `verified`** — na 1ª tentativa. O modo de falha exato do handoff (gate exit 1 por fan-out) virou **gate exit 0 → verified**. Nada aplicado/integrado (worktree e branch descartáveis, limpos).

## Provas / gates

`apps/web` áreas afetadas **146/146** (15 suítes: planner 31, harness, worktree-executor, executor-selection, supervisor-turn route, etc.); `typecheck` limpo. Prova viva real 1/1 `verified`.

## Invariantes preservadas

Supervisor→Executor→Reviewer/Verifier; Harness NÃO é autoridade de sucesso (turn completed ≠ sucesso; gate do host decide); host-observed git/gates autoritativos; gates NÃO afrouxados (escopar o gate o torna PRECISO, não permissivo); retry só em falha ordinária, mesmo attempt/worktree; node_modules junction só em gates, removido antes do retry; evidência de gate append-only; Resource Governor advisory; defaults de planner/coder INALTERADOS; sem push/PR/merge/deploy; `origin/main` intacta. Worktrees diagnósticos (`anima-dsh-failed-branch`, `anima-dsh-realrepo`), `.worktrees/`, `anima-local-test`, `.claude/settings.local.json`, `apps/web/.env.local` preservados.

## Limitações / não escondido

- Variância/qualidade do `qwen3-coder` como coder persiste (no-op ocasional). O host absorve fail-closed; NÃO afrouxar contrato.
- A contagem exata de turns do attempt falho não é recuperável do log agregado (soma), mas a política de retry foi verificada por código + regressões.
- A edição concreta do coder falho foi restaurada ao base (worktree limpo) — não recuperável; a causa raiz foi provada pelo gate, não pela edição.

## Próximo ponto exato de retomada

1. Nova prova viva pela UI real com a correção do gate (o handoff pode reprovar `npm test -- <arquivo>` agora escopado automaticamente).
2. Recomendação pendente (sessão 3ª): default do planner LOCAL → `qwen2.5:14b`; depois política de fallback local→nuvem com orçamento B calibrado. NÃO aplicado (sem mudar defaults).
3. Considerar advisory host-side de existência de path já implementado (`includedScopeAnchoredInProject`) também no planner OpenAI/orquestrador, se houver evidência de necessidade.
