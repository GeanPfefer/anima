# SDC-14 — diagnóstico de defeito de candidato (candidate recovery)

Registro append-only. Data: 2026-10-05. Branch: `dev` (`a173f40`). Não houve edição do candidate nem de código do ANIMA.

## Item e attempt

- Correction `5d300ae3-c02e-4a77-8649-7e81e30e3644` (SDC-14, First-Class Investigation Preparation V0 — Corrected Scope), estado `failed`;
  predecessor `27621bc5-c7ab-4bf6-82db-02c1019037b8` em `changes_requested`.
- Attempt `2bfb32c2-3ea2-46e8-beeb-d0ac904998c7`, backend `codex-cli:default`, evidência do host do coder: `succeeded` (~219 s).
- Base `a173f40e2d0fce78d674e89103f2854c84d3ac9f`; checkpoint herdado `732ff60b3371b8e94b76202397a840b57d91ee59`;
  candidato `96606b4517dd922c5b783035e674743404a80f92` (branch `anima-work/2bfb32c2-3ea2-46e8-beeb-d0ac904998c7`), filho direto do checkpoint,
  3 arquivos alterados (`apps/web/cli/anima.ts`, `apps/web/cli/app.test.ts`, `apps/web/lib/work-orchestration/work-reference.test.ts`);
  os 9 arquivos preservados ficaram byte-idênticos ao checkpoint.
- Orçamento 1/1 consumido; falha `retryable=false` (`[gate_failed]`).

## Falha observada

- Gate que parou a attempt: `Testes focais da CLI (args, app, dispatch real e regressão de render)`
  (`npm test --workspace=apps/web -- cli/`), exit 1; typechecks e os demais gates focais passaram.
- Reprodução independente (worktree descartável sem `.env.local`, fora do repositório): 6 suítes, 131 de 132 testes PASS; a única falha é
  `entrypoint nativo da CLI › o comando real do npm script e a execução direta chegam a main e dispatch help`, em
  `apps/web/cli/app.test.ts:550`: `expect(child.stderr).toBe('')` recebe `.env.local not found. Continuing without it.`
- Causa: o script `anima` usa `--env-file-if-exists=.env.local`; com o arquivo ausente (worktree de attempt, gitignored), o Node 24 escreve esse
  aviso em stderr. O comportamento funcional (exit code e help pelo entrypoint real) está correto; o defeito é a expectativa do teste.
- Rollout do Codex da attempt: o Codex não executou testes (gates são do host); nenhuma falha foi observada por ele.

## Ato

`anima work recover-candidate 5d300ae3-… --diagnosis <json>` (autorização `production_candidate_incorrect_v1`, correção `test_failure`,
`additionalAttempts=1`). O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
