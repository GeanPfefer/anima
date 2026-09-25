# 2026-09-25g — 2ª prova E2E paga (dev-readiness): caminho normal provado até a attempt; falha de harness

## Unidade

`2c7afe1d-996a-419c-994c-f142d18be0cd` — `GET /api/dev-readiness`. v3 aprovada pelo humano
(19:23:55Z), escopo `apps/web/app/api/dev-readiness/{route,route.test}.ts`, gates jest focal +
typecheck web, `max_attempts: 1`, `base_sha` `f228727`.

## Caminho percorrido (sem scripts `_session` disparando o coder)

1. `work set-compute` → `compute_preference_recorded` 54558 (provider_api/openai/gpt-5.6-sol, user).
2. `work prepare-autonomous` → 54559. Resident Host (HEAD `f228727`, Router ON) ⇒ 54560
   `waiting_for_human_authorization`, decision_id `1aa500db-efc0-534c-927a-676ff3e07ac8`
   (6 avaliações = 1 evento; Ollama admissível e não usado).
3. Humano: `work authorize-compute … --max-usd 3 --max-minutes 30 --valid-hours 2` ⇒ authority
   `fb82c5ea-33ae-42c4-bfc0-df67d6e44722` (openai / openai-api / provider_api:gpt-5.6-sol,
   item-bound, US$3, 30 min, até 21:29:12Z).
4. Host reavaliou sozinho: 54561 `compute_routing_decided` selected, `preferred_candidate`,
   authorizationId `fb82c5ea`, decision_id `2588f3a8-f9e7-4c7a-9150-46303525f240` (decisão nova,
   pois o conteúdo mudou de waiting para selected); 54563 `work_routing_decided`
   `openai:gpt-5.6-sol`; claim `7823fa2c`; attempt `c284f09c-dc43-4e4e-a8a1-592f3fadd561`
   (19:29:18Z); reserva `9d80439d` US$3 (19:29:34Z).
5. Sol (openai:gpt-5.6-sol, remote, openai-api), 118,6 s de coder: leu contexto, criou
   `route.ts` (68 linhas) e `route.test.ts` (139 linhas), teste focal vermelho
   (`Response is not defined` no Jest), corrigiu o teste, teste focal VERDE 4/4.
6. 54567 `execution_failed` (19:31:33Z): `[ollama_submit_gate_unsatisfied] esgotamento (reserva
   pós-edit esgotada)`. Claim liberada; worktree restaurada/descartada; branch
   `anima-work/c284f09c…` sem commit além da base. Estado final `failed`, sem retry.

## Causa (harness, não modelo)

`git diff` não mostra arquivos untracked e qualquer `replace_exact` — mesmo sobre arquivo criado
na própria sessão — exigia diff não vazio; o caminho natural `git diff --no-index` sai com 1
quando há diferenças e não contava. A revisão de diff nunca era registrada ⇒ submit bloqueado ⇒
reserva pós-edit esgotada. Unidades que só CRIAM arquivos eram inviáveis.

Defeito correlato: a falha descartava o uso do provider (tokens/chamadas) na evidência.

## Correções (US$0)

- `d17dcbe`: diff não vazio só exigido quando um arquivo PRÉ-EXISTENTE foi modificado;
  `git diff --no-index`/`--exit-code` com exit 1 e saída conta como revisão; guarda preservada.
- `b496708`: uso do provider acompanha o erro do coder e entra na observação `failed`.
- Web 141 suítes / 1780 PASS; regressões reproduzem a falha real (falham no harness antigo).

## Contabilidade

1 authority (39→40) · 1 reserva nova `9d80439d` US$3 aberta (`cost_unknown`, B1 congelada) ·
1 attempt · 1 claim (liberada) · 0 Ollama · 0 fallback · 0 segunda attempt (restart do host
posterior não gerou evento). Tokens/chamadas desta attempt: NÃO registrados (defeito agora
corrigido); ~18 rodadas de protocolo no transcript. Gates do host e Verifier: não executados
(a attempt falhou antes do submit).

## Retomada

Nova exposição paga exige decisão humana: recuperação governada (`work authorize-resume` ou
replan) + `work set-compute` no sucessor (preferência não é herdada) + nova `authorize-compute`.
Sem push; `origin/main` intacta.
