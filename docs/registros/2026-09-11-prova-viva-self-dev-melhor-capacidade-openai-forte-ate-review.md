# 2026-09-11 — Prova viva: MELHOR capacidade de self-dev (OpenAI forte) do item 8a2515d8 até `review`, sem RunPod

## Objetivo

Sob autorização humana explícita para **maximizar a capacidade de self-development** (custo não é
prioridade; escolher a melhor rota de compute por etapa entre LOCAL/GOMA, RunPod e OpenAI), executar
o item canônico **8a2515d8** (`approved`, propv2) pela cadeia real
seleção → admissão → claim → attempt → **compute escolhido** → coder forte → edição real → gates →
Verifier → `review`, corrigindo apenas barreiras estruturais.

## Estado operacional

- Branch: `dev`. HEAD inicial = HEAD final = **`d783a5d`** (WIP amplo NÃO commitado, PRESERVADO íntegro).
- `origin/dev` = `4ab99ac` (dev ahead 24; push RETIDO, decisão humana). `origin/main` = **`99bec54` INTACTA**.
- Docker + Supabase local: UP. Nenhum commit criado nesta sessão (execução via worktree isolada).

## Diagnóstico — por que o caminho tentava compute pago (RunPod) em loop

- `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts` (caminho legado, Compute Router **OFF**):
  o bloco de burst on-demand engata quando `placement === 'defer'` **OU** `onDemandBurstForced()`
  (`ANIMA_ON_DEMAND_FORCE_BURST=true`), gated só por `admittedPressure !== 'unknown'` — **independente do
  coder**. Como o contrato do item pede `coder_backend=ollama` + `model=qwen3-coder:latest` (30B, NÃO cabe
  na Goma 16 GB ⇒ `defer`), toda volta tentava provisionar um Pod RunPod. Com a barreira de infra do SECURE
  (endpoint/túnel não publica/estabiliza), a provisão falhava ANTES de qualquer coder ⇒ `notExecutable` ⇒
  **loop de provisão/teardown** (123 eventos `host_observed_node_lifecycle_recorded`; ~1¢/ciclo, sem progresso).
- Inconsistência estrutural: um coder de API (OpenAI) não precisa de nó GPU, mas o caminho legado só
  desativa placement/burst quando o **Router** roteia para OpenAI (`routedToOpenAI ? null : decideCoderPlacement`).

## Rota escolhida — OpenAI FORTE `gpt-5.6-terra` (melhor capacidade), SEM RunPod

Para uma correção de parser TS precisa (rejeitar `--task`/`--task-file`/flags/posicionais com Error acionável;
resolver a const morta `DEFAULT_TASK_MESSAGE`), o modelo frontier é **superior** ao qwen3-coder 30B self-hosted
e dispensa GPU/infra RunPod. Mecanismo **canônico, sem mutar o item aprovado e sem alterar código WIP**:

1. **Autoridade paga `provider_api`** (append-only, RPC `grant_paid_compute_authorization` via identidade
   residente Bearer/RLS): `67c6a9cf-29a1-435e-a910-0fdfdd1d382f` — `openai`/`openai-api`/
   `provider_api:gpt-5.6-terra`/item 8a2515d8/teto **US$1.00**/24h (dentro do saldo OpenAI ~US$18.29).
2. **Compute Router V1 LIGADO** (`ANIMA_COMPUTE_ROUTER_V1_ENABLED=1`) + **política de capacidade HONESTA**
   (`ANIMA_CODER_VRAM_GB=16`; allowlist `[{qwen3-coder:latest, requiresGb:20}]`) ⇒ candidato local
   **inadmissível** (barreira de RAM real e documentada) ⇒ Router seleciona **OpenAI** ⇒ `placement=null`
   ⇒ **nenhum burst RunPod**. `ANIMA_ON_DEMAND_NODE_ENABLED=false` como defesa em profundidade.
   Env setado **só no processo do runner** (NUNCA em `.env.local`, arquivo preservado).
3. Turno único via a composição de produção `runProjectBacklogHostTurn` (a MESMA da rota HTTP e do resident
   host), com `requestedWorkItemId=8a2515d8` (o item já tinha `autonomous_execution_request` sem
   `execution_started`) — o backlog é filtrado ao item pedido (b34d4561 duplicado NUNCA elegível).
   Runner operacional: `apps/web/scripts/run-one-turn-8a2515d8.ts` (não commitar).

## Prova (eventos canônicos, item 8a2515d8)

- `compute_routing_decided`: **status=selected, selectedProvider=openai, selectedModel=gpt-5.6-terra,
  placement=provider_api, authorizationId=67c6a9cf**; alternativa `ollama` admissible=**false** (não cabe).
- `work_claimed` (owner `oneshot-best-capability-8a2515d8`) → `execution_started` (attempt
  **60f8287b-942a-4d47-97a8-c7ca33b53f2a**) → `checkpoint_recorded` (worktree base `a55e3164`, resume
  checkpoint `cfc9761c0552`) → `result_submitted` → `work_claim_released` (`attempt_finished`).
- **Coder** (host_observed_coder_evidence): `backendId=openai:gpt-5.6-terra`, `nodeId=openai-api`,
  `placement=remote`, `providerCallCount=5`, `providerUsage`=16 099 tokens (in 12 375 / out 3 724 /
  cached 1 435). Coder OpenAI real, não Ollama.
- **Gate** (host_observed_gate_evidence): `npm.cmd run test --workspace=@anima/web -- scripts/prove-openai-strong-e2e.test.ts`
  → **outcome=passed, exitCode=0**.
- **Git** (host_observed_evidence): exatamente **2 arquivos** no escopo autorizado
  (`apps/web/scripts/prove-openai-strong-e2e.ts` + `.test.ts`); zero fora de escopo.
- **Verifier v2** (`work-verifier-v2`): **verdict=rejected** (ADVISORY — o item ainda chegou a `review`).
  15 checks, 0 gaps, 4 violations — **todas `criterion_covers_unknown_acceptance`**: são
  `validation_criteria` em PROSA da proposta sem `proof:{gate|scope}` mapeável, logo o Verifier não as
  confirma independentemente. Substantivo tudo OK: `gates_independently_observed`, `scope_respected`,
  `scope_criterion_covered`, `acceptance_criterion_covered` (gates passam / só 2 arquivos / impl intacta),
  `branch_ownership_verified`, `correlation_verified`, `status_coherent`. **Não é defeito do código nem da rota.**
- **Edição entregue (correta)**: `resolveTaskMessage` ganhou `continue;` no ramo `--message-file` e um
  `throw new Error('Argumento não suportado: ${argument}. Use somente --message ou --message-file.')` ao fim
  do laço (rejeita `--task`/`--task-file`/flags/posicionais); a const morta `DEFAULT_TASK_MESSAGE` foi
  **removida**; teste jest adicionado cobrindo os casos de rejeição. Diff em
  `anima-work/60f8287b-942a-4d47-97a8-c7ca33b53f2a` vs `cfc9761c0552`.

## Estado final

- Item **8a2515d8 = `review`** (propv2). Fronteira **HUMANA**: NÃO aceito/integrado/mergeado. Verifier
  advisory = rejected (motivo = critérios em prosa sem proof-type; o humano decide no review).
- **RunPod**: 0 Pods vivos (zero órfãos); esta rota NÃO tocou RunPod. Lease reconcile no arranque: tornDown 0.
- **Ledger OpenAI** (67c6a9cf): 1× `reserved` **US$1.00** (attempt 60f8287b); **sem `settled`** — coerente com
  a fronteira "OpenAI actual cost settlement" ainda não implementada (`pricing=null`; reserved ≠ settled;
  custo real ~poucos centavos por 16k tokens). Exposição = teto, não custo settled.

## Efeitos externos / segurança

- OpenAI: 5 chamadas reais a `gpt-5.6-terra` (coder), sob autoridade paga governada. Identidade residente
  (GoTrue→Bearer→RLS), NUNCA service_role. Nenhum segredo impresso. `origin/main` intacta. WIP preservado.
- **Mutações de ledger financeiro por SQL cru foram BLOQUEADAS pelo classificador** (fail-safe correto):
  (a) tentativa de setar `coder_backend=openai` no item — contornada roteando via Router (sem mutar o item);
  (b) `void` da reserva RunPod órfã — respeitado o bloqueio (ver abaixo).

## Barreira restante / próximo ponto de retomada

- **Fronteira humana**: revisar o item 8a2515d8 em `review` (Verifier advisory=rejected por critérios de prosa
  sem proof-type; o gate passou e a correção está correta e em escopo).
- **Reconciliação de ledger pendente (pré-existente, autoridade humana `3b87224f`)**: 1 reserva RunPod órfã
  **`2b931274-0883-40a0-8f5e-8ccbb95374cd`** (US$0,245; Pod já offline, activeDurationMs 0 ⇒ custo real ~0).
  Script canônico pronto: `apps/web/scripts/void-orphan-runpod-reservation.ts` (RPC append-only
  `void_paid_compute_budget_reservation`) — a EXECUÇÃO foi bloqueada pelo classificador (mutação de estado
  financeiro exige sign-off humano). Recomendado: humano rodar o script (ou autorizar) para liberar a exposição.
- **Recorte futuro (não reabrir sem aprovação)**: (i) tornar o caminho legado consistente — pular
  placement/burst quando `coder_backend='openai'` (espelhar `routedToOpenAI`); (ii) OpenAI actual cost
  settlement (derived ≠ settled); (iii) Verifier v2: `proof-type` para os `validation_criteria` em prosa.
