# 2026-09-25i — Request changes de f19ac716 e correção com gate `next build` (pré-authority)

## Decisão humana

REQUEST CHANGES em `f19ac716` (commit `d1d6c5d`): `next build` falha (route.ts exporta
`evaluateDevReadiness`); drift do contrato (exigia `ANIMA_RESIDENT_*`; só com as 2 vars Supabase
dava 503, contradizendo o critério 1 da v3); cobertura incompleta; gate insuficiente
(jest + tsc não pegam o contrato de Route Handler). Auditoria: conversa desta sessão.

## Barreiras de harness/orquestração corrigidas (US$0) — `0693efe`

1. A correção não podia acrescentar gates: `anima work correct <id> --require-gate "<npm …>"`
   acrescenta provas exigidas pela revisão (allowlist do planner E do executor; dedupe; nada
   removido), como `gate_assertion` do critério funcional, citadas no objetivo.
2. Worktrees do executor no TEMP (C:) com junction para node_modules em G: faziam o webpack do
   `next build` resolver `./G:/…` e falhar por ambiente: com TEMP em outro volume, as worktrees
   vão para `<repo>/.worktrees`.
3. Prova ao vivo pelo caminho do executor (GitWorktree → linkNodeModules → runGate):
   `npm run build --workspace=@anima/web` PASS na base `f228727` (43 s) e FAIL em `d1d6c5d` com o
   erro exato do export inválido (controle negativo).
- core 100 suítes / 2035; web 144 / 1797; typecheck PASS.

## Sequência canônica

1. `work request-changes f19ac716 --reason "<431 chars>"` ⇒ 54599 `changes_requested`
   (revisa o resultado `0b5c54c4`). Texto verificado a seco: rework = os 2 arquivos; objetivo 998
   chars (sem truncamento).
2. `work correct f19ac716 --require-gate "npm run build --workspace=@anima/web"` ⇒ sucessor
   `7610b066-0fe1-4004-b9a0-fe18e6e51ca3`, lineage `d72ac677` (f19ac716 → 7610b066, seq 1).
   Retoma do checkpoint `d1d6c5d` (diff contra base `f228727`); escopo = route.ts + route.test.ts
   (rework explícito, nada preservado); `max_attempts` 1; gates: teste focal, typecheck web,
   `npm run build --workspace=@anima/web` (todos gate_assertion do critério funcional) + contenção
   de escopo. Cosmético: com todo arquivo em rework o texto diz "preservada em nenhum" e há um
   critério trivial "implementação já verificada ()".
3. `work approve` (conteúdo derivado do pedido humano; ato executado pelo agente, reversível
   por withdraw) ⇒ 54602; `work set-compute` provider_api/openai/gpt-5.6-sol ⇒ 54603.
4. Host reiniciado em `0693efe`; `work prepare-autonomous` ⇒ 54604; Router ⇒ 54605
   `waiting_for_human_authorization`, decision_id `1eaf95da-c46e-529d-b61c-d5733ee6f732`
   (4 avaliações = 1 evento).

## Zero gasto

41 authorities (inalterado), 35 reservas abertas (inalterado), execution_started 103
(inalterado), 0 claims do sucessor, Ollama down, log do host só config/state/wake.

## Retomada

Humano decide a authority: `npm run anima -- work authorize-compute 7610b066-0fe1-4004-b9a0-fe18e6e51ca3 --max-usd 3 --max-minutes 30 --valid-hours 2`.
Sem push; `origin/main` = `99bec54`.
