# SDC-02 — diagnóstico de defeito de candidato (primeiro `recover-candidate` real)

Registro append-only. Data: 2026-10-05. Branch: `dev` (`7b16e4d`). Não houve edição de código.

## Item e attempt

- Work item `7a6743b0-9dd3-4f06-a90e-e78fe46ff958` (SDC-02, referências legíveis), estado `failed`, proposta v1.
- Attempt `478b667e-9eb8-49ce-8154-bf31e21ec5e4`, backend `codex-cli:default`, evidência do host do coder: `succeeded`.
- Base `6f7577fa85706a85c0c6a5fcdce348e019b06a60`; candidato `d6d632318d795f36094b324a80747b0d4a5938ed`
  (branch `anima-work/478b667e-9eb8-49ce-8154-bf31e21ec5e4`), descendente da base, exatamente os 10 arquivos do escopo aprovado.
- Orçamento 1/1 consumido; falha `retryable=false`; prontidão de retry real: `BLOCKED` / `failure_not_retryable`.

## Falha observada

- Primeiro gate: `Testes focais de work-reference` (`npm.cmd test --workspace=apps/web -- work-reference.test.ts`), exit 1
  (evidência do host `host_observed_gate_evidence_recorded`). O gate declarado no critério é `npm test --workspace=apps/web -- work-reference.test.ts`.
- Defeito informado pelo humano como comprovado: `TS2532: Object is possibly 'undefined'` em
  `apps/web/lib/work-orchestration/work-reference.ts`; o candidato contém `return { ok: true, workItemId: candidates[0].workItemId };`
  na linha 41 (conferido na fonte do commit). `apps/web` usa `noUncheckedIndexedAccess`. O compilador não foi reexecutado neste registro.
- Não é defeito de harness, do Governor nem do ambiente: o coder terminou com sucesso e o candidato foi commitado.

## Ato

`anima work recover-candidate 7a6743b0-… --diagnosis <json>` (autorização `production_candidate_incorrect_v1`, correção `type_error`,
`additionalAttempts=1`). Primeira escrita real em `public.work_candidate_recoveries` (SDC-03 integrado em `7b16e4d`,
migration `20261004000000` aplicada no residente). O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
