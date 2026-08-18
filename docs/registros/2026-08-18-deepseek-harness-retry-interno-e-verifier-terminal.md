# 2026-08-18 — Harness no fluxo real: retry interno, Verifier terminal e prova viva

**Tipo:** desenvolvimento + prova.

**Objetivo:** corrigir a barreira do Verifier (FAIL→PASS classificado como `rejected`) e ligar o DeepSeek Harness ao **fluxo real** com **retry interno** dirigido por falha de gate observada pelo host, preservando `Supervisor → Executor → Reviewer/Verifier` e a decisão humana final. Continua [2026-08-18 tool-protocol](2026-08-18-deepseek-harness-tool-protocol.md). Ver o [design note](../arquitetura/deepseek-harness-coder-backend.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `53c7b2f`. **HEAD final:** ver `git log`. **`main`:** `99bec54` = `origin/main`, **intacta, sem push**.

## Reconciliação inicial (estado REAL confirmado)

HEAD `53c7b2f` com 12 arquivos modificados + 3 novos **não commitados** (trabalho manual anterior). `packages/core` **não** estava modificado → a correção do Verifier **não** tinha sido feita. Baseline verificado verde antes de tocar: harness/executor/evidence suites passam; as 2 falhas de suíte cheia (`WorkProposalCard`, `project-tools`) são **flakes** (passam isoladas, spawn sob carga paralela).

## Commits

- `11abb53` — Verifier classifica gates pelo estado TERMINAL (retry interno FAIL→PASS).
- `86338a8` — correção: contradição atestado×observado casa por rótulo (não label+command).
- `9fb4ee8` — retry INTERNO do executor dirigido por falha de gate observada pelo host + evidência coder multi-turn.
- `bed43a8` — Harness consome `hostValidationFeedback` + borda Node real (`node-harness-runtime`).
- `4f1b84b` — roteamento `deepseek-harness` no fluxo real com um retry interno (não default).
- (docs: este registro + design note + PRD.)

## Correção do Verifier (EVIDÊNCIA ≠ CLASSIFICAÇÃO)

Com retry interno, a evidência de gate contém, append-only, FAIL→PASS do MESMO gate lógico — correto e auditável. O bug era só na **classificação**: o Verifier percorria TODA a evidência e qualquer `failed` gerava `gate_failed` + `attested_gate_contradicts_observed`, enquanto a cobertura via o PASS posterior → FAIL→PASS legítimo ficava `rejected` para sempre. Correção: `terminalObservedGates` (helper puro em `host-observed-gate-evidence.ts`) projeta a ÚLTIMA observação por identidade `label+command`; o Verifier usa a projeção terminal em `gate_failed`, `gates_independently_observed` e `gateOutcomeSource`. A contradição `attested_gate_contradicts_observed` casa por **rótulo** (handoff e evidência podem gravar formas diferentes do mesmo comando — casar por label+command regredia o teste existente da "mentira do atestado"). **Não** cria schema V2, **não** apaga história. Semântica: FAIL→PASS ⇒ verified; PASS→FAIL ⇒ rejected; A FAIL→PASS + B FAIL ⇒ rejected por B.

## Revisão adversarial (passou)

`gateRetryLimit` default 0 (Ollama/OpenAI não retriam); `shell:true` só no gate runner pré-existente (allowlist), o spawner do Harness usa `shell:false`; sem hardcode de `G:\anima` (factory resolve por `require.resolve`); str_replace_editor segue desabilitado; retry só em `exitCode≠0 && !timedOut && !cancelled`; scope violation e backend throw fail-closed; `unlinkNodeModules` antes de reentrar no coder; nenhum commit de turno falho; checkpoint só no turno 0; Resource Governor consome gates brutos (não a projeção terminal). Verificado que a persistência agrega TODAS as observações do attempt em UMA evidência (gate e coder), fail-open.

## Prova viva do caminho REAL (scratch isolado, sem efeito externo)

Contrato real (`coder_backend: deepseek-harness`, `executor: worktree`, `model: qwen3-coder:latest`) → `createNodeDeepSeekHarnessBackend` → DSH rc.7 → Ollama local → worktree isolado de um repo alvo **descartável** (teste `npm test` falhando no seed) → coder REAL editou `src/sum.js` → gate `npm test` do host → **exitCode 0** → handoff → **Verifier = `verified`**. Reproduzido **2/2** (~46 s cada). `dsh` exit 0 NÃO tratado como sucesso — desfecho é do host. O `qwen3-coder` corrigiu em **um** turno (2/2), então o FAIL→PASS **vivo** não disparou; o retry+classificação terminal fica provado pelas regressões de integração do `worktree-executor` (worktree e gates reais) e do Verifier. Env mínimo do planejador foi suficiente (tarefa via `write`, sem `pwsh`).

## Provas / gates

- `packages/core` Jest **915** (work-verification 40 incl. 3 regressões FAIL→PASS/PASS→FAIL/dois-gates; host-observed-gate-evidence 24 incl. 4 de `terminalObservedGates`).
- `apps/web` Jest **585/585** (worktree-executor 23 incl. regressões de retry; executor-selection 12 + deepseek 2; coder-evidence; deepseek-harness-coder/runtime; node-harness-runtime 3).
- `typecheck` **5/5**. Prova viva 2/2 `verified`.

## Efeitos externos / preservação

**Nenhum** push/PR/merge/deploy/`integrated`/alteração de `origin/main`. Nenhuma credencial de nuvem. Prova viva em repo alvo descartável + `DSH_HOME` temporário (limpos). `.worktrees/` (mobile-completed-result, roadmap-003-006), `G:\anima-local-test`, `.claude/settings.local.json`, `apps/web/.env.local` preservados. O teste de prova viva (`zz-live-proof.test.ts`) foi criado, executado e **removido** (não commitado — hit em modelo real).

## Limitações (não escondidas)

- Accounting do coder multi-turn: `durationMs` = soma, `outcome` = último turn; cancelamento final pode subcontar no Resource Governor. Não afirmar accounting exato.
- Env mínimo do subprocesso: `pwsh` precisaria de `PATH`/`SystemRoot`; não exercido (tarefa via `write`).
- `child.kill()` pode não matar a árvore inteira no Windows; investigar só sob evidência de órfão.
- Retry vivo do LLM não disparado (modelo competente no fix simples); variabilidade de turno único permanece (POC `FIRST_PASS 0/5`).

## Próximo ponto exato

1. Observar um FAIL→PASS **vivo** do LLM (tarefa mais difícil, ou repetição até o turno 1 falhar) para prova ao vivo do retry — não bloqueante.
2. Avaliar merge do env do planejador com `PATH`/`SystemRoot` (sem chaves de nuvem) para habilitar `pwsh` no coder — só sob evidência de necessidade.
3. Paridade/UX e advisory pré-execução para o novo `coder_backend`; ainda **sem** ratificar Harness como default nem afrouxar gates.
