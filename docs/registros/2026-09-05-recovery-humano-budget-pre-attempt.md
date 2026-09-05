# Recovery humano de budget pré-attempt — implementação e prova viva

- **Data/tipo:** 2026-09-05 — desenvolvimento + prova.
- **Objetivo:** admitir exatamente +1 attempt humano no mesmo item bloqueado por
  `item_attempt_budget_exhausted` ou `user_attempt_budget_exhausted`, sem resetar
  INTEL-04, e retomar `ce90eb14-810d-4125-833c-4c7b35666855`.
- **Branch/HEAD:** `dev`; inicial `b78e44b`; checkpoint da capability `168c5c9`;
  endurecimento `802e616`; HEAD final registrado no commit deste documento.

## Implementação e decisões

- `HumanBudgetBlockedResumeAuthorization` é um codec fechado: item específico,
  request UUID, razão esperada allowlisted e `additionalAttempts=1`.
- O overload `authorize_work_resume(uuid,integer,jsonb)` valida owner, estado
  `blocked`, versão, último `work_blocked` pré-attempt com
  `resolution=awaits_budget_window`, aprovação/classificação vigentes e ausência de
  claim/attempt ativo. Readmite o **mesmo** item; não cria lineage/successor.
- `work_budget_resume_authorizations` preserva grant/consumo append-only. A decisão
  de budget mantém os números globais intactos e projeta apenas o token ainda não
  consumido. O trigger de `execution_started` o consome atomicamente; a próxima
  partida volta à política normal.
- Recovery antigo de `failed` continua no overload anterior, sem mudança semântica.
- Endurecimento posterior impede conceder token latente se a janela já recuperou.

## Gates

- pgTAP: `budget_blocked_human_resume` + `human_recovery_authority` + `work_budget`:
  **63/63 PASS**. O primeiro run encontrou ambiguidade `request_id`; migrations
  corretivas append-only `20260905000001/2` foram aplicadas e a repetição passou.
- Core Jest `human-resume.test.ts`: **50/50 PASS**.
- Web Jest `authorize-resume.test.ts` + `cli/app.test.ts`: **37/37 PASS**.
- `npm run typecheck`: cinco workspaces **PASS**.
- `git diff --check`: **PASS**.

## Prova viva e nova barreira

- Grant de recovery: `3e3ba0ba-b9e2-490f-bd98-13cb7e67aebd`, request
  `5d901e4a-c4e3-4a5d-93e9-6c7d846df8bb`, item `ce90eb14`, v2,
  `user_attempt_budget_exhausted`, +1, replay confirmado e `consumed=true`.
- Attempt real: `a719efd0-317d-44e6-9dac-47a23cca398e`; claim `2effa76b`;
  `execution_started` seq 51161 consumiu o token.
- Desfecho: `execution_failed/retryable:true` seq 51162 antes do provider, ao criar
  a worktree/branch `anima-work/a719efd0-317d-44e6-9dac-47a23cca398e` (`fatal:
  cannot…`, detalhe persistido redigido). A branch/worktree não existe.
- Coder não produziu diff; gate não rodou; Verifier live/recorded = null. A nova
  paid authority `254f8b8b-a950-4fc9-844f-99d6604f57a2` não tem budget event:
  nenhuma reserva/chamada OpenAI/custo ocorreu.
- Estado final do item: `failed`, v2, attempt acima; sem ação disponível.

## Invariantes e efeitos externos

- Nenhum contador global reescrito; evidência anterior preservada; grant single-use.
- Nenhuma integração, aceite, merge, push, publicação ou deploy. `origin/dev`
  permaneceu `4ab99ac`; `origin/main`, `99bec54`.
- Worktrees/evidências preexistentes foram preservadas; `.claude/settings.local.json`,
  `.worktrees/` e `watch4-sensors.txt` não foram incluídos.

## Próximo ponto exato

Não repetir automaticamente: a única autorização foi consumida. Investigar por que
o processo executor não possui permissão para criar branch/worktree sob `.git` e
definir uma nova decisão humana de retry somente depois de corrigir essa fronteira.
