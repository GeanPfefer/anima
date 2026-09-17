# 2026-09-12 — Reconciliação self-dev: successor inerte `fe99e446` + barreira de autoridade paga expirada

## Objetivo e mandato

Retomar o self-dev como executor principal único a partir do estado real persistido (fluxo
successor/recovery relacionado a `8021c1ce`), sem reiniciar investigação nem recriar trabalho
existente. Reconciliar HEAD/branch/origin e working tree; reconciliar work item/successor/
attempts/review/event log persistidos; preservar WIP e chats Work duplicados. Prosseguir até
`review` com evidência verificável **ou** até a primeira barreira humana real. Não corrigir teste
manualmente, não elevar teto, preservar as reservas existentes e `origin/main`, operar com
identidade residente/RLS (nunca `service_role`).

## Estado inicial e final (inalterado nesta sessão)

- Branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`.
- `dev` à frente de `origin/dev` por 24; **push permanece retido**.
- `origin/main` inicial/final `99bec54e3ab42bfe882a8686cd1385d8058b916e` — **INTACTA**.
- WIP amplo preservado (57 modificados + 98 untracked, incl. `.worktrees/`). Nenhum
  reset/stash/drop/edição. Esta sessão só executou consultas **read-only**.
- Supabase local **UP** (containers healthy). Identidade residente GoTrue→Bearer→RLS ativa.

## Reconciliação persistida (fonte autoritativa)

### Ponto 2 — item `8021c1ce-6ad6-4038-b30e-183805f2e7f9`
- Estado terminal: **`failed`**. Event log termina em `checkpoint_recorded` → `execution_failed`
  → `work_claim_released` → evidências host-observed. **Sem `result_submitted`, sem Verifier, sem
  review.** Confirma o registro `2026-09-11c`; **não avançou**.
- Reserva `688c7a44-d4bd-4169-857d-37d058f94122` (US$1,00, lease `provider-api:8e51abf5…`):
  **ABERTA/unsettled** (fail-closed correto). Autoridade `b899c45b` teto US$1,00, remaining 0,
  `validUntil 2026-09-12T12:36:07Z` → **EXPIRADA**.

### Ponto 1 — item `8fe633eb-…`
- Reserva `e3d316d8-…` (US$0,50, attempt `c0edc775`): **ABERTA**. Autoridade `3d574766`,
  `validUntil 2026-09-12T11:56:14Z` → **EXPIRADA**.

### `8a2515d8-…` (prova "melhor capacidade")
- Reserva OpenAI `b1c37346-…` (US$1,00, attempt `60f8287b`): **ABERTA**. Autoridade `67c6a9cf`,
  `validUntil 2026-09-12T09:07:25Z` → **EXPIRADA**.
- RunPod authority `3b87224f-…`: **RECONCILIADA** (18/18 settled, committed US$1,04387, remaining
  US$0,45613). **NÃO tocar/recriar/revogar.**

### Achado novo — successor INERTE `fe99e446-9f14-45d0-97f5-764e9c2af8a9`
- Criado 2026-09-11 12:47:53Z (~6 min após `8021c1ce` falhar). Padrão de **chat Work
  duplicado/paralelo** — não estava em nenhum registro anterior.
- Event log: apenas 3 eventos — `context_attached` (v1), `work_proposed` (v1),
  `proposal_revised` (v2). **NÃO aprovado, sem attempt.**
- Proposta v2 **não terminal**: `included_scope` = `post-turn-observation.ts` +
  `openai-actual-cost-settlement.ts`, **omite o arquivo de teste focal**; o próprio risco declara
  que a ausência de teste focal a torna não verificável. Executá-la exigiria **v3 revisado
  (planner pago)** antes de coder pago.
- Autoridade OpenAI dedicada `f5b1021c-a4b2-44ea-b0e4-074412a45c19`: teto **US$1,25, remaining
  1,25 (INTACTA)**, `validUntil 2026-09-12T12:47:53Z`.

## Barreira humana real e objetiva (ponto de parada)

Às 2026-09-12 ~12:40Z, **todas** as autoridades OpenAI por-item estavam expiradas, exceto
`f5b1021c` (US$1,25), que expiraria em **~7 minutos** e estava presa a uma proposta **não
terminal**. Não há caminho responsável até `review` sem decisão humana, porque:

1. Progresso governado do settlement exige coder OpenAI **pago** (política de capacidade honesta
   ⇒ local inadmissível; barreira de RAM da Goma para coder forte local permanece).
2. A única autoridade válida expirava em minutos e exigiria **primeiro** uma revisão v3 paga da
   proposta — inviável e imprudente na janela; um disparo às cegas repetiria o gate-fail das duas
   tentativas anteriores e queimaria dinheiro real.
3. Após 12:47:53Z, **nenhuma** autoridade paga OpenAI válida resta ⇒ qualquer retry exige o humano
   **conceder nova autoridade** (decisão financeira).
4. As reservas abertas (`688c7a44`, `e3d316d8`, `b1c37346`) **não podem** ser liquidadas por mim:
   `pricing=null` (o Ponto 2 é justamente a feature ausente que calcularia o custo real) e não se
   infere custo do teto; `void` é **inaplicável** (o provider FOI chamado — 7 calls/54.258 tokens
   na attempt `8e51abf5`). Settle/void = decisão humana. **AUTO-APPROVAL NÃO EXISTE.**
5. Causa-raiz recorrente das duas falhas é o **harness de teste defeituoso do coder** (Ponto 1:
   teste lê `entry.coderBackend` em vez do backend do intent; Ponto 2: teste importa `vitest` em
   workspace Jest). Um novo attempt cego não corrige isso.

## Segurança / efeitos externos

- Nenhuma mutação: sem escrita no ledger (reserve/void/settle), sem RPC de escrita, sem Pod
  RunPod, sem merge/integração/publicação/deploy, sem alteração de `origin/main`, sem push.
- Sem `service_role`; nenhum segredo/token impresso.

## Próximo ponto exato de retomada (decisão humana)

Escolher uma das trilhas antes de gastar de novo:
- **(A) Nova autoridade + successor re-escopado:** conceder autoridade OpenAI fresca e revisar
  `fe99e446` para v3 terminal (incluir o teste focal no `included_scope`, critérios proof-typed,
  exigir Jest e wiring real do callback→`settlePaidComputeBudgetReservation` com `reservationId`
  correlacionado e evidence persistida). Só então aprovar/executar até `review`.
- **(B) Higienizar o ledger:** decidir como liquidar `688c7a44`/`e3d316d8`/`b1c37346` a partir de
  custos reais do provider (dashboard OpenAI), sem inferir do teto.
- **(C) Endurecer o harness do coder** (âncora Jest no arquivo-alvo / guardrails) antes de novo
  gasto, para quebrar o modo de falha recorrente.

Referências: `docs/registros/2026-09-11c-selfdev-ponto2-openai-settlement-gate-fail.md`,
`2026-09-11b-aprovacoes-settle-accept-e-selfdev-ponto1-gate-fail.md`.
