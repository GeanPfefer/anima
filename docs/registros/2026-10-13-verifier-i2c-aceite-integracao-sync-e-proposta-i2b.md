# Verifier v4/I2c — aceite, integração governada, sync local e proposta I2b (2026-10-13)

Append-only. Base: `dev`=`828f2d18`; HEAD final: `51a79198d6568f46d7013db68c2a57cb53b362e7`.

## Preflight
10 arquivos Core = escopo aprovado; 1 commit sobre a base, 0 merges; md5 do parecer 86499 = `2aaa288c429982979807eb04635097e0` (igual à evidência original); índice vazio; 0 claims/leases; 0 integrações do item; REVIEW v1. Status Git 227 linhas (handoff: 226): a diferença é apenas untracked em `docs/registros/` (o próprio handoff, escrito depois da contagem); nenhum arquivo rastreado ou de `packages/` envolvido.

## Eventos
- 86501 `result_accepted` (I2c `b972846e`, resultado `c89d419f`); parecer 86499 inalterado.
- 86502 `integration_effect_authorized` (auth `b972846e-c0de-4e00-8f21-b972c0ffee01`), 86503 `integration_completed`.
- Recibo: `ff_only`, `effected`, `previousTargetSha` `828f2d18`, `resultingTargetSha` `51a79198`, `mergeCommitSha null`. Clone dedicado `anima-recovery/anima-integration-b972846e` (push desabilitado, HEAD destacado), 22/22 guards.
- Sync local: `refs/anima/integrated/b972846e`, `git merge --ff-only`; HEAD=`51a79198`, índice vazio, status idêntico ao de referência (`anima-recovery/status-ref-i2c.txt`).

## Verificação
`VERIFIER_VERSION=work-verifier-v5`; core typecheck limpo; core 120 suítes / 2823 testes PASS; web `tsc` 0 erros fora de `scripts/_session`; replay 158 itens (base `828f2d18` × novo): 0 deriva de veredito/resumo/achados/humanReview, 0 erros (51 pareceres agora v5); sem `testReport` real, `test_binding` falha fechado (`test_report_missing`, testes unitários).

## Proposta I2b (somente PROPOSED)
Item `e5d8730a-f64d-4135-a777-4ce29de3be66` v1, eventos 86504 `work_proposed` / 86505 `context_attached`. Base `51a79198`; `acceptance_contract:2`; 1 tentativa, 35 min; escopo (4 arquivos, apps/web/lib/work-orchestration): `worktree.ts`, `worktree.test.ts`, `worktree-executor.ts`, `worktree-executor.test.ts`. Gates: web focado (`worktree.test`, `worktree-executor.test`), typecheck web, escopo. Captura Jest JSON só para `claim_kind:test_binding` (gate e baseline), via `deriveGateTestReport`; fail-closed (relatório ausente/inválido ⇒ omitido). Lint de contrato `[]`; elegibilidade sem lacunas. NÃO classificado, aprovado ou executado.
Fora do I2b (itens posteriores, exigem Core): `outputTail`, digest de diff, ordinal de nomes duplicados. Base é o `dev` LOCAL (I2c não publicado em origin/dev).
Orçamento: a 7ª attempt só libera após 2026-10-14T03:28:50Z (ou lease E0 com novo mandato).

## Não realizado
push, migrations, leases, attempts, recovery, limpeza de worktrees/branches/WIPs, API paga.
Scripts: `handoff-20261013/gov/{build_i2b.mjs,command_i2b.json}`, `handoff-20261013/integ/integrate-b972846e.mjs`; evidências `integ-b972846e-*.json`, `replay-*-b972*.json`, `create-i2b-result.json`.
