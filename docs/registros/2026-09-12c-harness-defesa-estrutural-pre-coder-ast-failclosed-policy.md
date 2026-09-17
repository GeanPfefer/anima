# 2026-09-12c — Harness do coder: defesa estrutural (pré-coder + AST + read fail-closed + policy não enfraquecível)

## Objetivo e mandato

A auditoria independente do Codex REJEITOU (`C) REJECTED`) o endurecimento anterior (containment
pós-coder por regex). Decisão humana: aceitar os findings como requisitos e transformar o patch em
defesa estrutural adequada ANTES de permitir outro self-dev pago. Restrições reafirmadas: NÃO
executar `fe99e446`; NÃO criar successor/attempt/recovery; NÃO conceder/consumir paid authority;
NÃO chamar OpenAI/RunPod/qualquer provider; NÃO liquidar as 3 reservas abertas; NÃO push; NÃO tocar
`origin/main`; preservar todo o WIP. Tudo local e sem custo. Parar depois para UMA reauditoria
read-only curta.

## Estado inicial e final

- Branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (sem commit).
- `origin/main` inicial/final `99bec54e3ab42bfe882a8686cd1385d8058b916e` — INTACTA. Sem push.
- WIP preservado. `fe99e446` intacto (não lido para execução, não aprovado, sem attempt).
- Zero provider, zero gasto, zero write no ledger/RPC, nenhum Pod, sem `service_role`.

## Os 5 requisitos e como foram atendidos

1. **Prevenção PRÉ-CODER (política no contrato compartilhado).** `CoderEditRequest.harnessPolicy`
   (tipo `CoderHarnessPolicyV1` do core) transporta a política. Renderer ÚNICO
   `renderCoderHarnessPolicyInstructions` (core) produz o texto canônico (runner Jest; vitest
   proibido; autoridade do backend = intent; fontes válidas `contract.coderBackend`/
   `computeDecision.selectedProvider`; `entry.coderBackend` proibido). O executor injeta a política
   no `backend.edit(...)` ANTES da inferência. Chega aos 3 caminhos: Ollama monta no header;
   **OpenAI delega ao Ollama** (mesmo header); DeepSeek Harness recebe `harnessPolicyInstructions`
   no `HarnessRunTurnInput` e o `composeHarnessTask` o prepende. O validador pós-output permanece
   como 2ª linha.
2. **Análise ESTRUTURAL (AST) no lugar de regex.** Novo `apps/web/.../coder-output-analysis.ts` usa
   o `typescript` do workspace. RUNNER: `ImportDeclaration`, re-export, `import(...)`, `require(...)`,
   `import x = require(...)`, subpaths e formas multilinha — em QUALQUER script produzido (não só
   `*.test.*`). BACKEND: `entry.coderBackend`, `entry?.coderBackend`, `entry!.coderBackend`,
   `entry["coderBackend"]`/`['coderBackend']`, destructuring com origem `entry`, multiline, e ALIAS
   LOCAL SIMPLES (`const x = entry;`, inclusive alias de alias). Fronteira conservadora documentada:
   sem resolução de tipos/símbolos; não segue cadeias profundas (`obj.entry.coderBackend`),
   reatribuições nem parâmetros. Comentários/strings/templates não são nós de import/acesso ⇒ sem
   falso positivo por construção.
3. **Read failure fail-closed.** Novo `GitWorktree.changedEntriesSinceStart` (status `--name-status
   -M`). `collectCoderOutputForHarness` pula deleção (D) mas exige leitura de A/M/R/C/T; se
   `readWorkspaceFile` devolver null ⇒ `execution_failed` terminal ANTES de checkpoint/gates/result.
   Rename (R) inspeciona o DESTINO. Nada de passagem silenciosa de arquivo não inspecionado.
4. **Policy canônica não enfraquecível.** `CANONICAL_CODER_HARNESS_POLICY_V1` +
   `resolveEffectiveCoderHarnessPolicy(override)`: o efetivo é sempre SUPERSET do canônico (união de
   runners/fontes; runner canônico fixo em jest). O executor SEMPRE resolve o efetivo — um
   `harnessPolicy` de caller com listas vazias NÃO desliga o gate (vitest/`entry.coderBackend`
   permanecem).
5. **Regressões adversariais + lifecycle.** Cobertas (ver abaixo). Violação ⇒ `contract_violation`
   terminal, sem result/checkpoint. Semântica de retry inalterada: `contract_violation` NÃO virou
   retryable; nenhuma nova attempt paga é aberta automaticamente. As reservas abertas seguem como
   estavam (o harness rejeita SEM alterar ledger).

## Diff / arquivos / símbolos

- Core `coder-output-harness.ts` (reescrito): `CoderHarnessPolicyV1`, `CANONICAL_/DEFAULT_`,
  `resolveEffectiveCoderHarnessPolicy`, `matchIncompatibleRunner`, `parseForbiddenBackendSource`,
  `combineCoderHarnessViolations`, `describeCoderHarnessViolations`, `renderCoderHarnessPolicyInstructions`.
- apps/web `coder-output-analysis.ts` (novo): `analyzeCoderOutputFiles`, `collectCoderOutputForHarness`,
  `isAnalyzableSourcePath`, tipos `CoderOutputFile`/`CoderOutputSource`.
- apps/web `worktree.ts`: `changedEntriesSinceStart`.
- apps/web `worktree-executor.ts`: resolve efetivo; injeta `harnessPolicy` pré-coder; coleta
  fail-closed + análise AST (substitui o containment regex).
- apps/web `coder-backend.ts`: campo `harnessPolicy` no `CoderEditRequest`.
- apps/web `ollama-coder.ts`: renderiza a política no header (cobre OpenAI por delegação).
- apps/web `deepseek-harness-coder.ts` + `harness/deepseek-harness-runtime.ts`: campo
  `harnessPolicyInstructions` no turno + `composeHarnessTask` o inclui.
- Testes: core `coder-output-harness.test.ts` (reescrito); apps/web `coder-output-analysis.test.ts`
  (novo); adições em `worktree.test.ts`, `worktree-executor.test.ts`, `ollama-coder.test.ts`,
  `deepseek-harness-coder.test.ts`, `harness/deepseek-harness-runtime.test.ts`.

## Testes e resultados (local, sem provider)

- Core `coder-output-harness`: 12/12. Core typecheck: PASS. Core sweep: **80 suites / 1660 testes**.
- apps/web `coder-output-analysis`: 30 (AST adversarial) + 4 (collector fail-closed) = 34.
- apps/web afetados (analysis, worktree, worktree-executor, ollama-coder, deepseek-coder,
  deepseek-runtime): **6 suites / 188 testes**.
- apps/web sweep `work-orchestration/`: **91 suites / 1137 testes**. apps/web typecheck: **exit 0**.

## Evidência focal por finding do Codex

- Regex→AST: `coder-output-analysis.test.ts` prova optional chaining, bracket, non-null,
  destructuring (+rename), multiline, alias/alias-de-alias, todas as formas de import (incl. subpath,
  require, import-equals, re-export) e que string/template/comentário/mensagem/cadeia-profunda NÃO
  disparam.
- Pré-coder: executor injeta `harnessPolicy` (spy backend); Ollama coloca no prompt (cobre OpenAI);
  DeepSeek recebe `harnessPolicyInstructions` e `composeHarnessTask` o inclui.
- Read fail-closed: `collectCoderOutputForHarness` — D pulado, A/M/R lidos, A/M/R ilegível ⇒
  ok:false; `changedEntriesSinceStart` classifica A/M/D/R em git real.
- Policy não enfraquecível: `resolveEffectiveCoderHarnessPolicy` (listas vazias mantêm canônicas) +
  teste no executor com override vazio ainda bloqueia vitest.

## Estado Git/orchestration final e fronteira

12 arquivos tracked (+280/-3) + 4 novos. HEAD/origin-main/WIP intactos; nenhuma reserva tocada;
autoridade RunPod `3b87224f` intocada. **PRÓXIMO:** UMA reauditoria read-only curta antes de
autorizar o próximo self-dev PAGO. Refs: `2026-09-12b-...`, `2026-09-11c-...`.
