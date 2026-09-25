# Caminho normal do Resident Host até a authority paga, sem scripts de sessão

**Data:** 2026-09-25 (segunda parte da sessão)  
**Tipo:** desenvolvimento + prova sem custo  
**Branch:** `dev`  
**HEAD inicial:** `c7ac5d4`  
**HEAD final:** commit que contém este registro (consultar `git log -- this-file`)

## Objetivo

Transformar a prova pontual de `bd4092af` (Sol via script de sessão) em capacidade
reproduzível do Resident Host normal: seleção → Router V1 → gate de authority →
coder OpenAI → review, parando corretamente para a authority humana. Nenhuma chamada
OpenAI paga nesta parte.

## Fase 1 — `bd4092af` (review, decisão humana)

Revisão read-only de `7ccc777` numa worktree descartável: +8 linhas só em
`packages/core/src/levels.test.ts`; `levels.ts` idêntico ao checkpoint `9a60f42`;
teste focal 12/12. Mutação: com o `levels.ts` da base, o caso "acima de MAX_LEVEL"
falha (1/12) — o teste discrimina. O `rejected` do Verifier é o artefato de envelope
explicado no [registro anterior](2026-09-25-prova-sol-bd4092af-router-lineage-e-covers.md);
o envelope persistido não foi reescrito. `anima work show` oferece `accept_result` /
`request_result_changes` (o RPC de review não depende do veredito). Nenhuma decisão
tomada por agente.

## Barreiras encontradas e corrigidas

| Commit | Barreira |
|---|---|
| `d6968d5` | Decisão não-selecionada gravada com `decision_id` aleatório: o próprio `compute_routing_decided` acorda o host por Realtime (e o poll de 15 s) ⇒ laço de eventos idênticos enquanto espera authority. Agora id determinístico ⇒ replay no RPC. Também: `fc53649` quebrava a suíte do wiring (fake client sem `work_recovery_lineage`) — corrigido; leitura da lineage à prova de exceção; `resolveOpenAICoderModel` fonte única; `describeComputeRoutingConfig` logado no arranque do Resident Host (Router ligado + config inválida ⇒ não sobe). |
| `33ffe01` | Preferência aprovada `coder_backend: openai` sem authority caía em `local_sufficient` (Ollama em silêncio). Agora espera ou bloqueia; nunca vira local. O planner gravava `openai` com modelo Ollama — modelo agora acompanha o backend. |
| `af3d215` | Espera por authority invisível em todas as superfícies e só destravável por script. `projectComputeRoutingWait` (core, puro); `anima work show` exibe a espera e o comando; `anima work authorize-compute` (ato humano; envelope derivado da decisão; limites explícitos e limitados; recusa sem espera, com authority ativa ou duração < 30 min). |
| `5a8c988` | Planejador local descartava as chamadas de ferramenta do `qwen3-coder`, emitidas em texto (`<function=…>`) e não convertidas pelo Ollama ⇒ "não produziu proposta estruturada" (falha do harness, provada ao vivo). |
| `ae41830` | Timeout fixo de 90 s por rodada do planejador local ⇒ `ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS` [30 s, 600 s]. |
| `abc8f01` | `anima work approve` não classificava: plano aprovado pela CLI nunca entrava na fila. `anima work prepare-autonomous` = paridade com o botão da UI. |

## Configuração do operador

`apps/web/.env.local` (fora de commits; backup em scratchpad) ganhou um bloco
comentado: `ANIMA_COMPUTE_ROUTER_V1_ENABLED=1`, `ANIMA_CODER_MODEL=gpt-5.6-sol`,
`ANIMA_OPENAI_CODER_REASONING_EFFORT=high`, `ANIMA_OPENAI_CODER_TIMEOUT_MS=300000`,
`ANIMA_OPENAI_CODER_OUTPUT_TOKENS=32000`. `ANIMA_CODER_PROVIDER` NÃO foi alterado
(novos planos continuam local-first; preferir OpenAI por padrão é decisão humana).

## Provas

- Determinísticas (wiring real `buildProjectBacklogCycleDeps`, Supervisor mockado):
  F lineage sem progresso local + sem authority ⇒ `waiting`, zero tentativa, zero
  Ollama/provisioner, único RPC = decisão; G com authority ⇒ `gpt-5.6-sol`
  `local_no_progress`; H reavaliação ⇒ mesmo `decision_id` (vermelho com id
  aleatório); I falha de leitura da lineage não derruba a volta; J spec `openai` sem
  authority ⇒ `waiting`, `fallbackChain: []`. Core: preferência autoritativa (4
  testes, vermelhos no código antigo), `projectComputeRoutingWait` (7). CLI:
  `authorize-compute`/`prepare-autonomous`/`work show` (10).
- Resident Host REAL (bounded, 2 iterações, `.env.local` novo): `compute-config`
  `ok:true, routerEnabled:true, model gpt-5.6-sol, reasoning high, 300000 ms, 32000`;
  Realtime `SUBSCRIBED`; fila vazia ⇒ `awaiting_human_or_recovery`; nenhuma volta,
  nenhum provider.
- CLI real: `work authorize-compute bd4092af …` ⇒ recusa `no_compute_authority_wait`,
  nenhuma authority criada.
- Planejador local ao vivo (US$0) sobre o pedido humano preservado no placeholder
  `c41ad2ff`: após as duas correções de harness, o `qwen3-coder:30b` submete
  propostas estruturadas, mas copia o exemplo do prompt (`src/parser.ts`,
  `npm run test`) — limite de capacidade do modelo local, agora provado.
- Gates: core 98 suítes / 2011 PASS; web `tsc` PASS; suítes web amplas PASS (7 suítes
  de integração falharam só sob carga concorrente do Ollama 30B e passaram 75/75 em
  série); `git diff --check` PASS.

Não provado ao vivo: uma unidade REAL `approved` chegando ao Router pelo Resident Host
(não existe unidade elegível honesta — ver fronteira abaixo).

## Fase 4 — B1 (read-only, sem alteração)

- Uso: suficiente (input/cached/output por attempt na evidência host-observada).
- Cálculo: `calculateApiAttemptCost` (core) pronto e testado.
- Ledger: `settle_paid_compute_budget_reservation` aplicado, aceita
  `cost_source ∈ {estimated, provider_confirmed}`; 18 liquidações `estimated` (RunPod).
- Falta 1: preço versionado (`ProviderPricingV1` com `sourceRef`) para `gpt-5.6-sol`
  — fonte externa; não inventado.
- Falta 2: fiação pós-attempt que liquide reservas `provider_api` — é a unidade B1
  congelada por decisão humana (oráculo `0bea4c8`); não implementada.
- `provider_confirmed` exigiria a API de custos da OpenAI (chave admin) — integração
  externa não autorizada.

## Efeitos externos

Nenhuma chamada OpenAI; nenhuma authority, reserva, aprovação, classificação, claim ou
attempt nova. Ollama local iniciado e parado. Sem push/PR/merge; `origin/main` intacta.

## Fronteira humana e retomada exata

1. `bd4092af`: decisão humana de review.
2. Criar a unidade da 2ª prova pelo caminho normal (sem scripts): o humano pede no chat
   (GPT selecionado, modo desenvolvimento) o trabalho preservado em `c41ad2ff`
   (tornar `apps/web/scripts/prove-openai-strong-e2e.ts` reutilizável via
   `resolveTaskMessage`). Opcional: `ANIMA_CODER_PROVIDER=openai` para preferir Sol.
   Depois: aprovar → "Preparar elegibilidade autônoma" (ou `anima work prepare-autonomous`)
   → Resident Host ⇒ `waiting_for_human_authorization` visível em `anima work show`
   → `anima work authorize-compute <id> --max-usd 3 --max-minutes 30 --valid-hours 2`.
3. B1 continua congelado.
