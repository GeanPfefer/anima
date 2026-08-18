# 2026-08-18 — DeepSeek Harness: ligação viva (deps ratificadas, subprocesso confinado)

**Tipo:** desenvolvimento + prova.

**Objetivo:** tornar o candidato DeepSeek Harness **vivo** como `CoderBackend`, após Gean ratificar (recorte experimental controlado) a dependência `@deepseek-ai/dsh 0.1.0-rc.7` e uma capacidade estreita de `pwsh`/shell do Harness dentro do worktree isolado (envelope: `workspace-write`, rede off, sem `danger-full-access`, cwd-confinado, cancelável, runaway limitado por hook, fail-closed). Continua o registro [2026-08-18 (1º)](2026-08-18-deepseek-harness-coder-candidato.md) e o [design note](../arquitetura/deepseek-harness-coder-backend.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `4e6b2d8`. **HEAD final:** `f587d81` (3 commits; este registro é doc). **`main`:** `99bec54` = `origin/main`, **intacta, sem push** (11 ahead).

## Commits

- `793ff96` — Adicione a dependência ratificada do Harness e decida a arquitetura de subprocesso.
- `d9f60a1` — Encode a invocação verificada do subprocesso do Harness (plugin + planejador).
- `f587d81` — Implemente o driver real do HarnessRuntime por subprocesso confinado.

## Dependências adicionadas (pinadas, exatas, em `apps/web`)

`@deepseek-ai/dsh@0.1.0-rc.7` (CLI+profiles+runtime cordis), `@deepseek-ai/dsh-headless@0.1.0-rc.7` (profile one-shot), `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.7` (provider Ollama). Lockfile +~8k linhas. `npm audit fix` **NÃO** executado (evita upgrades oportunistas; 6 advisories high na árvore do dsh, contidos ao subprocesso experimental). **Nenhuma dep não relacionada tocada.**

## Arquitetura decidida

Harness roda como **PROCESSO FILHO confinado** no worktree (não embedding no servidor Next.js). O envelope ratificado É o sandbox de processo nativo do CLI. O binding **spawna** o `dsh` (não importa módulo TS), então tipa/testa sem dsh nem Ollama. Host permanece autoridade única (worktree, git observado, escopo, gates, cancelamento, Resource Governor, commit/handoff, Verifier, decisão de sucesso). `completed`/exit 0 **nunca** é sucesso.

## Mudanças (código versionado, verde)

- `harness/anima-harness-plugin.mjs` — plugin cordis (via `--patch`): temperature no waterfall `agent/request`; step budget no `agent/pre-step` → `agent.cancel({kind:'hook',reason:'step-budget-exhausted:N'})`. Forma **pública**, sem editar `node_modules`.
- `harness/harness-invocation.ts` (+test) — planejador PURO do comando/`--patch`/env verificado; envelope **fail-closed** (só `workspace-write`; caminhos absolutos; telemetria DISABLED; chave Ollama dummy; sem chave de nuvem).
- `harness/deepseek-harness-runtime.ts` (+test) — driver `HarnessRuntime` real por subprocesso (compõe tarefa com evidência do host no retry, spawna, cancela matando o filho, lê `turn/end` do log zstd com fallback nos sinais de processo). Pluga no `DeepSeekHarnessCoderBackend`.
- `deepseek-harness-coder.ts` — `onPreStep` do port vira **opcional** (é o mecanismo in-process; o subprocesso aplica o orçamento no plugin do filho).

## Provas / gates

- **Ao vivo** (scratch isolado, sem efeito externo): dsh **boota** headless (koffi + worker threads OK); **falha fechado** sem credencial/rede; Ollama `qwen3-coder`/`llama3.1:8b` disponíveis; rota pi-ai→Ollama **conecta e responde**; `--patch` **merge verificado**; **plugin local carrega** (bare-`insert` + `file://`) e `apply()` roda (marcador) registrando os hooks; sessões persistem em zstd JSONL (`turn/end` mapeia ao core).
- **Automatizado:** `apps/web` Jest **574/574** (51 suites; +11 planejador, +14 driver). `packages/core` **908/908**. `typecheck` **5/5**. Build web não rodado (lib pura + subprocesso; desproporcional).

## Bloqueio técnico honesto (não humano)

Execução viva **end-to-end** (modelo completa tarefa via ferramentas estruturadas) **não** conseguida: `qwen3-coder` **e** `llama3.1` emitem a tool call como **TEXTO** (`<function=…>`, `{"type":"function",…}`) em vez de `tool_calls` estruturados, mesmo com `temperature=0`. Reproduzido em **dois** modelos ⇒ lacuna de **integração de tool-protocol** (adaptador pi-ai `openai-completions` ↔ Ollama nesta versão/ambiente), **não** específica de modelo. Causa raiz **não** ratificada — próximo passo: inspecionar o payload HTTP real (o `dsh` envia `tools`? o Ollama devolve `tool_calls`? falta `compat`/tools-mode?). **Nada fingido como vivo.**

## Invariantes de segurança preservadas / autoridade concedida ao Harness

Autoridade **efetiva** concedida (envelope): escrever no worktree isolado (`workspace-write`), rodar ferramentas locais (incl. `pwsh`) confinadas ao cwd, sem rede (telemetria off + `approval: ask` auto-nega escalonamento + sem chave de nuvem), sem `danger-full-access`, cancelável (kill), runaway limitado (step budget via hook). **Fora do envelope falha fechada** (planejador recusa modo ≠ `workspace-write`). Host decide sucesso pelos gates; `completed` nunca é sucesso.

## Efeitos externos

**Nenhum** push/PR/merge/deploy/`integrated`/alteração de `origin/main`. Nenhuma credencial de nuvem usada. Instalação de pacotes = único acesso de rede (autorizado, deps declaradas). Provas vivas em scratch isolado (fora do repo).

## Worktrees / ambientes preservados

`.worktrees/mobile-completed-result`, `.worktrees/roadmap-003-006`, `G:\anima-local-test` — **preservados**. `.claude/settings.local.json`, `apps/web/.env.local` intactos. `.worktrees/` untracked, nunca estagiado.

## Fronteiras humanas restantes

Ampliar o envelope (rede, `danger-full-access`, execução fora do worktree) exigiria **nova** ratificação — não atravessar implicitamente. Ratificar (ou não) Harness como default, orçamento `12`, retry `1`, remoção universal de `str_replace_editor` permanece humano.

## Próximo ponto exato de retomada

1. **Crackear o tool-protocol** (bloqueio técnico atual): inspecionar o request HTTP `dsh`→Ollama `/v1/chat/completions` (via proxy de log local) — confirmar se `tools` é enviado e se o Ollama devolve `tool_calls`; testar `compat`/tools-mode/`DSH_TOOLS_MODE` do pi-ai. Só com o modelo usando ferramentas estruturadas há consumidor vivo verde.
2. Com consumidor vivo: **prova viva** num git worktree descartável (arquivo + gate do host) reproduzindo as propriedades do POC (completed≠sucesso; budget contém runaway observável; gate FAIL alimenta retry; host é autoridade; escopo confinado; cancelável).
3. **Laço de retry no host** (nova sessão + evidência observada do host, limitado, fail-closed) — extensão do `CoderBackend` + `WorktreeExecutorAdapter`.
4. **Registrar em `backendFor`** sob `coder_backend: "deepseek-harness"` (injetando as opções do driver), **não** default; prever no advisory (`declaredCoderBackendId`).
