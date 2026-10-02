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
