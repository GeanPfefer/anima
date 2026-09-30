# Ollama Coder Error Observability V1

**Data:** 2026-09-30
**Tipo:** correção de observabilidade (desenvolvimento) + registro da prova TPC-01 que a motivou
**Branch:** `dev` · **HEAD inicial:** `f94bc5a` (`origin/main=99bec54`)

## Contexto: TPC-01 até a falha (mesmo dia, sem mudança de código)

- `25c2c047` (TPC-01) revisado v1 → v2 pelo fluxo canônico (planner local `qwen2.5-coder:14b`,
  num_ctx 16384, 3 rodadas, US$0): E1–E4 literais (E1/E2 da v1, E3/E4 das Aceites 3/4 do plano
  008), gate único `npm test --workspace=apps/web -- cli/args.test.ts`, limits 1/30,
  `required_fail_closed` e `canonical_provenance` TPC-01 preservados.
- Aprovação humana (`work_approved`, seq 83720) e classificação (`work_intelligence_classified`,
  seq 83721). Compute local: Router OFF, coder `ollama:qwen3-coder:latest` do contrato.
- 1ª host-turn (`runProjectBacklogHostTurn`, `requestedWorkItemId`, 1/1): Resource Governor
  `defer/moderate` (19% de RAM livre), 0 turnos. Retomada com 27% livres: `permit`.
- Attempt única `107997e2-ae41-469d-bbe0-c887658c7285`: a 1ª chamada `/api/chat` recebeu HTTP 500
  após 37,6 s, 0 tokens ⇒ `execution_failed [ollama_transport_error]`, item `failed`,
  `max_attempts=1` esgotado, branch da attempt sem diff. Zero OpenAI/RunPod/compute pago.

## Diagnóstico do HTTP 500 (1 probe direta, fora do harness)

Mesmas opções de load (`format:json`, `num_ctx 8192`, temperature 0), prompt trivial: HTTP 500
em 34,3 s com corpo
`llama-server process has terminated: exit status 0xc0000409 … CUDA error: shared object initialization failed`.
O log do `ollama serve` mostra o load COMPLETO (49/49 camadas, 13,1 GB na GPU + MoE no host,
KV 768 MiB, compute 249 MiB) e o crash no 1º kernel de flash-attention
(`ggml_cuda_flash_attn_ext_mma_f16_case` → `cudaFuncSetAttribute(MaxDynamicSharedMemorySize)`,
`fattn-mma-f16.cuh:1945`) ⇒ `GGML_ABORT` ⇒ `0xc0000409`. Sem mensagem de OOM/alocação; no
crash havia ~5 GB de commit e 843 MiB de VRAM livres. Classificação: **falha de runtime CUDA**
(não OOM provado). Delta vs agosto (o mesmo blob carregou dezenas de vezes): driver CUDA
13.3 → 13.4; Ollama 0.32.15 igual. Causa-raiz dentro do runtime (driver × kernel sm_120 ×
recurso no carregamento lazy do módulo) segue em aberto.

## Lacuna e correção

O diagnóstico só foi possível fora do harness: `callOllamaChat` (`ollama-protocol.ts`) lançava
`ollama_transport_error` com "o modelo Ollama respondeu 500." sem ler o corpo. O planner local
(`project-work-planner-local.ts`) já extraía `details.error`; o caminho do coder não.

- `OllamaProtocolError` ganha campos OPCIONAIS `httpStatus` e `providerError` (3º argumento
  opcional do construtor; callers existentes intactos).
- Resposta não-2xx: leitura fail-safe do corpo com teto de 2048 caracteres e 2 s; `{"error":"…"}`
  ou `{"error":{"message":"…"}}` ⇒ o texto do erro; senão o corpo cru; normalizado em uma linha,
  `redactSecrets`, truncado em 300 caracteres. Corpo ilegível/vazio ⇒ só `httpStatus`. A mensagem
  passa a ser `[ollama_transport_error] o modelo Ollama respondeu <status>: <erro>.`
- Nada do request (messages/prompt/headers) é lido ou guardado; timeout e exceção de transporte
  mantêm a semântica (sem `httpStatus`).
- `execution_failed.message` continua cortado em 120 caracteres (`worktree-executor.ts`), sem mudança.

## Fronteira contratual NÃO cruzada

O transcript host-observed (`CoderTranscript` v1, `ollama-transcript.ts`) NÃO foi alterado.
`validCoderTranscripts` (`packages/core/src/work-orchestration/coder-transcript.ts`) aceita só um
conjunto FECHADO de chaves (base + `runtimeEvents`, `commandObservations`) e
`parseHostObservedCoderEvidence` (`host-observed-coder-evidence.ts:198`) recusa o evento
(`invalid_correlation`) se houver chave desconhecida. Persistir `httpStatus`/`providerError` na
evidência `host_observed_coder_evidence` v1 exige evoluir esse contrato (campo opcional aditivo
no validador do core + `OllamaTranscript.failed`) — decisão humana pendente. Até lá o detalhe
completo vive no erro tipado; o evento persiste só o prefixo de 120 caracteres.

## Provas

- jest focal (`ollama-protocol`, `ollama-transcript`): 79/79, com casos novos para 500 com
  `{"error"}` CUDA, `{"error":{"message"}}`, corpo não-JSON, truncamento determinístico, corpo
  ilegível (text/stream que falham, corpo vazio), não-vazamento das messages + redação, e
  regressão de timeout/exceção; teste do coder confirma que o transcript v1 continua válido e
  sem chaves novas.
- jest relacionados (ollama*, worktree-executor, coder-evidence, project-work-planner-local):
  9 suítes, 312/312. typecheck web PASS; `git diff --check` PASS.
- Nenhuma chamada a modelo nesta correção; lineage TPC-01 inalterada (`failed`, 1 attempt,
  sem successor/recovery).

## Próximo ponto exato

Decisões humanas, em ordem: (1) evoluir ou não o contrato do transcript para persistir o
diagnóstico estruturado; (2) autorizar uma probe discriminadora com flash-attention desligado só
no processo `ollama serve` (mesmo modelo) ou investigar a regressão do driver 13.4; (3) só então
decidir recovery/successor do TPC-01.
