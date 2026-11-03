# TPC-01 — replay A/B não-governado pós-CoderTaskSpecV1

Data: 2026-10-02 (America/Sao_Paulo). Tipo: prova. Executor principal único: Claude.

## Mandato e estado

Repetir o A/B técnico do [replay anterior](2026-10-02-tpc01-replay-ab-runtime-vs-dsh.md)
agora que o coder recebe a especificação aprovada completa (`6eb2dee`, CoderTaskSpecV1).
A = `OllamaCoderBackend` (supervised) × B = `createNodeDeepSeekHarnessBackend` (perfil integrado).

HEAD inicial/final = dev = origin/dev = `6eb2dee`; origin/main = `99bec54` (intocada).
Zero commits/push, zero código rastreado alterado, zero Supabase/event log, successor,
attempt, authority, OpenAI ou RunPod.

## Setup

- Request exportado `.tmp/tpc01-model-ab/request.json` (sha256 `cdfd83a2…`), `buildExecutorRequest`,
  base `f94bc5a`, `WorktreeExecutorAdapter` + `prepareAnimaValidation`, gate focal
  `npm test --workspace=apps/web -- cli/args.test.ts`, deadline 30 min, `gateRetryLimit` 1, temperature 0.
- Probe scratch novo `apps/web/scripts/_session/probe/tpc01-specab-probe.ts` (+ `tpc01-specab-fidelity.ts`):
  `emitCheckpoint=false`, `GitWorktree.commit` interceptado (commit final e timeout-evidence recusados),
  fetch in-process restrito a 127.0.0.1:11434, diff/status capturados antes do dispose.
- `ollama serve` 0.32.15 com `OLLAMA_CONTEXT_LENGTH=16384`, `OLLAMA_FLASH_ATTENTION=0`,
  `OLLAMA_DEBUG_LOG_REQUESTS=true`, `OLLAMA_HOST=127.0.0.1:11434`. `/api/ps` `context_length 16384`;
  runner `n_ctx = 16384`, mesmo runner para A e B (digest `06c1097e…`, 14,8 GB VRAM).
  Docker/Supabase parados durante o probe (`supabase stop`, sem reset).

## Fidelidade (preflight antes de qualquer inferência)

Preflight gera o payload exato de cada braço com fetch/runtime de captura e falha fechado.
Ambos 14/14: taskSpec, seção verbatim, E1–E4, includes, excludes, risco, `cobre: E1, E2, E3, E4`,
`claimKind: substantive`, `required_fail_closed`, gate focal. Confirmado também no tráfego real:
A — a 1ª chamada `/api/chat` contém a seção (2214 chars) verbatim; B — o 1º passo do agente
(`/v1/chat/completions`, request log do Ollama) contém a tarefa composta inteira verbatim.

## Resultado lado a lado

| | A runtime próprio | B DSH |
|---|---|---|
| CoderTaskSpec completa | sim (14/14 + tráfego real) | sim (14/14 + tráfego real) |
| Contexto efetivo | 16384 (num_ctx); pico prompt 11289 | 16384; input 4094 / 4143 (DSH anuncia 262144) |
| Duração coder | 61,5 s (total 73,9 s) | 32,4 s + 9,2 s (total 55,3 s) |
| Inferências | 9 | 3 (1 título + 1 passo por turno) |
| READ / SEARCH | 9 / 0 | 0 / 0 executadas |
| EDIT tentada / aplicada | 0 / 0 | 0 / 0 |
| EXEC / SUBMIT | 0 / 0 | 0 |
| Diff | vazio | vazio |
| Aceites satisfeitos | não | não |
| Gate focal pós-coder | não executado | não executado |
| Termination | `[ollama_no_progress]` (4 rodadas sem informação nova) ⇒ `execution_failed`, sem repair | turno 0 `completed-unverified` sem mudança ⇒ repair `no-change` ⇒ idem ⇒ `O backend não produziu nenhuma alteração para revisão.` |

Trajetória A: leituras de `args.ts` 1–60, 50–120, 100–150, 150–250, `args.test.ts` 1–111,
e depois a MESMA leitura `args.ts` 150–210 quatro vezes seguidas; o guarda de progresso encerrou.

Trajetória B: nos dois turnos o modelo respondeu com texto + chamada de ferramenta no formato
XML nativo do qwen3-coder SEM a tag de abertura (`<function=read><parameter=file_path>
apps/web/cli/args.ts…</function></tool_call>`). O `/v1` do Ollama não converteu em `tool_calls`;
o DSH recebeu só texto, `finish stop` e fechou `turn/end completed`. Nenhuma ferramenta executou.
O texto do modelo mostra a leitura CORRETA da tarefa ("recusar IDs extras e --reason ignorados"),
ao contrário do replay anterior (que entendia o inverso do aceite).

## Conclusão limitada (n=1, temperature 0)

Com a especificação completa nenhum braço editou e nenhum resolveu o TPC-01. A falha de A é de
comportamento do modelo dentro de um runtime que funcionou como projetado (leitura repetida →
guarda `no_progress`). A falha de B é de protocolo/runtime: tool call malformada emitida como texto
e aceita como conclusão do turno — o modelo nem chegou a ler o arquivo. A evidência não sustenta
promover DSH como baseline funcional nem conclui contra o runtime próprio.

## Evidência

`.tmp/tpc01-specab/`: `A/` (events, calls com messages/respostas brutas, transcript, request,
edit-request, preflight payload, diffs), `B/` (events, request, edit-requests, preflight payloads,
diffs, `api-ps-during-B.json`, DSH_HOME de cada turno + `*.session.jsonl` decodificados frame a frame),
`ollama-request-logs/` (bodies HTTP de A e B), `ollama-stderr.log`/`stdout.log`, `*-stdout.log`.

## Cleanup

Worktrees removidas pelo adapter; branches `anima-probe/probe-specab-{A,B}-*` (em `f94bc5a`,
zero commits) excluídas. Modelo descarregado (`done_reason=unload`), Ollama parado. Docker religado,
`supabase start` (sem db reset/migration): db `accepting connections`, auth health 200, demais healthy;
`supabase_vector_anima` reiniciando (ressalva conhecida).

Retomada: decisão humana. Nada implementado depois do probe.
