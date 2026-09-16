# 2026-09-10 — Cloud Resource Matching V1: fechamento da seleção tática + persistência da autoridade por capacidade (fronteira humana)

## Objetivo

Continuar o WIP incompleto de **Cloud Resource Matching V1**: fechar a seleção tática de recurso
GPU cloud self-hosted (A40 deixa de ser requisito), e resolver a barreira estrutural da
**autoridade paga por capacidade** (persistência/RPC/leitura), parando na fronteira humana sem
materializar autoridade nem gastar. Sessão autônoma com o usuário ausente.

## Estado Git

- Branch: `dev`. HEAD inicial **e final**: `d783a5d` (NENHUM commit criado — trabalho deixado como WIP).
- `origin/dev` = `4ab99ac` (dev local à frente por 24 commits; push RETIDO). `origin/main` = `main` = `99bec54` **INTACTA**.
- Nenhum push, merge, accept, integrate, deploy. Nenhum efeito externo (ver abaixo).

## Decisão de produto ratificada (reafirmada)

Dois níveis: (1) **ESTRATÉGIA de compute** (`local` × `cloud_self_hosted` × `third_party_api`) =
decisão HUMANA — o Anima MEDE/COMPARA e aguarda (`compute-strategy-decision.ts`, `decideComputeStrategy`).
(2) **RECURSO dentro da estratégia** = decisão do ANIMA — depois que o humano escolheu
`cloud_self_hosted`, o Anima seleciona sozinho a GPU concreta compatível dentro da autoridade+budget
(`cloud-resource-matching.ts`). **A40 não é requisito universal**; sua ausência não bloqueia se
houver outro recurso compatível.

## O que já estava PRONTO no WIP (herdado, NÃO recriado) e confirmado verde

Camada PURA + composição (todos com testes verdes — 56 testes core focais + 1615 no total):

- `packages/core/.../cloud-resource-requirements.ts` — requisitos por CAPACIDADE (não SKU). Piso de
  VRAM = `deriveMinimumVramGiB(18.8, 1.25)=24 GiB` (evidência Bobcat/qwen3-coder × margem operacional
  documentada; NÃO é "18.8" cru nem os 48 da A40).
- `packages/core/.../cloud-resource-matching.ts` — matcher determinístico: capacidade → autoridade
  (SKU-fixa | capability_bounds | any) → budget → ranking (menor custo → menor excesso de VRAM →
  disponibilidade → desempate estável). Fail-closed com razão precisa (`no_compatible_cloud_resource`,
  `all_exceed_budget`, `authority_scope_insufficient`, `provider_inventory_unavailable`).
- `packages/core/.../compute-strategy-decision.ts` — fronteira humana estratégica.
- `packages/core/.../paid-compute-authorization.ts` — escopo por capacidade aditivo
  (`CloudCapabilityScopeV1`; SKU-fixa XOR capacidade; `resource_capabilities` no request;
  denials `resource_capabilities_required|insufficient`). Avaliação fail-closed.
- `apps/web/.../runpod-price-quote.ts` — `readRunPodResourceInventory` (read-only) → candidatos
  NORMALIZADOS; `canonicalGpuResourceClass`. A40 indisponível vira candidato `unavailable` (não
  interrompe); cotação individual ausente pula e continua; credencial/rede fecham globalmente.
- `apps/web/.../cloud-resource-plan.ts` — `planCloudResourceProvisioning` (composição sem efeito:
  autoridade → escopo → inventário read-only injetável → matcher).

Matriz de testes exigida — TODA coberta: A40 disponível→seleciona; A40 indisponível+alternativa→
seleciona alternativa; múltiplas→ranking determinístico; VRAM insuficiente→rejeita; acima do
budget→rejeita; cotação individual indisponível→continua; inventory null→fail-closed;
autoridade SKU-fixa→alternativa NÃO autorizada; autoridade por capacidade→alternativa autorizada;
nuvem escolhida→sem fallback API; múltiplas estratégias sem decisão→human_decision_required; zero
provider write nos testes.

## O que ESTA sessão fez

### 1. Barreira estrutural da AUTORIDADE POR CAPACIDADE (Missão 4) — a fronteira humana

Diagnóstico: o contrato PURO já modelava `capabilityScope`, mas a **persistência não**: a tabela
`paid_compute_authorizations` só tinha `resource_class` (SKU-fixa), a RPC de concessão não aceitava
escopo, e `readActivePaidComputeAuthorization` **não projetava** `capability_scope`. Risco de
segurança: uma autoridade por capacidade (resource_class NULL) seria lida SEM limites e
`deriveAuthorityScope` a classificaria como `any_provider_resource` (qualquer GPU do provider).

- **Migração aditiva** `supabase/migrations/20260910000000_paid_compute_capability_scope.sql`:
  coluna `capability_scope jsonb`; CHECK de exclusividade (`resource_class` XOR `capability_scope`);
  CHECK de forma mínima (objeto com `minimumVramGiB>0`, `requiredGpuFeatures` array, `maxNodes` inteiro
  >0 — com `?&` para não cair na armadilha "CHECK com NULL passa"); RPC evoluída para 10º parâmetro
  OPCIONAL `capability_scope jsonb DEFAULT NULL` (retrocompatível — callers de 9 args seguem válidos),
  **preservando** a fonte robusta do papel JWT (20260903000001), o teto agregado obrigatório
  (20260831000002) e a correlação provider_api (20260904000000; provider_api NUNCA carrega escopo).
- **Verificação local sem efeito durável**: a migração foi aplicada dentro de uma transação
  `BEGIN…ROLLBACK` no Postgres local (docker `supabase_db_anima`). 6/6 asserts PASS (SKU-fixa aceita;
  capacidade aceita; ambas rejeitadas; malformado rejeitado; grant com 10 args; maxNodes fracionário
  rejeitado) e `capscope_column_after_rollback=0` confirma ZERO persistência. **A migração NÃO foi
  aplicada de forma durável** e os TIPOS NÃO foram regenerados (typegen clobberaria o WIP de
  `database.ts`/`p_attempt_id`).
- **pgTAP** `supabase/tests/paid_compute_capability_scope.test.sql` (plan 7) para a verificação
  apply-time do humano: grant por capacidade; persistência; SKU-fixa retrocompatível; exclusividade;
  forma mínima; provider_api recusa escopo; service_role recusado.
- **Leitura defensiva** `apps/web/.../paid-compute-authorization-store.ts`: extraído
  `projectStoredPaidComputeAuthorization(row)` PURO que projeta `capability_scope` opcionalmente
  (undefined→null antes da migração; comportamento idêntico). Fecha o risco de leitura ilimitada.
  +4 testes (11/11 no arquivo).

### 2. Relatório de seleção READ-ONLY (Missão 7 — Cloud GPU Test #2, evolução semântica)

- `apps/web/.../cloud-resource-plan.ts`: `describeCloudResourcePlan(plan, requirements)` PURO →
  `CloudResourceMatchReportV1` (requisitos, escopo da autoridade, candidatos considerados, rejeitados
  COM razão, escolhido {GPU, VRAM, preço, custo estimado, rationale} | blocker). +2 testes (5/5).
- `apps/web/scripts/preview-cloud-resource-match.ts` (OPERACIONAL, não commitar): PRÉVIA read-only da
  seleção sobre inventário RunPod vivo, sob autoridade por capacidade HIPOTÉTICA (em memória, NÃO
  materializada). Guard fail-closed sem API key. **Não executado ao vivo nesta sessão** (usuário
  ausente; evita chamada externa não supervisionada) — comando documentado abaixo.
- Correção incidental: o helper `inventory()` de `cloud-resource-plan.test.ts` usava um tipo
  condicional que resolvia para `never` (o arquivo NÃO compilava sob ts-jest). Trocado por
  `readonly CloudResourceCandidateV1[]`; o arquivo passou a compilar e rodar (5/5).

## Como a A40 deixou de ser requisito (resumo arquitetural)

- Requisito do workload é CAPACIDADE (`minimumVramGiB=24`, `cuda`), derivada de evidência, não SKU.
- Inventário do provider é lido como LISTA de candidatos normalizados; A40 indisponível é só mais um
  candidato `unavailable`.
- O matcher escolhe qualquer candidato que satisfaça capacidade+autoridade+budget, ranqueado por
  custo/excesso/disponibilidade/desempate.
- A autoridade SKU-fixa continua A40-apenas (segurança); **só** uma autoridade por capacidade —
  concedida pelo humano — libera alternativas. Por isso a persistência da autoridade por capacidade
  é a fronteira humana desta entrega.

## Provas / gates

- `packages/core`: **77 suites / 1615 testes PASS** (full).
- `apps/web` focais: `paid-compute-authorization-store` 11/11; `cloud-resource-plan` 5/5;
  `runpod-price-quote` 16/16.
- Migração 20260910000000: 6/6 asserts em transação ROLLBACK (zero persistência).
- `git diff --check`: só avisos CRLF (Windows), nenhum erro de whitespace.
- Typecheck web AMPLO: **NÃO roda** — barreira externa pré-existente (`database.ts`/`p_attempt_id`
  vs `autonomous-backlog-deps.ts:198`), NÃO tocada. ts-jest (isolatedModules) roda focal.

## Efeitos externos

Realizados: NENHUM gasto, NENHUM Pod, NENHUM provider write, NENHUMA autoridade materializada,
NENHUM accept/integrate/merge/publish/deploy, NENHUM push. Leitura ao vivo do RunPod: NÃO executada.
DB local: apenas transação ROLLBACK (nada persistiu; migração NÃO aplicada de forma durável).

## Fronteiras humanas (o que falta e exige o humano)

1. **Aplicar** a migração `20260910000000` (`supabase migration up`; NUNCA `db reset`) e **regenerar
   os tipos** (`supabase gen types typescript --local`) — a regeneração deve ocorrer DEPOIS de
   resolver o WIP de `database.ts`/`p_attempt_id`, para não clobberar. Rodar o pgTAP novo.
2. **Conceder** uma autoridade por capacidade real (ato humano) sob a estratégia `cloud_self_hosted`:
   `provider=runpod`, `work_item=<item>`, `max_nodes=1`, `max_total_cost=<teto>`,
   `capability_scope={minimumVramGiB:24, requiredGpuFeatures:['cuda'], maxHourlyPrice:<teto/h|null>, maxNodes:1}`
   — e NÃO `resource_class=gpu-a40-48gb`. (O wrapper de WRITE do store e a UI de concessão ainda
   passam só 9 args; evoluí-los é parte deste passo, com os tipos regenerados.)
3. **Tornar a API key RunPod Read/Write** (POST /pods) — barreira herdada; sem isso o E2E vivo para
   no provision.

## Próximo ponto EXATO de retomada

- **Wiring ao vivo (pós-fronteira)**: `apps/web/.../resident-on-demand-node.ts`,
  `prepareResidentOnDemandCoderNode`, hoje usa o caminho SKU-fixo `readRunPodLivePriceQuote`
  (barreira `live_price:quote_unavailable`). Seam de integração: quando a autoridade lida for por
  capacidade, inserir ANTES do bloco de preço (linhas ~204-220) uma etapa de seleção via
  `planCloudResourceProvisioning({requirements, authorization, leaseDurationMs, readInventory})`;
  o `chosen.candidate.resourceClass`/`perHour` passam a ser o `resourceClass`/`priceHint` efetivos
  do resto do fluxo (lookup de autoridade, lease, reserva, evidência, `provision`). Manter o caminho
  SKU-fixo idêntico como default (retrocompatível). Cobrir com testes (sem efeito). NÃO provisionar.
- **Prévia read-only** (quando o humano autorizar a leitura viva):
  `node --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local scripts/preview-cloud-resource-match.ts`
  (amplie o pool com `ANIMA_CLOUD_MATCH_GPU_TYPE_IDS` para demonstrar alternativas à A40).

## Invariantes reafirmadas

`necessidade ≠ gasto`; autoridade SKU-fixa NUNCA autoriza outra GPU; capability_scope é autoridade
DIFERENTE e mais ampla, concedida explicitamente; provider_api (chat GPT/coder OpenAI) ≠ estratégia
de compute ≠ autoridade paga (Missão 6 preservada — `autonomous-chat-selection` é seleção de work
item, não de provider); `reserved ≠ settled`; Bobcat/A40 preservados como HISTÓRICO.

---

## Continuação — wiring fechado até a fronteira de prova live (2026-09-10)

Branch/HEAD permaneceram `dev`/`d783a5d`; `origin/main` permaneceu `99bec54`. O WIP amplo foi
preservado, sem reset/stash/drop/commit/push.

- `p_attempt_id`: a RPC aceitava `NULL` semanticamente, mas o typegen representava parâmetro sem
  default como `string`. A migration pendente recriou a mesma RPC (todas as guardas preservadas)
  com `p_attempt_id uuid DEFAULT NULL` ao final; o caller pré-attempt agora omite o campo. O tipo
  gerado é `p_attempt_id?: string`.
- Migration `20260910000000` aplicada duravelmente via `supabase migration up` (única pendente),
  nunca reset. pgTAP capability scope: 7/7 PASS. Tipos regenerados via schema local após diff
  temporário; diff esperado apenas: coluna/Args capability scope e optional attempt id.
- Write path: `grantPaidComputeAuthorization` aceita/passa `capabilityScope`; read/list preservam o
  escopo. A RPC mantém SKU antiga, XOR, shape, provider_api e teto agregado.
- Wiring vivo: authority SKU-fixed conserva o fluxo antigo. Authority capability-based deriva os
  requisitos qwen3 (24 GiB/CUDA), lê inventário, planeja/rankeia, usa classe/preço escolhidos no
  gate/lease/reserva/evidência e entrega `gpuTypeId` concreto ao provisionador. O adapter RunPod
  restringe `gpuTypeIds` ao candidato escolhido. Sem fallback para API terceira.
- Provas focais: core 49/49; web 107/107; pgTAP 7/7. Preview externo foi somente GraphQL
  `gpuTypes`: pool diagnóstico SECURE encontrou A40 US$0,49/h (available), RTX A6000 US$0,53/h
  (limited), L40S US$1,09/h e A100 80GB PCIe US$1,59/h. Com teto US$0,50/h escolheu A40;
  `ANIMA_CLOUD_MATCH_GPU_TYPE_IDS` foi apenas override efêmero de diagnóstico.
- Efeitos explicitamente NÃO realizados: zero Pod, zero POST/DELETE provider, zero compute pago,
  zero authority real concedida/revogada, zero Resident Host, coder, accept, integrate, merge,
  publish ou deploy.

Fronteira humana exata: escolher `cloud_self_hosted` e conceder nova authority para o Work Item da
prova com `provider_id=runpod`, `node_id=NULL`, `resource_class=NULL`, `work_item_id=<id exato>`,
`max_duration_ms=1800000`, `max_cost_currency=USD`, `max_cost_amount=1.50`, janela curta e
`capability_scope={minimumVramGiB:24,requiredGpuFeatures:['cuda'],maxHourlyPrice:{currency:'USD',amount:0.55},maxNodes:1}`.
US$0,55/h é o teto recomendado pelo inventário observado: inclui A40 e A6000 como fallback, mas
exclui L40S/A100. Só depois desse ato humano executar uma única volta canônica supervisionada.
