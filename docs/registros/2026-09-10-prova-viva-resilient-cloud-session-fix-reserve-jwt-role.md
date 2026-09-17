# 2026-09-10 — Prova viva Resilient Cloud Session V1: fix da regressão de role no reserve + rotação/settlement ao vivo, barreira de endpoint/túnel RunPod

## Objetivo
Retomar a prova real consolidada da Resilient Cloud Session V1 para o item `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`, sob a authority por capacidade `3b87224f-071f-486d-88b8-a9dfe0259747` (RunPod, ≥24 GiB/cuda/≤US$1,00/h/1 node, teto US$1,50, `validUntil` 2026-09-17), estratégia CLOUD SELF-HOSTED, coder remoto Ollama `qwen3-coder:latest`, sem fallback OpenAI/Anthropic. GO humano permanente.

## Branch / HEAD
- Branch `dev`; HEAD inicial e final `d783a5d` (WIP não commitado preservado integralmente). `origin/main` `99bec54` intacta. Sem commits novos, sem stash, sem reset.

## Reconciliação read-only (zero-gasto) antes do primeiro provider write
- Git: dev @ d783a5d, WIP presente, `origin/main` intacta.
- Docker + Supabase local UP.
- Authority `3b87224f` ativa; escopo real = VRAM≥24/cuda/**maxHourlyPrice USD 1,00**/maxNodes 1; teto US$1,50; `validUntil` 2026-09-17; `revokedAt` null. Emenda 0,55→1,00 confirmada como evento append-only `hourly_limit_raised_to_usd_1` (migration `20260910000002`).
- Ledger inicial: committed **0,49** / remaining **1,01** (2 reservas históricas 0,245 não-voidadas/não-settled).
- Zero Pods RunPod existentes. Chave RunPod válida (auth OK); A40 com `quote_unavailable` transitório (estoque Low volátil), não estrutural.
- Migrations `20260910000000/000001/000002` aplicadas; RPC `settle_paid_compute_budget_reservation` presente.
- Catálogo live (46 SKUs): elegíveis ≤US$1,00/h/≥24 GiB disponíveis (A40 0,49; L4 0,49; RTX 3090 0,50; A6000 0,53; PRO 4000 0,57; PRO 4500 0,72; RTX 4090 0,74; RTX 5090 0,99).

## Bug encontrado e corrigido (necessidade técnica real, não reabertura de correção fechada)
- **Regressão de resolução de JWT role no ledger de settlement.** A migration `20260910000001` recompilou `reserve_paid_compute_budget`, `void_paid_compute_budget_reservation` e `settle_paid_compute_budget_reservation` usando a GUC plana legada `current_setting('request.jwt.claim.role', true)` — a mesma forma NÃO-robusta que `20260903000001` já corrigira. Neste deploy de PostgREST a GUC plana não é populada; só o JSON `request.jwt.claims`. Efeito: a identidade RESIDENTE (GoTrue→Bearer, role no JSON) recebia `42501` ('human-scoped resident identity required', mapeado para `forbidden`) ao reservar — a sessão resiliente parava em `terminal_failure: forbidden` ANTES de qualquer reserva (zero gasto). O pgTAP-como-owner não pega (roda com papel onde a checagem passa).
- **Fix:** migration aditiva **`20260910000003_fix_settlement_jwt_role_robust.sql`** recompila as três funções com corpos IDÊNTICOS à `000001`, trocando SOMENTE a linha `v_role` pela forma robusta `coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')` (mesma de `20260903000001`/`000002`). `CREATE OR REPLACE` preserva os GRANTs. Aplicada com `supabase migration up --local` (forward-only, sem reset). Assinaturas inalteradas ⇒ sem typegen.
- Prova zero-gasto do fix: `reserve` com `estimate_amount=-1` passou a retornar `22023 invalid_input` (role OK) em vez de `42501 forbidden`; nenhuma linha criada.

## Prova viva (com gasto, dentro do envelope)
Pool de inventário ampliado por export de shell (`ANIMA_RUNPOD_GPU_TYPE_IDS`, sem editar `.env.local`) para GPUs adequadas ≥24 GiB/cuda/≤US$1,00/h (curadoria de operador dentro da estratégia; L4 e o slice MIG excluídos por inadequação a 30B). Teto de matching vem da authority (1,00/h); preço da reserva vem da cotação viva do candidato.

Driver `prove-runpod-autoprov-8a2515d8.ts` (Router OFF, `ANIMA_RESILIENT_CLOUD_SESSION=true`, `MAX_ATTEMPTS_PER_PLACEMENT=2`, `MAX_PROVISION_ATTEMPTS=16`):
- Matcher escolheu **A40 @ US$0,49** (mais barata do pool curado).
- **Attempt 1** (Pod `3q3ylg21mawaes`, A40): RUNNING sem `publicIp/port22` por 600136ms (deadline **600000ms**) → `endpoint_unpublished` (recuperável) → **settle + teardown**. Custo liquidado S₁≈**US$0,0823** (~604s), excesso 0,1627 liberado.
- **Attempt 2** (Pod `4rag1i9ly4ick4`, A40): endpoint publicou brevemente (`69.30.85.9:22132`) mas o mapping oscilou/sumiu → `runpod_tunnel_open_failed phase=mapping_absent` (~183831ms, 32 probes) → adapter traduz `openTunnel=null` para **`provider_unreachable`** → `classifyCloudProvisionFailure` = `halt_provider_unavailable` → **HALT sem martelar**. Settle + teardown; S₂≈**US$0,0445** (~327s), excesso 0,2005 liberado.
- **Terminal canônico:** `coder_node_unavailable` / `[cloud_session:provider_unavailable] provider_unreachable`. Turno `selection_not_executable`; work item NÃO reivindicado (`claimId/attemptId` null) — estado prévio preservado.

Invariantes observados AO VIVO: 1 Pod por vez; teardown ANTES do próximo create; troca de máquina autônoma dentro do envelope; **settlement por tempo real** (reserva conservadora 0,245 → custo efetivo por segundos, excesso liberado); budget agregado bounded pela authority; zero órfãos.

## Ledger final
- committed **0,6168** / remaining **0,8832**; reserved Σ 0,98; voided 0; settled liberado Σ 0,3632.
- **Gasto real novo desta sessão = US$0,1268** (0,0823 + 0,0445). Reservas novas `bc2a1116` (attempt1) e `b7d14a37` (attempt2), ambas liquidadas. As 2 históricas seguem abertas (não retro-settled).
- Zero Pods RunPod ao fim.

## Barreira (fronteira humana) — NÃO reaberta autonomamente
A publicação/estabilidade de endpoint+túnel SSH das máquinas RunPod **SECURE** desta conta é a barreira remanescente (mesma de `2026-09-10-runpod-readiness-camadas-...`): máquina A40 #1 nunca publicou em 10 min; máquina A40 #2 publicou e oscilou. O adapter classifica `openTunnel=null` (após o Pod existir e a REST responder) como `provider_unreachable` **global** → HALT, impedindo o fallback para os outros candidatos elegíveis (RTX 3090/A6000/PRO 4000/PRO 4500/4090/5090). Como o prompt lista "provider_unreachable global → HALT sem martelar" como correto e proíbe reabrir correções fechadas sem aprovação, a reclassificação de `tunnel_open_failed`-com-Pod-criado como recuperável-por-placement (para permitir rotação de SKU, alinhado a "permita fallback para outra GPU elegível") fica como **recomendação para decisão humana/Codex**, não aplicada aqui.

## Próximo ponto exato de retomada
1. Decisão humana/Codex sobre a classificação: `openTunnel=null` com Pod criado + REST alcançável ⇒ tratar como `endpoint_unpublished`/recuperável-por-placement (rotaciona SKU) em vez de `provider_unreachable` global (HALT). Seams: `apps/web/lib/work-orchestration/runpod-node-provisioner.ts:401` e `packages/core/src/work-orchestration/cloud-session.ts` (`RECOVERABLE_PLACEMENT` × `PROVIDER_UNAVAILABLE`). Requer atualizar `cloud-session.test.ts`/`runpod-node-provisioner.test.ts`.
2. Alternativa/independente: investigar por que a conta RunPod SECURE não publica/estabiliza endpoint TCP/22 (config de porta pública, `supportPublicIp`, COMMUNITY vs SECURE).
3. Re-executar `prove-runpod-autoprov-8a2515d8.ts` com o pool ampliado (export de shell) após (1)/(2). Budget remanescente US$0,8832 sob a mesma authority (`validUntil` 2026-09-17).

## Efeitos externos
- Realizados: 2 Pods RunPod A40 criados e derrubados (settled US$0,1268 total); migration `000003` aplicada ao DB LOCAL.
- Explicitamente NÃO realizados: nenhum commit/push; `origin/main` intacta; WIP não tocado; `.env.local` não editado; nenhuma reserva histórica retro-settled; nenhum fallback OpenAI/Anthropic; nenhum código de classificação fechado alterado.
