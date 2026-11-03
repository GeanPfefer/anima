# SDC-15 — diagnóstico de defeito de candidato (candidate recovery)

Registro append-only. Data: 2026-10-05. Branch: `dev` (`a173f40`). Não houve edição do candidate nem de código do ANIMA.

## Item e attempt

- Work item `25d7d154-2706-45cb-820b-d9e6e0b8e0fd` (SDC-15, Checkpoint-Relative Candidate Recovery Evidence V0), estado `failed`, proposta v2.
- Attempt `dea8f8eb-7dd4-490e-be48-0b0c4eca4d72`, backend `codex-cli:default`, evidência do host do coder: `succeeded` (~252 s).
- Base `a173f40e2d0fce78d674e89103f2854c84d3ac9f`; candidato `f46e124528ebe74f5f91612ed9ecd60399172607`
  (branch `anima-work/dea8f8eb-7dd4-490e-be48-0b0c4eca4d72`), filho direto da base, exatamente os 4 arquivos do escopo aprovado
  (migration nova, pgTAP, `candidate-recovery.ts` e `candidate-recovery.test.ts`).
- Orçamento 1/1 consumido; falha `retryable=false` (`[gate_failed]`).

## Falha observada

- Gate que parou a attempt: `Typecheck do apps/web` (`npm run typecheck --workspace=apps/web`), exit 2 (gate 2 de 8); o typecheck do core passou.
- Reprodução independente (worktree descartável fora do repositório): um único erro,
  `lib/work-orchestration/candidate-recovery.test.ts(39,69): error TS2739` — o objeto parcial de `rows.push({ payload: { data: { evidence: { attemptId, baseSha,
  observedChangedFilesSinceStart } } } })` (fixture `olderDelta`) não satisfaz o tipo inferido pelo primeiro elemento de `rows` (evidência completa).
- Código de produção (`candidate-recovery.ts`) e SQL (migration/pgTAP) não apresentam erro de tipo. Defeito de tipagem do fixture de teste.

## Ato

`anima work recover-candidate 25d7d154-… --diagnosis <json>` (autorização `production_candidate_incorrect_v1`, correção `type_error`,
`additionalAttempts=1`). O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
