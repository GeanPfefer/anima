# SDC-16 correction — diagnóstico de defeito de candidato (candidate recovery)

Registro append-only. Data: 2026-10-06. Branch: `dev` (`3f576b1`). Não houve edição do candidate nem de código do ANIMA.

## Item e attempt

- Correction `5a0348a0-5a0a-490e-a688-356f7d99106d` (SDC-16, Investigation Failure Diagnostics V0), estado `failed`; original `8ec1bfa9-110d-4eb5-aef4-158873a737d0` em `changes_requested`.
- Attempt `2b6ca7b9-c17b-4f16-8815-6c2419dd9550`, backend `codex-cli:default`, evidência do host do coder: `succeeded`.
- Checkpoint (resume) `74f3c5c3411e7a82c609d99bf02109fb28387769`; candidato `708b0f18e757f6345896890a0d18a41fba72e4de` (branch
  `anima-work/2b6ca7b9-c17b-4f16-8815-6c2419dd9550`), filho direto do checkpoint, 5 arquivos do escopo da correction.
- Orçamento 1/1 consumido; falha `retryable=false` (`[gate_failed]`).

## Falha observada

- Gate que parou a attempt: `Typecheck do apps/web` (`npm run typecheck --workspace=apps/web`), exit 2; typecheck do core passou.
- Reprodução independente (worktree descartável fora do repositório): dois erros TS2345 apenas em testes:
  `investigation-executor.test.ts(83,58)` e `investigation-executor.worktree.test.ts(168,71)`: os fakes de runner devolvem `exitCode: null`,
  incompatível com `CommandResult.exitCode: number`.
- Causa de fundo: os testes modelam um estado que o runner real não produz e mascaram uma condição morta de produção,
  `r.exitCode === null` em `inspectInvestigationEvidence`, que nunca ocorre com o `runProcess` real (cancelled, timedOut e exit code não-zero são os sinais reais).

## Ato

`anima work recover-candidate 5a0348a0-… --diagnosis <json>` (autorização `production_candidate_incorrect_v1`, correção `type_error`, `additionalAttempts=1`).
O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
