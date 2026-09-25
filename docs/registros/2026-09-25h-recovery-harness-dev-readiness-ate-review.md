# 2026-09-25h — Recovery de harness e 2ª prova E2E paga até `review` (dev-readiness)

## Lacuna estrutural e primitiva nova (US$0)

`2c7afe1d` falhou (attempt `c284f09c`) por defeito de HARNESS, corrigido em `d17dcbe`/`b496708`,
com `max_attempts=1` esgotado. Nenhum caminho canônico descrevia o caso sem diagnóstico falso:
retry `BLOCKED/attempt_budget_exhausted`; `replan` só `test_code_incorrect`; `authorize_work_resume`
é envelope de um incidente (1 teste, ollama, checkpoint); decomposição exige checkpoint.

`d30f9bb`: RPC `authorize_harness_fix_recovery` + tabela `work_harness_recoveries` (migration
`20260925000002`, via `migration up`), parser core, `recoverFromHarnessDefect` (host confere SHA
completo do fix contido no HEAD e registro existente) e CLI `anima work recover-harness`. Exatamente
um sucessor `proposed`, mesma proposta, `max_attempts=1`, proveniência no spec; não aprova, não
prefere, não paga. pgTAP 17/17; core 100/2031; web 143/1789.

## Sequência

1. `work recover-harness 2c7afe1d … --fix d17dcbe --fix b496708 --evidence docs/registros/2026-09-25g-…`
   ⇒ sucessor `f19ac716-d599-4be7-94e0-5a16e14ac455`, lineage `c79ab1e9` (seq 1), proposta
   idêntica à v3, spec idêntico salvo `max_attempts=1` + `harness_recovery`; replay ⇒ mesmo sucessor.
2. Host parado; `work approve` (conteúdo idêntico à v3 aprovada pelo humano; recuperação autorizada
   no chat) ⇒ 54582; `work set-compute` provider_api/openai/gpt-5.6-sol ⇒ 54583.
3. Host reiniciado em `d30f9bb`; `work prepare-autonomous` ⇒ 54584; Router ⇒ 54585
   `waiting_for_human_authorization`, decision_id `e2e07b93-3d00-569d-a5d3-10e0564e6605`
   (4 avaliações = 1 evento; Ollama admissível e não usado). 0 authority/attempt/reserva nova.
4. `work authorize-compute f19ac716 --max-usd 3 --max-minutes 30 --valid-hours 2` ⇒ authority
   `509f4088-2551-41fc-ba06-a617fc89375f`.
5. Host sozinho: 54586 selected `preferred_candidate` (decision_id
   `c8632860-78ec-43c5-b54f-2a7368663abd`); claim `936f4df1`; attempt
   `2a145ca1-9ffa-4a82-9cce-c1bcbb4997aa` (20:00:52Z); reserva `58df9b35` US$3.
6. Sol: 20 chamadas, 192 416 tokens de entrada (48 386 em cache), 6 743 de saída, coder 128,7 s;
   rodadas: investigação → edit → teste vermelho → edit → teste verde → `git diff` exit 0 contado
   como revisão (fix `d17dcbe` ao vivo) → `submit_allowed`.
7. Worktree commit `d1d6c5d` (branch `anima-work/2a145ca1…`, base `f228727`): +152 linhas em
   `apps/web/app/api/dev-readiness/{route.ts,route.test.ts}` (escopo respeitado).
8. Gates do host: teste focal PASS (5,3 s); typecheck web PASS (9,2 s).
9. Verifier: `inconclusive` — 0 violações, 4 lacunas `acceptance_substantive_gate_insufficient`
   (critérios comportamentais só com prova de gate; falta primitiva de prova substantiva).
10. Estado final `review` (20:03:33Z). Sem retry, sem segunda attempt/authority, sem Ollama.

## Achados para a revisão humana

- A rota exige também `ANIMA_RESIDENT_EMAIL`/`ANIMA_RESIDENT_PASSWORD` (nomes apenas), além das
  duas variáveis Supabase do plano v3 — acoplamento fora do objetivo aprovado.
- `route.ts` exporta `evaluateDevReadiness` e o tipo `DevReadinessResult`; rotas do App Router
  aceitam só handlers/config — `next build` pode recusar (não verificado; gates eram jest + tsc).

## Contabilidade

Authorities 40→41 (`509f4088`); reservas abertas 34→35 (`58df9b35`, cost_unknown, B1);
execution_started 102→103. Reservas históricas intocadas. Sem push; `origin/main` = `99bec54`.
