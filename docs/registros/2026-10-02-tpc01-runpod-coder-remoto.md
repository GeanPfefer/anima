# 2026-10-02 — TPC-01 com coder remoto RunPod (Goma = runtime/Supabase/event log)

Executor: Claude (único). Decisão humana de 2026-10-01: eliminar a Goma (16 GB RAM) como
variável de compute antes de qualquer compactação de contexto. Única variável alterada:
hardware do modelo (mesmo harness, mesmo `qwen3-coder:latest`, mesma governança).

## Antecedente

Attempt `0043c7f9` do successor `1f03dcca` (supervised, Goma, `num_ctx` 8192) terminou
`[ollama_context_budget_exceeded]` (prompt estimado 7306 > orçamento 6656) após 4 leituras de
`apps/web/cli/args.ts`, sem edit. RAM livre da Goma chegou a ~0,96 GB com Supabase no ar.

## Preparação (commit `a79fc0c`, dev = origin/dev; origin/main `99bec54` intocada)

Reuso do caminho RunPod canônico existente (`prepareCloudCoderNode` → Resilient Cloud Session →
`RunPodNodeProvisioner` com bootstrap endurecido → túnel SSH loopback → `remoteRuntimeFor`), com
três deltas mínimos:

1. `ANIMA_REMOTE_CODER_CONTEXT_LENGTH` — `num_ctx` do coder `locality: remote`, independente do
   knob local; default 8192; inválido falha fechado.
2. `ANIMA_ON_DEMAND_LEASE_MINUTES` — lease do node deixa de ser fixo em 30 min; efetivo =
   min(configurado, `authority.maxDurationMs`), valor único para matching/reserva/lease/
   deadline/settlement.
3. `coderNodePreflight` — verificação opcional do node pronto antes de `runSupervisorTurn`;
   reprovado ⇒ teardown + settlement e `coder_node_preflight_failed` sem attempt.

Gates: typecheck 4 workspaces; apps/web 155 suítes / 2157 testes; core 110 / 2355.

## Authority humana aprovada (2026-10-02)

Capability-based RunPod: CUDA, VRAM ≥ 48 GB, ≤ US$0,90/h, 1 node, lease ≤ 90 min, teto agregado
US$2,00, validade 24 h, vinculada ao novo successor. Preferência operacional: A40 → RTX A6000 →
outro SKU elegível. Attempt TPC-01 continua com `maxDurationMinutes` 30.

## Execução

Successor `4c0a8498-541c-4d50-ae3e-fcd1a3b778ab` (authorize_harness_fix_recovery de `1f03dcca`, lineage
`a68a0782`, fix `a79fc0c`), aprovado/preparado pela CLI oficial. Authority `91e1fac0` (capability-based,
≥48 GB/cuda/≤US$0,90/h/1 node/90 min/US$2,00/24 h) vinculada ao successor.

### Sessões de provisionamento (nenhuma attempt nas duas primeiras)

1. 01:38–01:48Z — 4 Pods (A40, A6000, L40, 6000 Ada): endpoint publicou e túnel abriu em todos; pull
   concluído; `health_lost` 5 s após o modelo pronto. Causa: `/api/chat` do health no teto de liveness
   de 5 s; o 1º chat carrega o modelo na VRAM. Fix `469460f` (teto próprio do chat, 180 s).
2. 01:54–02:03Z — 4 Pods, `health_lost` exatamente 30 s após o modelo pronto. Causa: o `fetchHttpClient`
   corta toda requisição em 30 s. Fix `f8433a4` (`timeoutMs` por requisição, só no probe de chat).
3. 02:07Z — Pod `y9d9kme57geufw` (A40 SECURE, US$0,49/h, 50 GB RAM, 9 vCPU): health OK (1º chat
   53,6 s, load 32,9 s). Preflight 32K: 18 661 tokens avaliados, JSON válido, modelo 22,2 GB 100% em
   VRAM, `context_length` 32768. Attempt criada só depois do preflight.

### Attempt `4fe72a55-3c3d-4c98-a0d9-9ec9b9f38e60`

02:11:01 → 02:12:43Z (coder 87 s). 33 chamadas `/api/chat`, todas HTTP 200, `num_ctx` 32768; prompt
2 932 → 16 071 tokens (orçamento 31 232). Transcript: 13 leituras servidas (12 em `cli/args.ts`, faixas
cada vez mais estreitas e repetidas, 1 em `cli/args.test.ts`) e 10 buscas; 0 edit, 0 exec, 0 submit.
Terminal `execution_failed` `[ollama_no_progress]` (4 rodadas consecutivas sem informação nova).
Diff vazio (branch na base `f94bc5a`); gates finais e Verifier não rodaram (sem candidato).

### Settlement e teardown

9 reservas, todas liquidadas por tempo (`estimated`); committed US$0,2464 de US$2,00 (o Pod da attempt:
US$0,0407). Teardown confirmado por evento canônico em todos os Pods; listagem RunPod ao fim: 0 Pods.

## Leitura

A troca de hardware removeu a barreira de memória: contexto real de 32K, modelo inteiro em VRAM,
prompt chegou a 16K sem estouro. O que restou é comportamento do modelo: explorou ~30 rodadas e não
convergiu para uma edição — a guarda de progresso do modo supervised encerrou de forma canônica.
Nenhum retry, nenhum novo successor. Próximo passo é decisão humana (ex.: prompt/estratégia de
convergência, compactação, outro modelo).
