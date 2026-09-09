# RunPod autoprovisionamento end-to-end — preparação completa e barreira única (API key)

Data: 2026-09-08
Tipo: continuação de desenvolvimento + preparação de prova viva (Cloud GPU Test #2)
Executor: Claude (assumindo a execução principal após o Codex atingir o limite)

`RUNPOD_AUTOPROVISION_END_TO_END = NOT_RUN` (bloqueado por barreira humana única: `ANIMA_RUNPOD_API_KEY`).

## Objetivo

Fechar o autoprovisionamento RunPod end-to-end (create → bootstrap → Ollama loopback →
qwen3-coder → túnel SSH Goma→Pod → health semântico → placement → coder → gate → Verifier →
review → release → destroy), limitado ao successor `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`,
com autoridade financeira humana de **teto absoluto USD 1.50 / 1 node / A40 48 GB**.

Diferença explícita frente ao marco anterior:
- **2026-08-24 (bobcat):** inferência remota MANUAL em Pod A40 já existente = **PASS**
  (`docs/registros/2026-08-24-execucao-canonica-no-remoto.md`). NÃO reimplementado.
- **2026-09-08 (esta prova):** ANIMA cria/derruba o Pod sozinho (autoprov + bootstrap +
  transporte + teardown). Estado atual: **NOT_RUN** — tudo pronto exceto a API key.

## Estado Git

- Branch `dev`; HEAD inicial da sessão: `1ea83a6` (RunPod bootstrap já commitado pelo handoff).
- `origin/main` = `99bec54` INTACTA; nenhum push/merge/deploy/integração.
- WIP externo amplo (cli/*, database.ts, docs, scripts de recovery) PRESERVADO — não tocado.

## O que já estava pronto (handoff, commit `1ea83a6`)

Adapter RunPod real (porta `NodeProvisioner`), bootstrap determinístico bounded (nvidia-smi →
sshd → ollama loopback → `/api/tags` → pull `qwen3-coder:latest` timeout 1800 s → `ollama show`),
Ollama só em `127.0.0.1:11434` (Pod publica só `22/tcp`), túnel SSH gerenciado pela Goma,
health semântico (`/api/tags` + `/api/chat` curto), preflight fail-closed, teardown/reconciler
de órfão sem túnel. Ver `docs/registros/2026-09-08-runpod-autoprovisionamento-barreira-pre-provider.md`.

## Trabalho desta sessão (local, no-spend)

1. **Fase 3 — SSH:** identidade histórica `anima-runpod-test` REUTILIZADA (não gerada nova):
   `~/.ssh/anima-runpod-test` (OpenSSH ED25519, fingerprint
   `SHA256:T+Xueu/+NoDgx8rqFL5w0kbD6oF1zq1T2kgSaQfj+4c`), `.pub` e `known_hosts_runpod_test`
   (já com `ssh.runpod.io`). Segredo NUNCA exibido. Túnel endurecido para identidade DEDICADA:
   `-o IdentitiesOnly=yes` em `runpod-ssh-tunnel.ts` (só a chave informada é ofertada).
2. **Fase 2/config — `apps/web/.env.local`** (git-ignored, não commitado): bloco NÃO-secreto
   preparado — `ANIMA_ON_DEMAND_NODE_ENABLED=true`, `_PROVISIONER=runpod`,
   `_NODE_ID=runpod-a40-test2`, `_BILLING_MODE=paid`, `_RESOURCE_CLASS=gpu-a40-48gb`,
   `_MAX_CONCURRENT_PAID_NODES=1`, `_FORCE_BURST=true`, `_PRICE_PER_HOUR=0.5`,
   `ANIMA_RUNPOD_IMAGE=ollama/ollama:latest`, `_GPU_TYPE_IDS="NVIDIA A40"`, `_CLOUD_TYPE=SECURE`,
   `_CONTAINER_DISK_GB=60`, `_POD_ENV_JSON={"OLLAMA_KEEP_ALIVE":"30m"}`, e os 3 paths SSH.
   A API key foi deixada apenas como linha COMENTADA para o humano preencher.
3. **Fase 5 — autoridade paga materializada** pelo mecanismo canônico (Bearer/GoTrue como
   identidade residente = dono `tecopfefer@gmail.com` `e570e43b…`; RPC SECURITY DEFINER
   `grant_paid_compute_authorization`; NUNCA service_role — a RPC o REVOGA):
   - `authorization_id = fd534be7-5b04-4e04-9079-b62a6762480f`
   - provider `runpod`, node `runpod-a40-test2`, class `gpu-a40-48gb`, item `8a2515d8…`
   - `max_duration_ms=1800000` (30 min = 1 lease), teto `USD 1.50`, janela 2026-09-08→2026-09-15.
   - Leitura pelo MESMO filtro de runtime (`readActivePaidComputeAuthorization`) → **casa**.
   - Ledger `paid_compute_budget_events`: **0** (nada reservado/gasto). `authorized ceiling ≠
     reserved exposure ≠ settled cost` preservado.
4. **Fase 6 — provas locais focais:** `runpod|paid-compute|resident-on-demand` = **12 suites,
   120 testes PASS**. Corrigida regressão preexistente do `1ea83a6`: o fixture de
   `paid-compute-lease-reconciler-deps.test.ts` não incluía as 3 vars SSH que
   `readRunPodProvisionerConfig` passou a exigir (alinhado; não é WIP externo).
5. **Preflight (loader do resident host, ambiente real):** `readyForHumanPaidAuthorization=false`,
   `missing=["api_key_present","human_paid_authorization"]`. Com a chave presente (fictícia só p/
   parsing) + esta autorização: `infraReady=true`, `paidExecutionAuthorized=true`, `missing=[]`.
   `readRunPodProvisionerConfig(real)==null` (fail-closed sem chave) confirmado.
6. **Driver da prova viva** `apps/web/scripts/prove-runpod-autoprov-8a2515d8.ts` (não commitado):
   dirige EXATAMENTE `8a2515d8` pelo burst RunPod, com guard fail-closed que aborta sem a API key
   (nunca cai em Ollama local). Executado agora → `BLOCKED_API_KEY_ABSENT` (zero gasto).

## Preço A40 e teto

A40 48 GB SECURE ≈ US$0,44–0,45/h (referência bobcat). Reserva conservadora = priceHint × lease
30 min = US$0,25 ≪ teto US$1,50; custo real esperado da prova (~1–5 min de compute) ≈ US$0,01–0,04.
A cotação VIVA (`runpod-price-quote.ts`, GraphQL) é autoritativa em runtime e valida ESTOQUE: se
A40 indisponível, retorna `quote_unavailable` → admissão negada (`live_price:quote_unavailable`),
i.e. o sistema PARA e não escolhe hardware mais caro silenciosamente (requisito atendido por design).

## Barreira humana ÚNICA e retomada exata

`ANIMA_RUNPOD_API_KEY` está AUSENTE do processo e de `apps/web/.env.local`. É o único bloqueio.

1. Humano adiciona 1 linha em `apps/web/.env.local` (NÃO commitar; RunPod console → Settings →
   API Keys): `ANIMA_RUNPOD_API_KEY=<segredo>`. NÃO colar a key em chat/log/DB.
2. `cd apps/web && node --experimental-transform-types --import ./scripts/ts-resolve.mjs \`
   `--env-file-if-exists=.env.local scripts/prove-runpod-autoprov-8a2515d8.ts`
   (Docker Desktop + `supabase start` no ar; reattach, NUNCA reset.)
3. A prova executa create → bootstrap → health → attempt real de `8a2515d8` → coder remoto →
   gate `npm run test --workspace=@anima/web -- scripts/prove-openai-strong-e2e.test.ts` →
   Verifier → `review`. PARAR em review (sem accept/integrate/merge/publish/deploy).
4. **Fase 11 obrigatória:** o lifecycle chama `finish` → release → shutdown_requested →
   destroy → shutdown_confirmed; confirmar no provider que o Pod NÃO está mais cobrando.

## Invariantes/limites preservados

Zero OpenAI, zero Anthropic, zero API proprietária de modelo. `origin/main` intacta. Sem push.
Sem service_role. Sem migrations novas nesta sessão. Barreira de RAM da Goma contornada pelo burst
remoto forçado (`ANIMA_ON_DEMAND_FORCE_BURST=true`) — o qwen3-coder 30B NÃO roda local.
Barreira de typecheck preexistente (`autonomous-backlog-deps.ts:198`, `p_attempt_id: null`) é WIP
externo, só atingível com Compute Router LIGADO (OFF por padrão): inerte em runtime; NÃO corrigida.

## Retomada 2026-09-09 (UTC) — API key presente; prova viva TENTADA; barreira = permissão de WRITE

A `ANIMA_RUNPOD_API_KEY` foi provisionada pelo humano na Goma (Windows User env + `.env.local`).
Valor NUNCA exibido/registrado.

- **Preflight reconciliado (sem divergência real):** `assessPaidComputePreflight` é checagem de
  INFRA PURA e NÃO lê o DB — `human_paid_authorization` só fica `ok` se o caller passar
  `humanAuthorizationValid`. O `verify-runpod-preflight.ts` roda sem esse flag ⇒ o item aparece em
  `missing`; NÃO significa autorização ausente. Prova pelo CAMINHO DE RUNTIME (Bearer do dono
  `e570e43b`): `readActivePaidComputeAuthorization` encontra `fd534be7` (matchesGranted=true),
  `evaluatePaidComputeAuthorization` → `authorized=true, requiresPayment=true, ref=fd534be7`,
  exposição reservada estimada US$0,25; preflight COM o flag real ⇒ `paidExecutionAuthorized=true,
  missing=[]`. Conclusão: SAME_AUTHORIZATION_PASSES_RUNTIME. Nenhuma nova autorização criada.
- **Fix de adapter (cotação viva):** o RunPod real devolve `availableGpuCounts: null` mesmo com
  estoque (`A40 SECURE stockStatus 'High'`); `runpod-price-quote.ts` rejeitava por exigir array.
  Corrigido para decidir disponibilidade pelo `stockStatus` quando `availableGpuCounts` é null;
  caso negativo (`None`/nulo) preservado. +1 teste. Suites `runpod|paid-compute|resident-on-demand`
  = 12/121 PASS.
- **RUNPOD_NEW_KEY_LIVE_READ = PASS:** chamada autenticada READ-ONLY (GraphQL gpuTypes) com a NOVA
  key: A40 (`id "NVIDIA A40"`, 48 GB) SECURE `stockStatus High`, `uninterruptablePrice US$0,49/h`.
  Exposição p/ lease 30 min = US$0,245 ≤ teto US$1,50. Chave autenticou; nunca impressa; US$0.
- **Prova viva TENTADA e PARADA na barreira (nenhum Pod, US$0):** o driver
  `prove-runpod-autoprov-8a2515d8.ts` chegou ao `provision` e falhou com `auth_invalid` ⇒ refusal
  `coder_node_unavailable`. Diagnóstico determinístico: `GET /pods` → **200** (read OK);
  `POST /pods` (corpo `{}`) → **403** (uma key com WRITE daria 400/422 por payload inválido; 403 =
  rejeitada antes disso). **Veredito: a nova key é READ-ONLY — sem permissão de WRITE (criar Pod).**
  Nenhum Pod criado (`GET /pods count=0` antes e depois). Zero gasto.
- **Ledger honesto:** a reserva `94d64828…` (US$0,25) criada ANTES do provision foi ESTORNADA com
  razão `provider_rejected_before_create` (provider chamado, 403, nenhum recurso criado). Auditoria:
  `reserved=0.25, voided=0.25, committed=0, remaining=1.50`.

`RUNPOD_AUTOPROVISION_END_TO_END = NOT_RUN` (barreira: a API key não tem permissão de WRITE/create).

### Barreira humana e retomada exata (Cloud GPU Test #2)
1. No RunPod (console → Settings → API Keys), tornar a key **Read/Write** (ou criar uma nova
   Read/Write; permissão de criar/gerenciar Pods). NÃO revogar ainda a `runpod-mcp` antiga — a nova
   key, sendo read-only, NÃO substitui a antiga para o autoprov. Persistir a nova em
   `apps/web/.env.local` (`ANIMA_RUNPOD_API_KEY=…`), sem colar em chat/log.
2. Revalidar write sem gasto: `node --experimental-transform-types --import ./scripts/ts-resolve.mjs`
   `--env-file-if-exists=.env.local scripts/probe-runpod-write-permission.ts` (esperado:
   `postPods_emptyBody_status` 400/422 ⇒ `KEY_HAS_WRITE…`).
3. Rodar `scripts/prove-runpod-autoprov-8a2515d8.ts` (guard fail-closed; autoridade fd534be7 válida,
   teto US$1,50, remaining US$1,50). Teardown obrigatório via `finish` + `runpod-pods-admin.ts destroy`.
