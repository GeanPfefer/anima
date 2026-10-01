# Harness do coder — SUPERVISED sem teto de rodadas de investigação

Data: 2026-10-01 (America/Sao_Paulo). Executor: Claude (único). Sem commit nesta sessão: WIP local para revisão humana.

HEAD = dev = origin/dev = `90cd081`. origin/main = `99bec54` (intocada). Nenhum fetch-mutação, push, merge, attempt, successor, chamada paga ou Ollama.

## Causa exata do `ollama_read_round_limit` (attempt `ddc6e410` do TPC-01)

1. `executor-selection.ts` construía `OllamaCoderBackend` sem política; o construtor resolvia o perfil local `LOCAL_AGENTIC_RUNTIME_PROFILE_V1` (8 leituras/rodada, **3 rodadas de investigação**, 40 leituras/sessão). O campo `mode: 'supervised'` existia na política, mas não alterava nenhum número.
2. O modelo fez 3 `search` servidas (rodadas 0–2) → `roundsLeft = 0`.
3. Em modo exec, cada nova busca/leitura virou `misdirect(...)`; na 5ª (`> MAX_MISDIRECTED_FEEDBACKS = 4`) `concludeOrFail` lançou `ollama_read_round_limit` porque `appliedTouched.size === 0` (sem edição). Exatamente a mensagem persistida ("ações desviadas em excesso após orçamento de leitura esgotado") e as 8 chamadas `/api/chat` (3 servidas + 4 reorientadas + 1 terminal).

Era um contador artificial; o modelo não estava em loop.

## Limites que existiam (antes)

| Limite | Valor local | Onde |
|---|---|---|
| `maxReadRounds` (investigação read/search/glob/exec pré-edit) | 3 | política core / `ollama-coder.ts` |
| `maxTotalServedReads` | 40 | idem |
| `readServingBudgetPerRound` (excedente deferido) | 8 | idem |
| Reserva pós-edit (exec) | 8 | `POST_EDIT_EXEC_ROUND_RESERVE` |
| `MAX_MISDIRECTED_FEEDBACKS` / `MAX_SUBMIT_FEEDBACKS` / `MAX_EDIT_FEEDBACKS` / `MAX_AMBIGUITY_FEEDBACKS` | 4/4/4/2 | `ollama-coder.ts` |
| `hardIterationCap` | soma dos acima + 8 | idem |
| `MAX_READS_REQUESTED_PER_ROUND` (guarda de abuso) | 64 | core |
| Timeout por chamada Ollama | 120 s | `ollama-coder.ts` |
| Janela `num_ctx` / orçamento de input | 8192 / 6656 | `resolveContextBudget` |
| Deadline global `maxDurationMinutes` | 30 min | **não aplicado em-processo ao coder** (só baseline/gates e lease no banco) |

## O que mudou

- **Política core** (`agentic-runtime-policy.ts`): `mode` passa a ser operante.
  - `autonomous` (default de quem não declara; inclui `DEFAULT_AGENTIC_RUNTIME_POLICY_V1`): números idênticos aos históricos (8/3/40, reserva 8); guarda de estagnação desligada.
  - `supervised` (só declarado): `maxReadRounds`, `maxTotalServedReads` e `postEditRoundReserve` = `Infinity` (sem contador); `maxStagnantRounds = 4` (guarda de progresso). Override explícito válido continua aplicado (só endurece); malformado cai no perfil bounded.
- **Coder** (`ollama-coder.ts`): sem política ⇒ `autonomous`. Novo **deadline global** (ver abaixo) checado no topo de cada rodada ⇒ `ollama_timeout`. Guarda de progresso: rodada produtiva é "nova" se serviu trecho inédito, busca/listagem com resultado inédito, comando inédito na revisão atual ou edição aplicada; 4 consecutivas sem novidade ⇒ `ollama_no_progress`. Ações inválidas continuam bounded nos dois modos (`nonProductiveIterationCap`). Em supervised o código `ollama_read_round_limit` não pode mais ocorrer (esgotamento ⇒ `ollama_no_progress`). Prompt supervisionado anuncia a regra real (sem "Infinity").
- **Deadline global**: `CoderEditRequest.deadlineAtMs`; `WorktreeExecutorAdapter` ancora em `início da attempt + maxDurationMinutes` (baseline, coder e reparo compartilham o relógio). Aplica-se nos dois modos.
- **Fiação do modo**: `resolveExecutorRoute({ coderRuntimeMode })` (só Ollama; default `autonomous`) ← `buildProjectBacklogCycleDeps(..., { coderRuntimeMode })` ← `runProjectBacklogHostTurn({ coderRuntimeMode })`, que **recusa `supervised` sem `requestedWorkItemId`**. Resident Host e rota HTTP `backlog-host-turn` não passam modo ⇒ autonomous. SUPERVISED é **só opt-in explícito de invocador interno**; a UI não o aciona (ver rodada 2).
- **OpenAI** (`gpt-coder.ts`): perfil forte passa a `mode: 'autonomous'` explicitamente — números idênticos; chamada paga nunca roda sem contadores.
- Novo código `ollama_no_progress` classificado como `no_progress` em `recovery-decision.ts` e `produce-change-operational-evidence.ts` (o regex do compute-router já casava).

## Rodada 2 — blockers da revisão read-only do Codex (mesmo dia, ainda sem commit)

1. **Deadline como autoridade temporal real.** Relógio único ancorado no início de `WorktreeExecutorAdapter.execute` (`attemptDeadlineAtMs`). Baseline: cada gate recebe `min(orçamento, restante)` e é omitido sem tempo (advisory). Coder inicial e repair: checagem antes de iniciar (topo do laço e após preparar a validação). Coder: antes de cada inferência e do reparo de schema checa o restante e limita o timeout a `min(timeoutMs, restante)`; depois de cada inferência revalida ANTES de agir (edição, submit, investigação); EXEC idem (`min(timeout da policy, restante)` + revalidação); `concludeApplied`/submit revalidam. Gates finais: checagem antes de cada gate, timeout `min(orçamento, restante)`, revalidação após os gates antes de repair/result. `callOllamaChat`: o timeout cobre o corpo (`response.json()` corre contra o abort).
2. **Timeout terminal estruturado.** No coder, deadline vencido ⇒ sempre `ollama_timeout` (nunca `submit_gate_unsatisfied`/`concludeApplied`; o catch de edição não o reclassifica). No executor, deadline vencido fora do coder ⇒ `[runner_timeout]` (classe `timeout` no recovery), `retryable: false`. Em ambos o candidato (se houver) é preservado como commit `anima(timeout-evidence)` na branch da attempt, citado na mensagem; não vira result nem handoff.
3. **Progresso em EXEC:** identidade = comando + revisão + exitCode + timedOut + sha(stdout/stderr normalizados por `normalizeVolatileOutput`, que remove durações e timestamps).
4. **Progresso negativo:** arquivo inexistente inédito conta como progresso (fingerprint caminho+resultado); busca sem resultado já era fingerprintada pela consulta. Recusa de policy/escopo continua sem contar.
5. **supervisor-turn:** fiação removida (ramo inalcançável após `409 resident_host_required`).
6. **Infinity:** permanece estritamente interno (a política não é serializada em lugar nenhum hoje). **Dívida:** antes de qualquer serialização/persistência da policy, trocar por representação explícita (ex.: `null` = sem contador), pois `JSON.stringify(Infinity)` vira `null`.
7. **num_ctx:** `ANIMA_LOCAL_CODER_CONTEXT_LENGTH` (inteiro decimal ≥ 1024; ausente ⇒ 8192; inválido ⇒ falha fechada `coder_backend_invalid`), só coder Ollama com `locality: local`; planner/OpenAI/remoto inalterados; reserva de saída e guardas de truncamento intactas.
8. **Achado extra (bug pré-existente):** no Windows os gates rodam com `shell: true` e `child.kill()` matava só o `cmd.exe`; o `node` neto segurava o pipe e o timeout de gate/exec não cortava nada. `runProcess` agora derruba a árvore (`taskkill /T /F`) e força o desfecho após 5 s de folga.

## Rodada 3 — blockers da revisão final do Codex (ainda sem commit)

1. **prepareValidation sob o deadline.** A preparação recebe `timeoutMs = restante`; `prepareAnimaValidation` usa `min(120 s, restante)` e não inicia com restante ≤ 0. Vale no baseline, antes do coder/repair e antes dos gates. Se o prazo vence durante a preparação, o catch emite `[runner_timeout]` (nunca "Falha ao preparar").
2. **Nenhum result depois do deadline.** Revalidação após o `worktree.commit()` final, antes do handoff e imediatamente antes do `kind:'result'`. Commit que atravessa o prazo fica só como evidência (SHA na mensagem); sem result ⇒ sem `result_submitted`, sem handoff, sem Verifier. Invariante: **depois de `deadlineAtMs`, nenhum caminho produz sucesso governado.**
3. **Deadline dentro de `writeChangeSet`.** Guarda `beforeEachWrite` chamada antes de CADA escrita, nos dois caminhos de edição (iterativo e R2/terminal). Vencido ⇒ `ollama_timeout`; nenhuma escrita nova. Escrita parcial anterior fica como evidência local.
4. **search/glob.** `GitWorktree.searchText`/`listFiles` aceitam opção HOST-side (`WorkspaceLookupHostOptions.timeoutMs`, fora do input do modelo) e usam `min(15 s, restante)`. O coder checa antes e revalida depois.
5. **`normalizeVolatileOutput` restrito** a telemetria do Jest: linha `Time:` iniciada por duração, sufixo `(N s|ms)` de linhas `PASS|FAIL` e de casos `✓|✕`. Timestamps e números com unidade em `Expected`/`Received`/diffs ficam intactos (substitui o item 3 da rodada 2).

Não-blockers mantidos documentados: fallback do `taskkill` quando ele termina non-zero (há só o desfecho forçado em 5 s); classificação do corpo HTTP não-2xx quando o prazo vence durante sua leitura (vira `ollama_transport_error`); `Infinity` interno; riscos da rodada 2.

## O que continua e por quê

Escopo de escrita/leitura governado; command policy (rede negada, git read-only); validate-before-submit (teste focal verde + git diff); gates autoritativos do host e Verifier; zero push/merge; authority paga; `gateRetryLimit` (1 reparo Ollama); `maxTurnsPerCycle × maxCycles`; guarda de abuso de 64 leituras/rodada; orçamento por rodada de 8 leituras (janela, excedente deferido); timeout por chamada; contadores de ações inválidas; janela `num_ctx`.

## Lacuna do baseline pré-coder — só documentada

O baseline diferencial é guardado em `differentialBaselines` (`worktree-executor.ts`) e só é anexado à evidência como `baseline` de um gate **pós-edição**. Se o coder falha antes de editar, os gates não rodam e o baseline se perde. Persistir um baseline sem gate candidato exige um shape novo em `HostObservedGateEvidenceV1` (hoje `gates[]` é consumido pelo Verifier e pela política diferencial) ou na observação do coder: mudança independente, não feita.

## Próxima barreira esperada (física, não artificial) — rodada 1

O prompt acumula todos os trechos servidos e é checado contra `num_ctx 8192` (input 6656). Com investigação sem teto, a próxima falha provável de uma investigação longa é `ollama_context_budget_exceeded`. Não há knob de `operationalContextCap` para o coder local; aumentar a janela (VRAM 16 GB, flash-attn off) é decisão humana separada.

## Provas

- `npm run typecheck`: verde nos 4 workspaces, exceto `apps/web/scripts/_session/tpc01-successor-execute-one-turn.ts` (scratch não versionado: `deadline` indefinido — o mesmo bug do invocador da attempt `ddc6e410`).
- core: 110 suítes / 2355 testes verdes.
- apps/web: suíte completa 154 suítes; sob carga 6 falhas, todas verdes isoladas exceto 1 regressão real (forma da chamada de `buildProjectBacklogCycleDeps`) corrigida e reverificada. Novos testes: reprodução da causa do TPC-01 em autonomous; a mesma investigação longa conclui em supervised; >40 leituras; estagnação por busca/leitura/comando repetido; ações inválidas bounded; deadline vencido e deadline no meio; validate-before-submit preservado; reserva pós-edit autonomous preservada; fiação do modo no executor e no host-turn; `deadlineAtMs` ancorado no início da attempt.

## Retomada

Revisão humana do WIP → commit → só então decidir o reteste (ver recomendação no relatório da sessão). Nenhum successor criado.
