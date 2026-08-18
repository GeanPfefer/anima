# 2026-08-18 — DeepSeek Harness como CoderBackend candidato (seam + política pura)

**Tipo:** desenvolvimento.

**Objetivo:** introduzir o menor recorte versionável e arquiteturalmente correto para o **DeepSeek Harness** como candidato real de `CoderBackend` do Anima, **sem editar `node_modules`** e **sem substituir o `WorkExecutor`**, a partir da evidência do POC (concluído fora deste repo). Ver o desenho e as fronteiras em [`docs/arquitetura/deepseek-harness-coder-backend.md`](../arquitetura/deepseek-harness-coder-backend.md).

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `3667395`. **HEAD final:** `df8196e` (2 commits de código; este registro adiciona um 3º).
**`main`:** `99bec54` = `origin/main`, **intacta, sem push** (a branch segue N commits à frente, sem publicação).

## Commits criados

- `9e43086` — Modele o ciclo de vida do turno do Harness como política pura do host.
- `df8196e` — Introduza o DeepSeek Harness como CoderBackend candidato (adaptador por porta).
- (este registro + o design note de arquitetura — commit de documentação a seguir.)

## Mudanças relevantes

- `packages/core/.../harness-turn-lifecycle.ts` (novo) — política **pura** do host, sem importar o Harness: `decideHarnessPreStep` (decisão do hook `agent/pre-step`; cancela ao ultrapassar o orçamento com o motivo durável `step-budget-exhausted:N`; fail-closed em passo malformado), `classifyHarnessTurnEnd` (normaliza o `turn/end` num desfecho **observado** que nunca é sucesso; `completed` ⇒ `completed-unverified`), `resolveHarnessStepBudget`/`harnessStepBudgetReason`, e `POC_HARNESS_STEP_BUDGET=12` marcado como dado do POC.
- `apps/web/.../coder-backend.ts` — `CoderWorkspace.rootPath?` (cwd absoluto da worktree, só na execução local; backends que só propõem o ignoram, o enraizado o exige e falha fechado); `CoderProvider` ganha `'deepseek-harness'` (fonte única do id).
- `apps/web/.../worktree-executor.ts` — o host preenche `rootPath: worktree.root` no workspace (1 seam; não afrouxa git/escopo/gates/restauração).
- `apps/web/.../deepseek-harness-coder.ts` (novo) — porta `HarnessRuntime` (injeção; superfície pública mínima `runTurn` com `create`/`resume`, `temperature`, ferramentas, `stepBudget`, hook `onPreStep`, `AbortSignal`) e `DeepSeekHarnessCoderBackend` (liga o hook à política do core; classifica o `turn/end`; `error` lança, os demais devolvem para o host observar; não atesta arquivos tocados; não vaza `rootPath`). Defaults do POC configuráveis: `temperature=0`, orçamento `12`, `str_replace_editor` desabilitada.
- `docs/arquitetura/deepseek-harness-coder-backend.md` (novo) — design note **Candidato, não ratificado**.

## Decisões

- **Harness = `CoderBackend`, não `WorkExecutor`.** Host mantém worktree, git observado, escopo, gates, cancelamento, Resource Governor, commit/handoff, Verifier e a **decisão de sucesso**.
- **Runtime por injeção (porta), sem `node_modules`.** O adaptador é versionável e testável com runtime falso; a ligação com o `@deepseek-ai/dsh` fica isolada na borda — e **não** é feita neste ciclo (pacote não instalado; API a verificar; fronteira `pwsh` a ratificar).
- **`completed`/exit 0 nunca é sucesso** — codificado no tipo (`completed-unverified`) e na política; os gates do host decidem.
- **Config do POC como default configurável, não ratificada** (`temperature=0`, orçamento `12`, `str_replace_editor` desabilitada).
- **Escopo do host já é tracked + untracked-safe:** `changedFiles` faz `git add -A` antes de `git diff --cached`; a lacuna do POC (ponto 7) é do `git diff` cru, que o host não usa. **Nenhuma correção necessária** aqui.

## Provas / gates executados

- `packages/core` Jest: **908/908** (41 suites; +13 do `harness-turn-lifecycle`).
- `apps/web` Jest: **549/549** (49 suites; +12 do `deepseek-harness-coder`), incluindo `worktree-executor.test.ts` (exercita o seam `rootPath`) e as integrações git.
- `typecheck`: **5/5** workspaces verdes.
- Flakes conhecidos: nenhuma regressão. (Uma execução truncada do web reportou `npm error code 1` sem falha de teste; a re-execução completa saiu 0 com 549 verdes.)

## Invariantes de segurança preservadas

- Worktree isolada; nenhuma alteração no workspace original; nenhum merge/push/apply automático; gates obrigatórios (allowlist); restauração ao base; resultado para revisão humana.
- O adaptador não decide sucesso e não atesta arquivos tocados. `rootPath` (caminho absoluto) nunca entra em `summary`/`notes`/evidência.
- **Fronteira NÃO cruzada:** `pwsh`/shell arbitrário do Harness no worktree **real** é expansão de autoridade de segurança além da allowlist de gates → exige evidência + ratificação humana (Marco 005/006). Por isso a ligação viva não foi feita.

## Efeitos externos

- **Nenhum push, PR, merge, deploy, `integrated` ou alteração de `origin/main`.** Nenhuma credencial usada. Nenhuma dependência externa instalada (`@deepseek-ai/dsh` **não** foi adicionado). `node_modules` intacto.

## Worktrees / ambientes preservados

- `.worktrees/mobile-completed-result` e `.worktrees/roadmap-003-006` (trabalho de terceiros/operador) e `G:\anima-local-test` — **preservados, não tocados**. `.worktrees/` segue untracked, nunca estagiado. `.claude/settings.local.json` e `apps/web/.env.local` intactos.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- Instalar/vendorar o `@deepseek-ai/dsh` e verificar sua API pública.
- Ratificar (ou não) a fronteira de segurança do `pwsh`/shell arbitrário no worktree real.
- Ratificar (ou não) Harness como default, orçamento `12`, retry `1`, remoção universal de `str_replace_editor`.

## Próximo ponto exato de retomada

Com a decisão humana acima: (1) implementar o `HarnessRuntime` real na borda (importando o `dsh`: `ctx.agents.create`/`resume`, `temperature`, ferramentas, hook `agent/pre-step` → `agent.cancel`); (2) laço de **retry-na-mesma-sessão** no host — limitado, **só** após falha de gate observada pelo host — como extensão do contrato `CoderBackend` (threading de sessão + realimentação de evidência de gate) e do `WorktreeExecutorAdapter`; (3) registrar no `backendFor` sob contrato explícito `coder_backend: "deepseek-harness"` e prever no advisory pré-execução (`declaredCoderBackendId`). Cada passo com testes focados e gates existentes.
