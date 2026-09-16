# 2026-09-11b — Aprovações humanas: settle órfã, accept 8a2515d8, e self-dev Ponto 1 (chain viva até gate-fail)

## Objetivo

Sob mandato humano com 3 decisões autorizadas (ordem obrigatória): (1) settle da reserva RunPod órfã
`2b931274`; (2) `accept_result` do item `8a2515d8`; (3) materializar canonicamente + aprovar + executar
o próximo Work Item de self-dev (Ponto 1 — alinhar caminho legado ao Compute Router). Política de
MELHOR CAPACIDADE (OpenAI forte preferível). Parar na próxima fronteira humana real.

## Estado operacional

- Branch `dev`, HEAD inicial = final = **`d783a5d`** (nenhum commit; execução em worktree isolada).
  `origin/main` = **`99bec54` INTACTA**. WIP amplo PRESERVADO (só +scripts operacionais untracked).
- Docker + Supabase local UP. Zero Pods RunPod ao final.

## 1) Settlement da reserva RunPod órfã `2b931274` (CORRIGE avaliação anterior)

- Fato apurado (corrige o registro anterior que dizia custo~0): o Pod `dxrkpol155xvne` FOI criado e
  **rodou ~178s** (activeDurationMs 178893), custo estimado **~US$0,0243**. Logo `void` era INAPLICÁVEL
  (RPC só aceita `provider_not_called`/`provider_rejected_before_create`; retornou `22023`).
- Reconciliação honesta = **`settle`** (RPC canônico append-only `settle_paid_compute_budget_reservation`,
  Bearer/RLS): settled **US$0,0243** (`estimated`), excesso liberado **US$0,2207**.
- Ledger da autoridade humana `3b87224f` (NÃO recriada/revogada): **18/18 reservas settled, 0 voided,
  0 abertas**; ceiling US$1,50; committed **US$1,0439**; remaining **US$0,4561**.

## 2) `accept_result` do item `8a2515d8`

- Via CLI canônica (`anima work accept`, Bearer/RLS): `review` → **`completed`**. reviewedResultEventId
  `4f2d4b0e-…`. NENHUM merge/integração/publicação/deploy; `origin/main` intacta. A 2ª fronteira de
  integração (INT-05) permanece FECHADA e não foi tocada.

## 3) Self-dev Ponto 1 — cadeia canônica VIVA com melhor compute, até `execution_failed` no gate

- **Materialização canônica (governada, best compute):** mensagem→item placeholder `8fe633eb`→autoridade
  paga por-item **`3d574766`** (openai/`provider_api:gpt-5.6-terra`/teto US$0,50/24h)→**planejador FORTE
  OpenAI** (`openai_project_tools_v1`, proveniência exigida pela classificação; hand-author NÃO classifica)
  →revise→propv2. Proposta ALINHADA: escopo = os 2 arquivos; 1 critério **gate** cujo `covers` == os 2
  `expectedEffects` (ALIGNMENT aligned=true) — estrutura que EVITA o falso `criterion_covers_unknown_acceptance`.
- **Aprovação (decisão humana do mandato) + classificação** OK.
- **Execução (melhor compute):** Router ON + política de capacidade honesta ⇒ **OpenAI gpt-5.6-terra**,
  placement=provider_api, **SEM RunPod**. Attempt `c0edc775`; worktree base `d783a5d`; coder OpenAI 6
  chamadas / 26 833 tokens; `checkpoint_recorded` → **`execution_failed` [gate_failed]**.
- **Causa (coder-capability, NÃO infra):** o **fix de fonte está CORRETO e elegante** —
  `const routedToOpenAI = contract.coderBackend === 'openai'` (cobre Router-ON, pois `contract` é
  atualizado com `decision.selectedProvider` na linha ~203, E Router-OFF com backend do item) ⇒
  placement null ⇒ sem burst. MAS o **teste** ficou defeituoso: o coder fez
  `runTurn({ ...entry, coderBackend: 'openai' })`, porém `runTurn` lê o backend do **intent do item**
  (via client mockado), NÃO do `entry` — o caso não exercita o cenário e o gate reprovou.
  Gate: `npm.cmd run test --workspace=apps/web -- autonomous-backlog-deps-router.test.ts` exit 1.
- **Prova de que é coder-fault e não infra:** o MESMO teste (não-tocado) PASSA 6/6 na árvore atual (WIP)
  — infra de teste saudável; a barreira é a qualidade do teste escrito pelo coder nesta tarefa.
- **Estado do item:** `8fe633eb` = **`failed`** (fronteira humana: retry/replan/correct/withdraw).
- **Reserva aberta (gap conhecido = Ponto 2):** autoridade `3d574766` tem 1 `reserved` **US$0,50**
  (attempt `c0edc775`) SEM `settled` — OpenAI actual-cost settlement ainda não implementado (`pricing=null`;
  reserved≠settled; custo real ~centavos por 26.8k tokens, não inferível honestamente). Um RETRY hoje seria
  NEGADO por orçamento (0,50/0,50 já reservado) até settle/void da reserva ou elevação de teto ⇒ o próprio
  Ponto 1 tornou o **Ponto 2 (settlement OpenAI)** a fronteira técnica acutamente motivada.

## Segurança / efeitos externos

- OpenAI: planner + coder reais (gpt-5.6-terra) sob autoridades pagas governadas por-item. Identidade
  residente (GoTrue→Bearer→RLS), NUNCA service_role. Sem segredos impressos. `origin/main` intacta.
  WIP preservado (só scripts operacionais untracked adicionados).

## Barreira restante / próximo ponto de retomada (fronteira HUMANA)

- **Decisão sobre `8fe633eb` (failed):** (a) autorizar retry/replan para o coder refazer APENAS o teste
  (o fix de fonte já está correto) — requer antes liberar/settlar a reserva `3d574766` ou elevar teto; ou
  (b) correção humana do teste. NÃO retomei sozinho (evita loop de gasto sem progresso; é fronteira humana).
- **Sequência dos outros pontos:** Ponto 2 (OpenAI cost settlement) agora é o mais alavancado (destrava
  retries pagos e fecha reservas honestamente); Ponto 3 (Verifier proof-typing) — já mitigado por criteria
  proof-typed alinhados nesta materialização.
