# Change Authorization Evidence V0 — host-observed, shadow

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova automatizada.
- **Objetivo:** tornar o Change Authorization Scope uma evidência host-observada,
  estruturada, persistida e revalidável pela Enforcement Readiness — sem alterar a
  autoridade operacional atual (fecha a barreira da Readiness V0).
- **Branch:** `dev`.
- **HEAD inicial:** `eb6449a8b3b43f8800f4203d27deef63ab5865f0`.
- **HEAD final:** commit que contém este registro (ver histórico de `dev`).
- **NÃO fez:** Enforcement V1, push, merge, provider, compute pago, banco, browser,
  Codex, Work. `origin/main` intacta.

## Fronteiras (jamais colapsadas)

`Declared Scope != Resolved Authorization Scope` · `Gate Evidence Scope != Change
Authorization Scope` · `Observed Authorized Change != Planner Assertion` ·
`Evidence != Policy` · `Policy != Readiness` · `Readiness != Enforcement`.

## Fonte autoritativa real do Change Authorization Scope (reconciliação)

- `WorkProposal.data.includedScope`/`excludedScope` (proposal versionado) →
  `execution.ts` monta `WorkExecutorRequest.includedScope` → executor.
- Reforço HARD: `worktree-executor.ts` compara `changedByAttempt`
  (`changedFilesSinceStart`, git host-observado) com `includedScope` (membership sob
  `norm`) e emite `contract_violation` terminal ANTES dos gates.
- A evidência REUTILIZA a política canônica (`supervisedWorkspaceAccessPolicy` +
  `isPathWritable`), NÃO uma segunda semântica. `isSafeRelativePath` (exportado de
  `eligibility.ts`) separa caminho verificável de prosa; sem LLM.

## Divergência arquitetural descoberta (resolvida, não-bloqueante)

O `contract_violation` (verdicto pós-hoc do host) usa membership CRU de `includedScope`
sob `norm` (só `\`→`/`); `isPathWritable`/`WorkspaceAccessPolicy` adiciona `excluded`
e checagem lexical + `normalizeScopePath`. São formalmente diferentes, mas concordam
nos arquivos REALMENTE alterados: a autoridade per-edit (o coder só escreve writable)
impede escrita fora/excluída ANTES do verdicto pós-hoc. A evidência usa a semântica
canônica (`isPathWritable`) e documenta a divergência; NÃO exigiu decisão humana.

## Representação persistida

`ChangeAuthorizationEvidenceV1`: `source`, `status` (`verified | partially_verifiable
| unavailable`, DERIVADO), `declaredScope`, `verifiableAuthorizedPaths`,
`unverifiableScopeEntries`, `excludedScope`, `changedFiles`, `authorizedChangedFiles`,
`unauthorizedChangedFiles`. Anexada como `HostObservedGateEvidenceV1.changeAuthorization`
(OPCIONAL/aditivo). O parser RECOMPUTA dos fatos brutos (declaredScope/excludedScope/
changedFiles) — trust boundary; evidência antiga sem o campo continua parseável.

## Binding host-observed (TOCTOU-safe, padrão observer)

`onChangeAuthorizationObserved` no executor (padrão de `onGateObserved`/
`onCoderObserved`) dispara no ponto de reforço com `{ declaredScope: includedScope,
excludedScope, changedFiles: changedByAttempt }` — capturado NAQUELA execução, sem
re-ler Work Item mutável. Threado: `executor-selection` (`changeAuthorizationObserver`
→ `onChangeAuthorizationObserved`) → call sites (`supervisor-turn/route`,
`autonomous-backlog-deps`) → `PostTurnObservationInput.changeAuthorization` →
`persistHostObservedGateEvidence` → build. Aditivo/fail-open; não altera controle de
fluxo nem o `contract_violation`.

## Readiness integrada

`evaluateEnforcementReadiness` consome a evidência: `eligible` exige `status = verified`
SEM mudança não autorizada; mudança não autorizada ⇒ `unauthorized_change_detected`;
ausente/parcial ⇒ `change_scope_unverified` (degrada). Casos que agora chegam a
`eligible`: gate `FAIL→PASS` discriminating (scope verified, target intacto) para
`gate_assertion` COM autorização verificada e limpa — inclusive quando a mudança está
fora do GATE target mas DENTRO do Change Authorization Scope. `substantive` nunca é
elegível só por gate verde.

## Prova de shadow-only

`shadowReadinessDecisions`/`changeAuthorization` só são calculados, persistidos e
exibidos. `contract_violation` (executor) permanece a única autoridade operacional.
Nenhum consumidor de execução/attempt/retry/Verifier/review/promoção/integração/merge/
recovery/state machine lê a readiness/evidência para mudar comportamento.

## Provas (nesta sessão)

- Core focal 227 (change-authorization-evidence + enforcement-readiness + host-observed
  gate evidence + differential policy + canonical-resident-contract + capability-proof +
  eligibility + workspace-access-policy). Suíte completa core 96 suites / 1965 PASS.
- Web focal: gate-evidence + worktree-executor + decomposition-orchestration.
- Typecheck `packages/core` e `apps/web`: PASS. `git diff --check`: limpo.

## Barreira restante antes de Enforcement V1

Nenhuma dependência de dados nova: a Change Authorization Evidence host-observada está
disponível e revalidável. A próxima fatia (Enforcement V1) conecta a decisão a
comportamento, com rollout, rollback e gates humanos próprios. Nada nesta fatia possui
autoridade operacional.

## Nota operacional (footgun)

`host-observed-gate-evidence.ts` e `worktree-executor.ts` e `supervisor-turn/route.ts`
têm finais de linha MISTOS em HEAD; o Edit tool os reescreve para all-CRLF e o
`git diff --check` acusa CR em linhas adicionadas. Edições nesses arquivos foram feitas
por inserção byte-level LF-only (preservando as demais linhas), mantendo o diff mínimo.
