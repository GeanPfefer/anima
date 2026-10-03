# Akita Baseline V1 — Codex CLI como CoderBackend

Status: **incremento 1 implementado, sem uso real** (2026-10-02). Base: `dev` `6eb2dee`.

## Decisão de direção

- O primeiro executor externo de código é o **Codex CLI** (`codex exec`), usando o **harness
  nativo** dele para READ/SEARCH/EDIT/EXEC, contexto e tool calls.
- O ANIMA **não** evolui o próprio coding-agent loop. Ficam **estacionados/experimentais**
  (nada apagado): Ollama READ fidelity, convergência/prompt tuning Qwen, parser/tool-call do
  DeepSeek Harness, coder RunPod, compactação de contexto própria, tuning de `no_progress`.
- O ANIMA mantém a **governança host-side**: worktree isolada a partir do SHA autorizado, git
  observado, escopo (`contract_violation`), gates, checkpoint/handoff e Verifier.

## Forma

`WorkExecutorRequest → WorktreeExecutorAdapter → CodexCliCoderBackend → codex exec (cwd = worktree)
→ controle volta → host observa git/diff → escopo → gates → resultado revisável.`

- Código: `apps/web/lib/work-orchestration/codex-cli-coder.ts`; seleção em `executor-selection.ts`
  (`coder_backend: 'codex-cli'`). Default de deploy **inalterado** (`ollama`).
- Instrução = `renderCoderTaskSection` (mesma seção canônica dos outros backends) + regras
  operacionais (só a worktree, respeitar include/exclude, sem commit/push/merge, validação é do host).
- Lançamento sem shell: `<exe> exec --sandbox workspace-write -c approval_policy=never --cd <worktree>
  [--model M] [--profile P] <instrução>`. Instrução > 24 000 chars ⇒ falha fechada (limite de linha
  de comando do Windows); stdin fica para quando houver necessidade concreta.
- Ambiente do filho por **allowlist** (sistema, PATH, temp, perfil do usuário, `CODEX_HOME`,
  locale, proxy/CA). Fora: `OPENAI_API_KEY` (cobraria API em vez da assinatura), Supabase,
  segredos do ANIMA.
- Exit 0 = "turno terminou", nunca gate aprovado; exit ≠ 0 falha fechado com diagnóstico
  sanitizado/limitado; deadline global ⇒ `[runner_timeout]` (o executor preserva o candidato);
  cancelamento derruba a árvore do processo.
- Config do operador: `ANIMA_CODEX_CLI_PATH` (default `codex` via PATH; wrappers `.cmd/.bat/.ps1`
  recusados), `ANIMA_CODEX_CLI_MODEL` (ausente ⇒ `default` = modelo do config do Codex),
  `ANIMA_CODEX_CLI_PROFILE`.

## Fora deste incremento

Resume do Codex, ClaudeCodeCoderBackend, settlement de assinatura, UI, mudanças no Verifier,
retry interno de gate para `codex-cli` (0) e **qualquer execução real** — a primeira prova real
com assinatura é decisão humana separada.

## Incremento 2 — Claude Code como segundo executor nativo

Status: **implementado na branch `claude/claude-code-coder-backend`, sem uso real** (2026-10-02).

- Código: `apps/web/lib/work-orchestration/claude-code-coder.ts`; seleção `coder_backend: 'claude-code'`
  (default segue `ollama`; retry interno de gate 0). A mecânica comum aos dois executores (instrução,
  allowlist de ambiente, turno com deadline/cancelamento, diagnóstico sanitizado) vive em
  `native-cli-coder.ts`; cada adaptador mantém as próprias flags e config.
- Lançamento sem shell, cwd = worktree (o Claude Code não tem flag de cwd), flags verificadas no
  `claude --help` 2.1.286: `-p --output-format json --no-session-persistence --restricted
  --tools Read,Edit,Write,Glob,Grep,Bash --allowedTools Bash(npm test:*),Bash(npm run typecheck:*),
  Bash(git status:*),Bash(git diff:*) --permission-mode acceptEdits --permission-prompts none [--model M] <instrução>`.
- Só o envelope final JSON é lido (`is_error`/`subtype`/`num_turns`/modelos): exit 0 com erro declarado
  falha fechado. Tool calls não são interpretadas.
- Ambiente: base comum + `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_GIT_BASH_PATH`; `DISABLE_AUTOUPDATER=1`.
  Fora: `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, variáveis
  `CLAUDE_CODE_*`/`CLAUDECODE` de uma sessão hospedeira, Supabase, RunPod e segredos do ANIMA.
- Config do operador: `ANIMA_CLAUDE_CODE_PATH` (default `claude`; `.cmd/.bat/.ps1` recusados),
  `ANIMA_CLAUDE_CODE_MODEL` (ausente ⇒ `default`).
- **Limitação Windows:** sem sandbox de SO no Windows nativo (diferente de Linux/WSL). A contenção é
  `--restricted` + permissões nativas + worktree descartável + git/escopo/gates do host. Não há sandbox próprio.
- **Pré-requisito da prova viva:** o executável standalone precisa estar autenticado na assinatura
  (`claude auth status` ⇒ `loggedIn: true`), por ato humano (`claude auth login`). Em 2026-10-02 ele
  reportava `loggedIn: false` nesta máquina.

## Incremento 3 — ai-memory WRAP V1 (opt-in)

Status: **implementado na branch `claude/ai-memory-wrap-v1`, sem uso real** (2026-10-02). Reuse = WRAP do
`ai-memory run` **2.4.1** (sem fork, sem memória própria). O ai-memory cuida só da continuidade cross-harness
(ledger, delta não visto, resume nativo); Work Item, task spec, gates, evidência e Verifier seguem no ANIMA.

- Fronteira única: `runNativeCliTurn` em `native-cli-coder.ts`. Default **desligado**; sem config os dois
  backends lançam exatamente como antes.
- Config (env do operador): `ANIMA_AI_MEMORY_PATH` (liga), `ANIMA_AI_MEMORY_SERVER_URL` (HTTP loopback),
  `ANIMA_AI_MEMORY_DATA_DIR`, `ANIMA_AI_MEMORY_WORKSTREAM`, `ANIMA_AI_MEMORY_WORKSTREAM_MODE` (`new` ⇒ `--new`,
  `continue` ⇒ `--workstream`), `ANIMA_AI_MEMORY_CLAUDE_SETTINGS` (settings de hooks; exigido pelo Claude).
  Campo faltando ou inválido ⇒ fail-closed.
- Lançamento wrapped: `ai-memory run --no-autowire --workspace anima --project anima --new|--workstream <nome>
  --executable <claude.exe|codex.exe> claude|codex <args nativos>`. Env = allowlist do backend +
  `AI_MEMORY_SERVER_URL`/`AI_MEMORY_DATA_DIR`. Servidor (`ai-memory serve`) é pré-condição externa:
  `GET /healthz` falhando ⇒ não lança.
- Claude wrapped: sem `--no-session-persistence` (o ai-memory trata como efêmero) e com `--settings <hooks>`
  (`--restricted` ignora settings user/project). Codex wrapped: `-c sandbox_mode=workspace-write` no lugar de
  `--sandbox`/`--cd` (o `codex exec resume` não os aceita); perfil explícito ⇒ fail-closed.
- Evidência: só referências em `notes` (`ai-memory:workstream|mode|harness|version|saved-events`); nunca prompts,
  respostas, tool calls, arquivos ou pacotes de delta.
- Escopo V1: Claude → Codex → Claude na **mesma worktree**. Continuidade entre worktrees (A→B→C) é fase 2.
