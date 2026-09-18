# 2026-09-18 — Benchmark settlement B1/B2/B3: reconciliação da reserva 11031d53 e destino do oráculo

Data: 2026-09-18
Tipo: reconciliação read-only + decisão técnica (registro docs-only)

## Objetivo

Eliminar a ambiguidade restante do **benchmark settlement B1/B2/B3** (OpenAI
actual-cost) e não deixar a reserva paga / authority pendente sem razão explícita.
Responder objetivamente: (1) o benchmark ainda é válido? (2) o work item/successor
ainda representa a arquitetura atual? (3) a reserva de USD 1,50 ainda está aberta?
(4) qual a ação canônica para a reserva? (5) qual o destino da fiação viva do
settlement / do oráculo `0bea4c8`?

Fontes detalhadas referenciadas (não duplicadas aqui):
`2026-09-15-terceira-prova-benchmark-ja-executada-barreira-reconciliacao.md`,
`2026-09-17-reconciliacao-final-worktrees-branches-historicas.md`,
`2026-09-14h-benchmark-settlement-v3-barreira-autorizacao-externa.md`.

## Estado autoritativo confirmado (git, read-only)

- Branch `dev`; HEAD inicial `d47e15a`; `origin/dev` `d47e15a`; `origin/main`
  `99bec54` (INTOCADA).
- Árvore limpa exceto os dois untracked preservados: `.worktrees/` e
  `watch4-sensors.txt`.
- Linha `anima-recovery/seq5-base` presente localmente (HEAD `af313c3`), contendo
  `ccb7dcc` → `0bea4c8` (oráculo) → `af313c3`. **Merge-base de `dev` e do oráculo =
  `b14a32c`** ("Canonize a infraestrutura mínima de settlement do ledger de compute
  pago"), que É ancestral de `dev`. `ccb7dcc`/`0bea4c8`/`af313c3` NÃO são ancestrais
  de `dev`. Os negativos do benchmark `5fad667` e `61eb2eb` existem e estão fora de
  `dev`.

## Estado canônico VERIFICADO no store vivo (não herdado de relatório)

Docker Desktop e Supabase local foram subidos por reattach (`supabase start`, **sem
`db reset`**); serviços essenciais healthy (db/auth/rest/kong/realtime). Identidade
residente via GoTrue (RLS; nunca `service_role`). Consultas exclusivamente
read-only.

- **Reserva `11031d53-6168-485a-a929-0a9158db9228`: ABERTA.** Único evento de budget
  da authority = um `reserved` de USD 1,50. `voided: false`, `settled: false`,
  `settledCost: null`, `costSource: null`. `leaseId: provider-api:7d6d55be…`,
  `nodeId: openai-api`, criado 2026-09-15T12:19:24Z. Nenhum `settled`/`voided`
  posterior.
- **Authority `6548cfb4-f1e1-4965-a0cd-64f1cba7249a`: EXPIRADA, não revogada.**
  `resource_class: provider_api:gpt-5.6-terra`, teto USD 1,50, `valid_from`
  2026-09-15T12:18:42Z, `valid_until` 2026-09-15T13:19:12Z (janela fechada há ~3
  dias), `revoked_at: null`. Agregado: reserved 1,5 / voided 0 / settledExcess 0 /
  committed 1,5 / **remaining 0** (teto integralmente comprometido nesta única
  reserva).
- **Work item `d054b90f-14e5-4f33-b236-3fe62e97cc20`: `failed`**
  (proposal_version 1, updated_at 2026-09-15T12:22:43Z). Claim
  `8e76fb98…` liberado com `release_reason: attempt_finished`; attempt
  `7d6d55be-2fd3-4ca1-8ceb-c9ccc418080d`.
- A **proposta do work item É a especificação do benchmark**: refazer B1/B2/B3
  usando como spec read-only o diff `ccb7dcc..0bea4c8`; escopo restrito aos 4
  arquivos; efeitos E1–E7; explicita **"Pricing null não liquida"** e proíbe
  promover/cherry-pickar/mergear/copiar a referência.

## Comparação semântica oráculo `0bea4c8` × `dev` atual

O oráculo toca 4 arquivos (`+317/-7` sobre `ccb7dcc`; e `ccb7dcc` cria
`openai-actual-cost-settlement.ts`/`.test.ts`). A fiação viva do settlement continua
**ausente em `dev`** (arquivo `openai-actual-cost-settlement.ts` inexistente; sem
bloco de liquidação em `post-turn-observation.ts`; sem caller em
`autonomous-backlog-deps.ts`) — a lacuna é intencional.

**Todos os pontos de fixação exigidos pelo oráculo continuam existindo em `dev`**
(a arquitetura NÃO driftou para longe do alvo):

- `ExecutionContract.coderBackend: string | null` (executor-selection.ts).
- `ObservedCoderInput.providerUsage?: ProviderReportedUsageV1` e
  `providerCallCount?: number` (host-observed-coder-evidence.ts).
- `settlePaidComputeBudgetReservation(client, { reservationId, settled, costSource })`
  e `readPaidComputeBudgetAudit` (paid-compute-authorization-store.ts);
  `NodeCostSourceV1 = 'estimated' | 'provider_confirmed'` (o adapter do oráculo usa
  `'estimated'`, válido).
- Seam `calculateApiAttemptCost` + `ProviderPricingV1` + `ComputeCohortKeyV1`
  (packages/core/compute-economics.ts), com assinatura compatível com a chamada do
  oráculo.
- Tabela `paid_compute_budget_events` + correlação `provider-api:<attemptId>` +
  RPC de settlement (migrations 20260831/20260904/20260910).
- Estrutura de `post-turn-observation.ts` intacta (blocos 0/0b/1/2; o oráculo
  insere o bloco de liquidação logo após 0b).

Pré-requisitos da "próxima attempt melhor" já **committados em `dev`** (não mais
WIP): Parte A observabilidade (`CoderCommandObservationV1` em
`packages/core/.../coder-transcript.ts`; `output-sanitization.ts`) e Parte B reserva
pós-edit ancorada (`roundCap()` em `ollama-coder.ts`) — commits `addf467`/`953123e`.

Ponto crucial de comportamento: para `gpt-5.6-terra` o `pricing=null`, então mesmo a
fiação integrada faria `calculateApiAttemptCost` retornar `cost_unavailable` ⇒ **não
liquidaria** a reserva. O settlement é um seam pronto aguardando pricing versionado;
sua utilidade hoje é como alvo de prova de capacidade self-dev, não como liquidação
efetiva.

## Decisões

### Benchmark = **B1 — permanece válido e CONGELADO**

- **Não B3 (aposentar):** a lacuna é real e não implementada em `dev`; a arquitetura
  ainda suporta o alvo; o teste de capacidade (o coder governado implementar a fiação
  correta multi-arquivo, type-correct, sob orçamento) continua significativo. Nada o
  substituiu.
- **Não B2 (retomar/adaptar agora):** retomar = nova attempt paga self-dev, que exige
  **nova autoridade humana + compute pago** (fora deste mandato); adaptar = eu
  escrever a fiação à mão, o que **colapsa o benchmark** (a referência não pode ser
  promovida/cherry-picked/merged/copiada; hand-author não classifica). Nenhum caminho
  é viável sob este mandato.
- O congelamento está agora em estado **melhor preparado** (A/B committados; oráculo
  provado como referência de alcançabilidade).

### Oráculo `0bea4c8` = **CONGELADO** (referência/oráculo local)

Não integrado, não aposentado, não adaptado. Permanece na linha
`anima-recovery/seq5-base` como prova de alcançabilidade e spec de referência —
jamais resposta pronta ao agente.

### Reserva `11031d53` = **MANTER** (cost_unknown, com razão explícita)

- **Settle é impossível/proibido:** não há evidência de custo real; `pricing=null`
  para `gpt-5.6-terra` ⇒ custo indeterminável. Liquidar exigiria inventar valor
  (vedado).
- **Void é inaplicável:** o provider FOI de fato chamado (attempt `7d6d55be` rodou
  `gpt-5.6-terra` até o laço edit→test). Void afirmaria falsamente que não houve
  custo externo. Gasto real ocorreu (já refletido no saldo OpenAI); só não é
  quantificável.
- **Revogar authority é desnecessário:** a authority `6548cfb4` já está **expirada**
  (valid_until 2026-09-15) e com **remaining 0** — não autoriza nada novo; sem risco
  financeiro pendente. `revoked_at` permanece `null` por design (expiração temporal,
  não revogação explícita).
- Logo, o estado honesto do ledger É o estado atual: `reserved`, `cost_unknown`.
  Nenhuma mutação é a ação canônica correta.

## Efeitos externos

- **Realizados:** subir Docker Desktop + `supabase start` (reattach); consultas
  read-only ao store (identidade residente GoTrue/RLS); escrita deste registro e um
  commit docs-only em `dev`.
- **Explicitamente NÃO realizados:** nenhuma chamada a OpenAI/RunPod/Ollama; nenhum
  provider call pago; nenhum `supabase db reset`; nenhuma nova reserva/authority/
  attempt/claim; nenhum settle/void/revoke; nenhum retry de work item; nenhum
  accept/merge/integrate/deploy; **origin/main intocada**. Gasto pago nesta sessão =
  **US$ 0,00**.

## Invariantes de segurança preservadas

`authorized ceiling ≠ reserved ≠ settled`; `derived ≠ settled`; void inaplicável
quando o provider foi chamado; autoridades OpenAI por-item são efêmeras (esta
expirou) ⇒ retry pago exige NOVA autoridade humana; hand-author não classifica; não
usar o oráculo como resposta pronta; canonical resident contract / contract stamping
/ Capability Map / database.ts / migrations — todos intactos (sessão não tocou
código funcional).

## Fronteiras humanas restantes (BLOCKED_BY_HUMAN_DECISION)

- **Quarta prova paga do benchmark** (retomar B1 como self-dev): exige novo mandato
  humano explícito + nova authority + compute pago. Fora deste mandato.
- **Liquidação retroativa** da reserva só seria possível se um humano decidir
  estabelecer `ProviderPricingV1` versionado para `gpt-5.6-terra` (decisão de
  produto/financeira) — hoje o custo permanece legitimamente `cost_unknown`.

## Próximo ponto exato de retomada

Benchmark B1/B2/B3 = **B1 congelado**, pré-requisitos A/B já em `dev`. Reserva
`11031d53` reconciliada como MANTER (`cost_unknown`, authority expirada, sem risco
pendente). Para uma quarta prova: obter novo mandato humano, materializar novo
successor de `d054b90f` (a spec da proposta continua válida contra a arquitetura
atual), conceder nova authority por-item e executar pelo Coding Harness V3 (perfil
remoto forte), com WRITE restrito aos 4 arquivos. Não reaproveitar a authority
`6548cfb4` (expirada) nem a reserva `11031d53`.
