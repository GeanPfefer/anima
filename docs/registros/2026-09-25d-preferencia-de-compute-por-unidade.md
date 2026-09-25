# 2026-09-25d — Preferência de compute por unidade (correção da barreira estrutural)

## Objetivo

Decisão humana sobre a barreira 2 do [registro 2026-09-25c](2026-09-25c-integracao-8a2515d8-e-barreira-preferencia-executor.md):
sem override global, sem attempt Ollama artificial, sem sinal indireto — corrigir a arquitetura
para que o humano registre, por work item, a estratégia de compute, distinta da authority paga.

## Branch e HEAD

`dev`: início `2c3501f` → `9faf2d0` (capacidade) → este registro. Sem push; `origin/main` = `99bec54`.

## Mudança

Contrato e precedência: [`docs/arquitetura/preferencia-de-compute-por-unidade.md`](../arquitetura/preferencia-de-compute-por-unidade.md).

- Migrations `20260925000000` (enum `compute_preference_recorded`) e `20260925000001`
  (RPC `record_compute_preference`), aplicadas com `supabase migration up` (sem reset);
  `database.ts` regenerado (+10 linhas, baseline anterior com diff 0).
- Core: `compute-preference.ts`; Router registra `preference` na decisão e ganha
  `preferred_model_unavailable`.
- Resident Host (`autonomous-backlog-deps.ts`): lê a preferência vigente (fail-closed),
  para com Router OFF + preferência `provider_api`.
- Planner: `coder_backend_source: 'runtime_default'`.
- CLI: `anima work set-compute`; `anima work show` projeta a preferência.

## Provas

- core 99 suítes / 2021 PASS; web 139 suítes / 1754 PASS (em série); `npm run typecheck` PASS;
  `git diff --check` PASS.
- Regressões Router/Resident Host: PREF-A (sem preferência ⇒ local-first), PREF-B (Sol sem
  authority ⇒ waiting, 0 attempt/provider/Ollama/authority), PREF-C (authority compatível ⇒
  openai/gpt-5.6-sol `preferred_candidate`), PREF-D ×3 (authority de outro modelo, outro item,
  duração curta ⇒ espera, sem local), PREF-E (restart ⇒ mesmo `decision_id`), modelo
  indisponível, Router OFF, `router_default`, falha de leitura; A–J anteriores intactos.
- CLI: `set-compute.test.ts` (parse, ato, recusas, projeção G, legado F).
- pgTAP `compute_preference.test.sql` 13/13.
- Achado pré-existente (não causado aqui): `compute_routing_decision.test.sql` falha desde a
  migration `20260910000000` (ordem dos parâmetros). Registrado como tarefa separada.

## Operação

Resident Host reiniciado no HEAD novo (processo órfão antigo encerrado; exatamente um host).
Ao vivo: `anima work show 58159655…` projeta "preferência: nenhuma · Router padrão (local-first)".

## Efeitos externos

Nenhuma chamada OpenAI, authority, reserva, attempt ou preferência registrada em item real.
Última authority continua sendo `43509ab1` (06:23Z). Ollama não iniciado. Sem push.

## Retomada exata

1. Humano (logado) pede no chat, com GPT em modo desenvolvimento, o endpoint
   `GET /api/dev-readiness` (novo item; `58159655` fica como histórico/duplicata candidata).
2. Revisar o plano (`anima work show <id>`) → `anima work approve <id>`.
3. `anima work set-compute <id> --strategy provider_api --provider openai --model gpt-5.6-sol`.
4. `anima work prepare-autonomous <id>` → Resident Host ⇒ `waiting_for_human_authorization`.
5. Depois da prova ao vivo pré-authority: `anima work authorize-compute <id> --max-usd 3 --max-minutes 30 --valid-hours 2`.
