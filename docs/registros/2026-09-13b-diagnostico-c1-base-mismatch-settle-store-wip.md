# 2026-09-13b — Diagnóstico determinístico do gate C1 de `4a36b0a5`: base-mismatch (settle store é WIP-only)

## Tipo e objetivo

Sessão de diagnóstico read-only + reprodução isolada (Claude como executor principal único).
Retomar a barreira C1 da attempt paga falha de `4a36b0a5`, provar a causa EXATA sem novo gasto pago,
e — se não for corrigível deterministicamente dentro do escopo/WIP existente — parar numa barreira
humana real e reportar. NÃO tocar `origin/main`, NÃO criar Pod/authority/reservation, NÃO gerar
compute pago para um erro já objetivamente identificado.

## Estado Git preservado

- Branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (inalterado).
- `origin/main` `99bec54e3ab42bfe882a8686cd1385d8058b916e` — intacta. `origin/dev` behind por 24.
- WIP amplo preservado; nenhum commit/stash/reset/merge/push.
- Output da attempt PRESERVADO: branch `anima-work/2a0011ef-62a4-4f3b-a9bc-575823586138`
  = commit `41e27ec8fc5ffc504c275e6b6038fc1109f84319`.
- Worktree isolado de diagnóstico criado e REMOVIDO com segurança (junctions de node_modules
  removidas ANTES do `git worktree remove`; `G:\anima\node_modules` e `apps/web/node_modules`
  confirmados intactos). Branch efêmera `anima-fix/4a36b0a5-c1-local` deletada (sem commits).

## Reprodução exata do C1 (Fase 2)

Comando do gate (reproduzido no worktree em `41e27ec8`, node_modules por junction):
`npm test --workspace=@anima/web -- post-turn-observation.test.ts openai-actual-cost-settlement.test.ts`

Resultado:
- `openai-actual-cost-settlement.test.ts` → **PASS** (2 testes; a primitive é sã na base).
- `post-turn-observation.test.ts` → **Test suite failed to run** (compile error):
  `post-turn-observation.ts:9:10 TS2724 — '"./paid-compute-authorization-store"' has no exported
  member named 'settlePaidComputeBudgetReservation'. Did you mean 'voidPaidComputeBudgetReservation'?`
- Exit 1. (Gates param na 1ª falha ⇒ C2 typecheck nunca rodou na attempt.)

## Causa-raiz (Fase 3) — base/dependência fora de escopo (NÃO é bug de 3 arquivos, NÃO é compute pago)

Split de três vias, comprovado com `git show`/`grep`:
1. **Committed `d783a5d`** (base de TODA a cadeia de recovery): store exporta só
   `voidPaidComputeBudgetReservation`. **NÃO** exporta `settlePaidComputeBudgetReservation`.
2. **Dev WIP (working tree, uncommitted)**: store **exporta** `settlePaidComputeBudgetReservation`
   (linha 337) — arquivo `paid-compute-authorization-store.ts` está `M` (WIP da Resilient Cloud
   Session V1: RPC `settle_paid_compute_budget_reservation` + migração `20260910000001`, NÃO aplicada
   durável).
3. **Primitive `openai-actual-cost-settlement.ts`**: existe na linha da attempt (`b6201d8`+) mas
   **AUSENTE** tanto em `d783a5d` quanto no working tree do WIP.

A binding (`post-turn-observation.ts`) importa `settlePaidComputeBudgetReservation` do store. Os
checkpoints `b6201d8 → 421a533a → 41e27ec8` foram construídos sobre `d783a5d` (committed), que NÃO
tem essa função. A primitive e a função-de-store do settlement NUNCA coexistiram na mesma árvore ⇒
a binding **não compila** na base da attempt ⇒ suite falha ⇒ C1 exit 1. Nenhum coder (pago ou local)
editando apenas os 3 arquivos do escopo resolve isso: a dependência que falta é um 4º arquivo que
vive só no WIP não-commitado.

Um retry pago `gpt-5.6-terra` falharia IDÊNTICO (dependência ausente na base) ⇒ compute pago NÃO se
justifica.

## Defeitos secundários no output do coder (além do base-mismatch)

Mesmo com o export presente, a binding ainda estaria incorreta:
- **Adaptador de callback errado (bug real):** `post-turn-observation.ts` passa o
  `OpenAISettlementAuditV1` cru para `settlePaidComputeBudgetReservation(client, ...)`, cuja entrada
  é `{ reservationId, settled:{currency,amount}, costSource }`. A proposta exigia adaptar o audit para
  `{ reservationId, settled: actualCost, costSource }` — não feito (erro de tipo em C2 + runtime errado).
- **Caller vivo não ligado:** `autonomous-backlog-deps.ts:277` chama `persistPostTurnHostObservations`
  SEM popular `result.openAIActualCostSettlement`; a binding lê esse campo via `as unknown as` ⇒ no
  caminho vivo seria `undefined` e o bloco de settlement (não `.catch`) lançaria. A proposta exigia o
  teste atravessar `buildProjectBacklogCycleDeps(...).runTurn`.
- **Provável defeito de harness de teste (mascarado):** o `jest.mock('./openai-actual-cost-settlement',
  () => ({ settleOpenAIActualCostReservation }))` referencia consts fora de escopo sem prefixo `mock`
  (proibido pelo Jest) — provável 2ª falha, escondida atrás do erro de compilação.

## Financeiro / segurança

- Nenhum novo gasto: OpenAI US$16,30 e RunPod US$12,88 (saldos informados pelo humano) INALTERADOS.
- Nenhuma authority/reservation criada; nenhum settle/void; reserva `74bfd377` (US$1,50, `cost_unknown`)
  segue ABERTA e intocada; reservas anteriores intocadas.
- `origin/main` intacta; `dev` HEAD inalterado; WIP preservado. Estado do work item `4a36b0a5`:
  `failed` v1 (inalterado).

## Barreira humana real (ponto de parada) e próximo ponto exato

C1 só passa — e o item só chega a `review` de forma governada — quando a função de store
`settlePaidComputeBudgetReservation` (hoje WIP) e a primitive coexistirem na base sobre a qual a
self-dev roda. Isso é uma DECISÃO DE BASE/COMMIT sobre o WIP com "push retido / decisão humana
pendente" — estrutural/financeira, portanto exige aprovação humana. Opções (todas determinísticas,
sem compute pago):
- (A) Commitar o WIP do settlement de store (settle fn + RPC/migração `20260910000001`) numa base, e
  re-materializar o checkpoint de recovery a partir dela (a binding então compila); depois completar a
  correction (hand-author) ou uma attempt governada até `review`.
- (B) Materializar a primitive + a binding correta + teste que atravessa o caller vivo DENTRO do dev
  WIP (que já tem a função de store) e integrar/testar localmente (determinístico, sem compute pago) —
  porém isso amplia a mudança além do escopo governado de 3 arquivos e modifica o WIP de decisão
  pendente; requer OK humano explícito pela sensibilidade do WIP.
- (C) Rebase governado da base/checkpoint do work item para um commit que inclua o WIP.

Recomendação: confirmar (B) OU escolher (A). Sem essa decisão, o escopo de 3 arquivos permanece
inviável na base atual. Registro anterior: `2026-09-13-selfdev-4a36b0a5-execucao-paga-barreira-gate-focal.md`.
