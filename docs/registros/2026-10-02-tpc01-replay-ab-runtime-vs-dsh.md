# TPC-01 — replay A/B não-governado: runtime próprio × DeepSeek Harness

Data: 2026-10-02 (America/Sao_Paulo). Tipo: prova. Executor principal único: Claude.

## Mandato e estado

Replay técnico descartável do MESMO TPC-01 com `qwen3-coder:latest`:
A = `OllamaCoderBackend` (supervised) × B = `createNodeDeepSeekHarnessBackend`
(perfil integrado em `executor-selection.ts`). Referências:
[backlog TPC-01](../planos/008-primeira-prova-trusted-produce-change-backlog.md),
[ADR DSH](../arquitetura/deepseek-harness-coder-backend.md),
[A/B anterior](2026-10-01-tpc01-ab-modelo-qwen25.md).

HEAD inicial/final = dev = origin/dev = `f8433a4`; origin/main = `99bec54` (intocada,
conferido por `git ls-remote`). Zero commits/push/merge, zero Supabase/event log,
successor, attempt, authority, Work, OpenAI ou RunPod. Tracked files intocados
(hashes PRD `4fe90a12…` e backlog `c7049ae5…` iguais aos do registro anterior).

## Fidelidade

- Mesmo `request.json` exportado (sha256 `cdfd83a2…`), `buildExecutorRequest`,
  base `f94bc5a`, `WorktreeExecutorAdapter`, `prepareAnimaValidation`, gate focal
  `npm test --workspace=apps/web -- cli/args.test.ts`, deadline 30 min,
  `gateRetryLimit` 1 (idêntico para `ollama` e `deepseek-harness`), temperature 0.
- Controle A REUTILIZADO: `.tmp/tpc01-model-ab/previous/arm-A-*` rodou em
  2026-10-02T02:31Z, já sobre `f8433a4` (ollama-coder.ts inalterado desde `d5a0b4f`),
  mesmo request; primeira mensagem idêntica byte a byte (registro anterior).
- Braço B: scratch novo `apps/web/scripts/_session/probe/tpc01-dsh-probe.ts`.
  `emitCheckpoint=false`; `GitWorktree.commit` interceptado (commit final e
  timeout-evidence recusados); backend embrulhado só para fotografar diff/status.
  Perfil DSH integrado sem ajuste: stepBudget 12, catálogo focado
  (edit/glob/grep/pwsh/read/read_image/write), `agent-instructions`, web, skills,
  subagentes, workflows desabilitados, idle timeout 180 s, sem retry de TIMEOUT.

## Contexto efetivo

A pede `num_ctx 16384` explicitamente. B usa `/v1/chat/completions` (não envia
num_ctx) e anuncia `contextWindow: 262144` ao DSH. Ollama 0.32.15 sem config usaria
`default_num_ctx=4096` (log: "vram-based default context"). Igualado só por config
operacional: `ollama serve` com `OLLAMA_CONTEXT_LENGTH=16384`,
`OLLAMA_FLASH_ATTENTION=0`. Validado: `/api/ps context_length=16384`, runner
`n_ctx = 16384`, 49/49 camadas, 14,8/21,3 GB em VRAM. Docker/Supabase parados
durante o probe.

## Resultado lado a lado

| | A runtime próprio | B DSH |
|---|---|---|
| Modelo | qwen3-coder:latest Q4_K_M | idem (digest `06c1097e…`) |
| Contexto efetivo | 16384 (num_ctx) | 16384 (OLLAMA_CONTEXT_LENGTH); DSH crê 262144 |
| Duração coder | 83 s | 356 s |
| Inferências | 20 | 8 (1 título + 7 passos; a 7ª cancelada) |
| READ / SEARCH | 6 / 14 | 2 / 0 (grep/glob 0) |
| EDIT tentado / aplicado | 0 / 0 | 4 / 0 (todos `old_string and new_string must differ`) |
| WRITE / EXEC | 0 / 0 | 0 / 0 |
| 1ª EDIT | nunca | tentativa no passo 3; nenhuma aplicada |
| Diff / scope | vazio / — | vazio, status limpo, branch em `f94bc5a` / sem violação |
| Gate focal | não executado | não executado |
| Termination | `ollama_no_progress` | `turn/end error TIMEOUT: pi-ai stream idle timeout after 180000ms` ⇒ `execution_failed` retryable (sem repair) |
| Tokens | pico prompt 11490 | n_tokens 3479→9952→13244→13638→14036→14408; passo 7 = 14478 + ~3,8k gerados |

Trajetória B: read args.ts (20,8 KB inteiro), read args.test.ts, 4× edit no-op
(o detector de repetição do DSH injetou aviso), passo 7: texto "vou criar um teste…"
e depois ~3,8k tokens gerados a 21,5 t/s sem nenhum chunk no stream; context shift no
runner (n_discard 8189, `truncated = 1`) e cancelamento pelo idle timeout. O conteúdo
dessa geração não é observável (compatível com tool call bufferizada pelo parser do
Ollama — não verificado). Step budget 12 não alcançado.

Achado semântico: o modelo declarou explicitamente que entendia a tarefa como
"aceitar `--reason ignorado` como valor válido" — o inverso do aceite. Nenhum braço
recebe os aceites (`validationCriteria[].covers`): o coder vê só o título. A recebe
ainda manifesto do escopo e comandos de validação; `composeHarnessTask` do DSH não
recebe nem esses.

## Conclusão limitada (n=1, temperature 0)

DSH NÃO fez o qwen3 editar o TPC-01. O loop DSH levou o modelo a tentar EDIT cedo
(A nunca tentou), mas as edições eram no-op e a sessão terminou em stall de runtime.
O resultado não sustenta o runtime próprio como causa principal do no_progress;
aponta como causas candidatas comuns a especificação que chega ao coder (sem aceites,
título ambíguo) e o limite do modelo local. Barreiras concretas para promover DSH:
contextWindow anunciado 262144 × efetivo (4096 sem config; DSH não compacta e o
runner faz context shift silencioso); stall do stream do Ollama em geração longa
vira erro terminal sem recuperação; tarefa composta sem comandos de validação nem
aceites; deadline só verificado depois do turno; stepBudget 12 não ratificado.

## Evidência

`.tmp/tpc01-dsh-ab/`: `B/arm-B-events.jsonl`, `B/arm-B-request.json`,
`B/arm-B-turn0-edit-request.json`, `B/arm-B-turn0-after-error.diff` (vazio),
`B/final.diff` (vazio), `ollama-request-logs/` (8 bodies HTTP completos),
`dsh-home/` (patch + session.jsonl.zstd) e `dsh-session.jsonl` descomprimido,
`ollama-stderr.log`/`stdout.log`. Controle A: `.tmp/tpc01-model-ab/previous/`.

## Cleanup

Worktree `.worktrees/anima-wt-ftBIY3` removida pelo adapter; branch
`anima-probe/probe-B-dsh-1790912437864` (em `f94bc5a`, zero commits) excluída.
Modelo descarregado (`done_reason=unload`), Ollama parado. Docker religado,
`supabase start` sem db reset/migration; db `accepting connections`, auth health 200,
demais healthy; `supabase_vector_anima` reiniciando (ressalva já conhecida).

Retomada: decisão humana. Nada implementado depois do probe.
