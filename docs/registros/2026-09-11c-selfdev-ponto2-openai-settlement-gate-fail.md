# 2026-09-11c — Self-dev Ponto 2: OpenAI actual-cost settlement até gate-fail

## Objetivo e mandato

Priorizar OpenAI actual-cost settlement antes de qualquer retry de `8fe633eb`, usando o pipeline governado completo até `review` ou barreira real. Não corrigir manualmente o teste do Ponto 1, não elevar teto como workaround, preservar WIP/origin/main e operar com identidade residente/RLS.

## Estado inicial e preservação

- Branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`.
- `origin/main` inicial/final `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- WIP amplo preservado; nenhum reset/stash/drop.
- Reserva histórica do attempt `c0edc775` permaneceu aberta e intocada.

## Materialização governada

- Work Item: `8021c1ce-6ad6-4038-b30e-183805f2e7f9`.
- Authority OpenAI por item: `b899c45b-2806-4a5e-98ed-000cdb0d01c1`, teto USD 1,00.
- Planner forte OpenAI `gpt-5.6-terra`. A proposta v2 foi rejeitada operacionalmente por ser estreita (apenas cálculo core); o mesmo item foi revisado canonicamente.
- Proposta terminal v3 alinhada (`covers` == `expectedEffects`), aprovada pelo mandato e classificada com proveniência `openai_project_tools_v1-bridge`.
- Router escolheu `provider_api`, OpenAI `gpt-5.6-terra`; RunPod desabilitado.

## Attempt e resultado

- Attempt `8e51abf5-34e6-4601-8541-0801f5c6d0b0`.
- Branch/checkpoint `anima-work/8e51abf5-34e6-4601-8541-0801f5c6d0b0`, commit `f387c6139845970614d9ec61162d64b836603086`.
- Usage provider-reported: 7 calls; input 49.196; cached input 17.812; output 5.062; total 54.258 tokens.
- Arquivos tocados no checkpoint: `openai-actual-cost-settlement.ts`, seu teste, e `post-turn-observation.ts`.
- Gate core não produziu cobertura terminal; gate web `npm.cmd run build --workspace=@anima/web` falhou com exit 1.
- Estado final do item: `failed`, sem `result_submitted`, sem Verifier e sem review.

## Diagnóstico objetivo

- O teste criado importa `vitest`, mas o workspace usa Jest e não possui dependência/import existente de `vitest`; isso explica a falha de build observável no checkpoint.
- Além do gate, o resultado é incompleto: criou uma função focal e um callback opcional `settleActualCost`, mas nenhum chamador fornece esse callback; não há wiring terminal real, nem passagem comprovada de `reservationId`, nem persistência da trilha de pricing/usage/settlement.
- Portanto o checkpoint não satisfaz o Ponto 2 e não deve ser aceito ou integrado.

## Financeiro e segurança

- Reserva desta attempt: `688c7a44-d4bd-4169-857d-37d058f94122`, USD 1,00, permanece aberta/unsettled (comportamento fail-closed correto na ausência do mecanismo concluído).
- Zero Pods RunPod confirmados por consulta read-only (HTTP 200, count 0).
- Nenhum merge, integração, publicação, deploy ou alteração de `origin/main`.
- Sem `service_role` e sem segredo impresso.

## Fronteira humana / retomada

O item falhou e está na fronteira humana. Não iniciar retry automaticamente. A recuperação recomendada é um successor/replan canônico que preserve o diagnóstico, exija Jest no teste e wiring real do callback/settlement até a reservation e evidence persistida. Antes de retry pago, será preciso nova autoridade ou uma decisão humana sobre como tratar a reserva aberta desta attempt; não inferir custo do teto.
