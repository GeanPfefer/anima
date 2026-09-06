# Fix estrutural do context cap do coder OpenAI + recovery do seq2 até review

- **Data/tipo:** 2026-09-06 — correção estrutural + prova viva paga até `review`.
- **Branch/HEAD:** `dev` de `799950f` → `7a30d53` (fix commitado). `origin/main` INTACTA em `99bec54`. `dev` permanece LOCAL (push retido — ver Fronteira).
- **Objetivo:** desacoplar o teto de contexto do coder OpenAI do default local do Ollama (8192) e, só depois de provar a correção, retomar o MESMO successor seq2 `01fdf66a` (sem seq3) até `review`.

## Causa e correção estrutural (commit `7a30d53`)

- `GptCoderBackend` reutiliza o protocolo READ→EDIT do `OllamaCoderBackend`, mas construía o delegate sem `operationalContextCap` → caía no default `8192` (teto de proteção da RAM/latência LOCAL, indevido para a API remota). Com reserva de saída 1536, o input caía em 6656; a retomada estimava ~7613 tokens ⇒ `ollama_context_budget_exceeded` ANTES de qualquer chamada.
- `resolveOpenAICoderContextCap(model, env)` (gpt-coder.ts): teto provider/model-aware, bounded e explícito — precedência `ANIMA_OPENAI_CODER_CONTEXT_CAP` (env) → mapa por-modelo → default conservador `128000`. Nunca herda 8192 nem cresce sem teto.
- `GptCoderBackend` passa cap + `outputReserveTokens`(16384) + `numPredict`(16384) ao delegate e expõe `contextBudget` (observabilidade). Ollama/local segue bounded em 8192; `resolveContextBudget` inalterada (`numCtx = min(declared, cap)`).
- **Reserva de saída real end-to-end:** `CoderProtocolTransportInput.maxOutputTokens` (a mesma reserva que o Ollama envia como `num_predict`) plumbada ao transport; a OpenAI passa a enviar `max_output_tokens`. `num_ctx`/`num_predict` NUNCA vão à OpenAI. Fail-closed preservado para prompts realmente grandes.
- **Categoria de erro:** mantida (`ollama_context_budget_exceeded` é do protocolo compartilhado). Nenhum rename amplo; com o fix, o backend OpenAI não mais dispara essa guarda para prompts normais.

## Gates e prova do patch

- Sweep coder/executor: **182/182 PASS** (gpt-coder, ollama-coder, ollama-protocol, ollama-anchor, ollama-transcript, executor-selection, coder-backend, coder-placement, deepseek-harness). Novos testes em `gpt-coder.test.ts`: cap não herda 8192; local mantém 6656; prompt acima do antigo limite e abaixo do novo é admitido e CHEGA ao fetch OpenAI; acima do novo budget continua rejeitado antes da chamada; `max_output_tokens` coerente; sem `num_ctx`/`num_predict` na OpenAI; declared < cap usa o menor.
- Typecheck do workspace web: os 3 arquivos do patch limpos. O único erro (`autonomous-backlog-deps.ts:198`) e os erros ao reverter `database.ts` são do TRABALHO NÃO COMMITADO da política supervisionada (database.ts/cli/anima.ts) — ruído externo, não regressão do patch. Commit inclui SÓ os 3 arquivos autossuficientes.

## Prova viva paga — recovery do seq2 até review

- Lineage preservada: predecessor `ce90eb14` = `failed` v2 (INTACTO); seq1 `81836dde` CANCELLED; seq2 `01fdf66a` reutilizado (sem seq3).
- Retomada canônica (`recover-ce90eb14.ts`, script operacional NÃO commitado): `propose_recovery_successor` idempotente (replay do seq2) → supervisão humana → **retry governado** (`failed→approved`, RETRY_READY) → classificação por lineage-walk → nova autoridade paga item/model-scoped (USD 0,25, janela ~32min). Diagnóstico COMPLETO e checkpoint `fbf17a8` preservados (prompt NÃO encurtado).
- Attempt bem-sucedido `34f15d29`: a guarda de contexto PASSOU (input budget 111616), o coder chamou a OpenAI de verdade e produziu o diff.
  - **Provider/modelo:** openai / gpt-5.6-terra (`openai:gpt-5.6-terra`, nodeId openai-api).
  - **Context budget efetivo:** cap 128000, input 111616, output reserve 16384.
  - **Uso real:** 5 chamadas; 13879 input + 3124 output = 17003 tokens.
  - **Gate:** `npm.cmd run test --workspace=@anima/web -- scripts/prove-openai-strong-e2e.test.ts` → PASS, exitCode 0 (10,4s).
  - **Verifier:** `verified` — 11 checks (7 attested, 4 independent), 0 gaps, 0 violations.
  - **Diff:** restrito EXATAMENTE aos 2 arquivos aprovados; usa `--message`/`--message-file` (não `--task`), `resolveTaskMessage(argv, readFile?)` exportada, ausência/vazio/leitura → Error. Observação p/ revisão humana: o coder reteve `DEFAULT_TASK_MESSAGE` como const morta (contrato satisfeito mesmo assim).
- **Custo:** reservado USD 0,25 (autoridade `c7885bd9`, reserva `30acc5d7`); **settled = null** (pricing não cabeada; `reserved ≠ settled`, uso real 17003 tokens não precificado). Reserva ÓRFÃ da tentativa num_ctx (`7052dcbc`, autoridade expirada) **VOIDED** por `provider_not_called` (canônico).

## Fronteira humana e próximo passo

- Item `01fdf66a` parou em **`review`**. NÃO aceito/integrado/mergeado/publicado/deployado. `origin/main` intacta.
- **Push de `dev` RETIDO:** empurraria ~11 commits locais para `origin/dev` num snapshot que OMITE o WIP não commitado da política supervisionada (database.ts/cli/anima.ts/migrations) e cujo working tree não é limpo no typecheck por causa desse mesmo WIP. Decisão humana: publicar `dev` (só o fix + arco) agora, ou commitar/resolver o WIP supervisionado antes.
- **Próximo passo executável:** revisão humana do resultado em `review` (aceitar via `anima work accept 01fdf66a` ou pedir mudanças). Scripts operacionais `recover-ce90eb14.ts` seguem não commitados.
