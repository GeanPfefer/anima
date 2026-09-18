# 2026-09-17 — Reconciliação final de worktrees/branches históricas

- **Tipo:** desenvolvimento + prova (arqueologia semântica, read-only + registro).
- **Objetivo:** converger para uma única linha autoritativa `dev`, classificando cada
  linha de trabalho histórica fora de `dev` como A (já substituída), B (trabalho válido
  a integrar) ou C (experimento/prova/backup a preservar ou descartar conscientemente),
  sem perder trabalho válido e sem integração cega de arquitetura antiga.
- **Branch:** `dev`. **HEAD inicial:** `f0c00f7`. **HEAD final:** ver commit deste registro.
- **origin/dev:** `f0c00f7` (pré-registro). **origin/main:** `99bec54` — **INTOCADA**.
- **Árvore inicial:** apenas `?? .worktrees/` e `?? watch4-sensors.txt` (preservados).

## Método

Comparação **semântica** (símbolos, implementações sucessoras, testes equivalentes,
docs sucedidas), não por hash/ancestralidade. Para cada linha: `git diff <ref> dev`
por arquivo + verificação de que os símbolos do commit exclusivo existem em `dev` em
forma igual ou evoluída. Zero provider, zero navegador, zero compute pago, zero escrita
em branches históricas ou em `.worktrees/`. Todas as worktrees históricas inspecionadas
estavam **limpas** (sem WIP não commitado).

## Classificação das sete linhas

| # | Linha | HEAD | Classe | Prova |
|---|---|---|---|---|
| 1 | `anima-recovery-base` (worktree Temp) | `af313c3` | **C** | Oráculo do benchmark congelado |
| 2 | `codex/compute-economics-v1` | `f54c52b` | **A** | `dev` tem superset |
| 3 | `codex/compute-economics-observations-v1` | `5103c5d` | **A** | Idêntico/superset em `dev` |
| 4 | `codex/roadmap-003-006` | `e88472b` | **C** | Numeração de planos superada |
| 5 | `fix/mobile-completed-result` | `5f5f1f3` | **A** | `dev` tem superset |
| 6 | `backup/main-pre-orchestration-sync` | `42aeba3` | **C** | Backup histórico |
| 7 | `backup/orchestration-pre-rebase` | `e71a0a5` | **C** | Backup histórico |

### 1 — `anima-recovery-base` `af313c3` → **C (oráculo de benchmark; NÃO integrar)**

Três commits (`ccb7dcc`→`0bea4c8`→`af313c3`), base antiga `b14a32c`. O *seam* de custo
real OpenAI (`calculateApiAttemptCost`, `ProviderPricingV1` em
`packages/core/src/compute-economics.ts`; `providerUsage`/`providerCallCount` em
`apps/web/lib/work-orchestration/coder-evidence.ts`; `settlePaidComputeBudgetReservation`
em `paid-compute-authorization-store.ts`) **já está em `dev`**. O único conteúdo ausente é
a **fiação viva** do settlement (`openai-actual-cost-settlement.ts` + binding em
`post-turn-observation.ts`/`autonomous-backlog-deps.ts`) — exatamente o commit `0bea4c8`,
que é o **oráculo do benchmark self-dev congelado B1/B2/B3** (item successor `d054b90f`,
reserva paga **`11031d53` US$1,50 ABERTA**). Integrar destruiria o benchmark. **Preservar.**

### 2 — `codex/compute-economics-v1` `f54c52b` → **A**

`packages/core/src/compute-economics.ts` está em `dev` como evolução estrita (+`placement`,
+`configVersion`, `durationMs: number | null`, `sameCohort`/`invalidObservation` ajustados).
Nada perdido.

### 3 — `codex/compute-economics-observations-v1` `5103c5d` → **A**

`economic-observations.ts` e `.test.ts` **byte-idênticos** em `dev`; `compute-economics.ts`
idêntico; `index.ts` e `anima-prd.md` são supersets em `dev`. Registro
`2026-09-04-compute-economics-observations-v1.md` presente. Nada perdido.

### 4 — `codex/roadmap-003-006` `e88472b` → **C (numeração superada; direção de produto)**

Base antiga `29d771c` (536 commits atrás). Propunha 003 Experiência Operacional / 004 Nós
Locais e Portabilidade / 005 Anima Conversacional e Semântico / 006 Consolidação
Multiplataforma. `dev` **reusou os números 003–006 para trabalho realizado diferente**
(003 ergonomia-âncora-edição-r2, 004 execution-placement-v0, 005 provisionamento-on-demand-v1,
006 project-intake-v0, 007 replanejamento). Integrar colidiria. Os temas direcionais
(portabilidade de nós, evolução conversacional/semântica, consolidação multiplataforma) são
**decisão de produto do Gean** — se devem ser re-expressos na numeração atual. Preservar; não
integrar; não descartar sem decisão consciente.

### 5 — `fix/mobile-completed-result` `5f5f1f3` → **A**

`dev` tem `presentMobileWorkResult`/`describeMissingCompletedResult`/`completionMessage`
(exibição do resultado aceito quando `state==='completed'`) **e mais**
(`presentMobileWorkProgress`, `presentMobileWorkVerification`, `presentMobileWorkResourceCost`,
`handoff`). Superset. Nada perdido.

### 6 e 7 — `backup/main-pre-orchestration-sync` `42aeba3`, `backup/orchestration-pre-rebase` `e71a0a5` → **C (backup histórico)**

Pontos de recuperação de um rebase/sync já superado (661 commits atrás). Todo o conteúdo
fundacional (`anima-manifesto.md`, `anima-prd.md`, `docs/marcos/001`/`002`/README,
`docs/arquitetura/orquestracao-de-trabalho.md`, `docs/planos/001`, `AGENTS.md`, `CLAUDE.md`)
está em `dev` — `docs/marcos/001` **byte-idêntico**; manifesto +12/-1 (evoluído). Conteúdo
comprovadamente redundante; valor residual = seguro/ponto de recuperação. Preservar.

## Decisões

- **Nenhum item Classe B.** Nada a integrar; nenhum commit de código; `dev` de código
  permanece em `f0c00f7`. A hipótese de "trabalho funcional relevante ainda não integrado"
  nas três primeiras linhas foi **refutada por evidência**: A/A e oráculo congelado (C).
- **Nada removido.** As worktrees das linhas A vivem em `G:\anima\.worktrees\` (preservação
  integral obrigatória); a linha 1 é oráculo com reserva paga aberta; 4/6/7 são
  direção/backup. Remoção de qualquer uma é decisão irreversível cujo valor não é
  tecnicamente inferível ⇒ fica para decisão consciente do Gean.

## Efeitos externos

- **Não** tocou `origin/main` (`99bec54`). **Não** usou provider pago, Pod ou navegador.
- **Não** aplicou `reset --hard`/`stash`/`clean`/`db reset`/`worktree prune`.
- **Não** apagou nenhuma branch, worktree ou arquivo histórico.
- Único efeito: este registro (docs-only) commitado em `dev`; push para `origin/dev` após gates.

## Gates

Sem mudança de código ⇒ nenhum gate de código exigido (registro docs-only). `dev` de código
intacto em `f0c00f7` (typecheck global verde registrado em
[`2026-09-16-evolution-ux-v1.md`](2026-09-16-evolution-ux-v1.md)).

## Candidatos futuros a limpeza (decisão consciente do Gean — NÃO executados)

- **A-substituídas** (`codex/compute-economics-v1`, `codex/compute-economics-observations-v1`,
  `fix/mobile-completed-result`): conteúdo provado redundante; removíveis quando o Gean
  quiser recuperar espaço das worktrees em `.worktrees/` (que hoje têm preservação integral).
- **`anima-recovery-base`/`0bea4c8`:** manter até o benchmark self-dev B1/B2/B3 ser concluído
  ou aposentado (reserva `11031d53` aberta).
- **`codex/roadmap-003-006`:** manter até decidir se os temas direcionais entram na numeração
  atual de planos.
- **Backups `42aeba3`/`e71a0a5`:** só remover se o Gean dispensar o ponto de recuperação.

## Fronteiras humanas restantes

- **Produto:** re-expressar (ou não) os temas do roadmap 003–006 na numeração atual.
- **Benchmark:** conclusão/aposentadoria do self-dev settlement B1/B2/B3 e destino da reserva
  `11031d53`.
- **Descarte** de qualquer branch/worktree/backup histórico.

## Próximo ponto de retomada

`dev` é a linha autoritativa única de código. As sete linhas estão classificadas e a
arqueologia é recuperável por este registro — nenhum agente futuro precisa reabri-la.
Ver contexto em `anima-prd.md`, `docs/planos/` e nos registros de 2026-09-14/15/16.
