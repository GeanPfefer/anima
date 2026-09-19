# Enforcement Readiness V0 em shadow mode

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova automatizada.
- **Objetivo:** avaliar, ainda SOMENTE em shadow mode, se a evidência disponível
  seria candidata a uma futura decisão operacional autônoma, sem conectar à state
  machine nem executar enforcement.
- **Branch:** `dev`.
- **HEAD inicial:** `68558b9f2b3cd7e4f51d99dbe349fa60f58577fb`.
- **HEAD final:** commit que contém este registro (ver histórico de `dev`).

## Três fronteiras e dois escopos

- `Evidence != Policy`; `Policy Decision != Enforcement Readiness`;
  `Enforcement Readiness != Enforcement`.
- **Gate Evidence Scope** (`targetPaths`) = superfície de PROVA. Alterar o próprio
  target contamina (`confounded`); alterar arquivos FORA do gate target é NEUTRO.
- **Change Authorization Scope** (`includedScope` do Work Item, resolvido em
  `WorkspaceAccessPolicyV1.writeScope`) = superfície AUTORIZADA de edição. Só mudança
  fora dela é candidata a violação. `changedFilesOutsideTargetScope` ≠ mudança não
  autorizada.

## Resultado

- `evaluateEnforcementReadiness` (`enforcement-readiness-v0`, core puro/determinístico/
  versionado) reutiliza `classifyDifferentialGate` e a decisão da Policy V0, e produz
  `eligible | requires_review | blocked | insufficient_evidence` com reason code
  estável, força da evidência (differentialStatus, policyDecision, quadrante,
  finalOutcome, changeAuthorization) e referência à Policy V0.
- Calibração: FAIL→PASS verificado + target intacto ⇒ discriminating; candidato
  (`eligible`) só para `gate_assertion`; `substantive` ⇒ revisão. PASS→PASS ⇒
  non_discriminating ⇒ revisão (não elegível; DIVERGE do `allow` da Policy V0).
  PASS→FAIL ⇒ regressão/blocked; FAIL→FAIL ⇒ critério não satisfeito/blocked.
  Target novo/alterado ⇒ revisão. Unverified/mismatch/sem baseline ⇒ inconclusivo.
  Claim desconhecido ⇒ insuficiente.
- O host anexa `shadowReadinessDecisions` a `HostObservedGateEvidenceV1`; o parser as
  RECOMPUTA dos fatos (fronteira de confiança). Change scope = `unavailable` nesse
  ponto (a evidência de gate não carrega o `includedScope`).

## Contratos de Change Authorization Scope encontrados (reconciliação)

- Canônico: `WorkProposal.data.includedScope`/`excludedScope` (declarado) →
  `WorkExecutorRequest.includedScope` → `WorkspaceAccessPolicyV1.writeScope`
  (`resolveWorkspaceAccessPolicy`/`supervisedWorkspaceAccessPolicy`,
  `isPathWritable`). NÃO foi criado contrato paralelo.
- Já é enforced HARD pelo executor: `worktree-executor.ts` compara
  `changedByAttempt` contra `includedScope` e emite `contract_violation` terminal
  ANTES dos gates. Logo, evidência de gate produzida pelo executor atual já implica
  mudança autorizada — mas a evidência NÃO carrega o escopo autorizado, então a
  readiness não pode verificá-lo independentemente daí.
- `includedScope` pode conter prosa (não só caminhos) em alguns work items; a
  verificação host-observada por caminho exato é, por isso, a próxima fatia.

## Segurança e ausência de enforcement (shadow-only absoluto)

- Função pura: sem I/O, LLM, relógio, rede ou estado global; não muta o input.
- Executor, attempt state machine, retry, Verifier, review, promoção, integração,
  merge, recovery e state machine NÃO consomem a readiness. `eligible` não promove,
  `blocked` não bloqueia — só telemetria.
- Nenhum browser, Work, Codex, compute pago, provider, banco, push, merge, deploy
  ou alteração de `origin/main` foi realizado.
- WIP não relacionado preservado: `.claude/settings.local.json`, `.worktrees/`,
  `apps/web/.env.local`, `watch4-sensors.txt`.

## Provas (executadas nesta sessão)

- Core focal (readiness + policy + gate evidence + capability-proof + verifier-opinion
  + self-deficiency + canonical-resident-contract + work-verification): 226 PASS.
- Suíte completa `packages/core`: 95 suites / 1949 PASS.
- Web focal: gate-evidence, worktree-executor, decomposition-orchestration PASS.
- Typecheck `packages/core` e `apps/web`: PASS. `git diff --check`: limpo.

## Barreira exata restante antes de Enforcement V1

**Change Authorization Verification host-observada.** Threar o `includedScope`
(escopo autorizado) e os arquivos alterados observados para dentro da superfície de
evidência que a readiness lê, para que `change_scope_verification` deixe de ser
`unavailable`. Só então uma decisão de enforcement poderia afirmar honestamente que a
mudança foi autorizada. Depois disso: fatia de Enforcement V1 com rollout, rollback e
gates humanos próprios. Nenhuma decisão da Readiness V0 possui autoridade operacional.
