# Coding Harness V3 — EXEC/TEST/GIT governados + loop iterativo (3ª fatia)

Data: 2026-09-14
Objetivo: dar ao runtime NATIVO (Ollama/OpenAI) a capacidade de executar comandos de
desenvolvimento (test/typecheck), inspecionar git (read-only) e ITERAR edit→test→edit→submit
dentro da worktree autorizada — sem shell irrestrito, sem rede, sem git mutável. Sem compute
pago, sem RunPod, sem settlement.

## Estado reconciliado

- Branch `dev`; HEAD `b14a32c` (inalterado, nenhum commit); `origin/main` `99bec54` INTACTA.
- Sobre o WIP amplo preexistente + V3 fatias 1 e 2 (todos preservados, não commitados).
- Infra reutilizada (não recriada): `runProcess` (spawn sem shell + timeout + cancel + captura
  MAX_CAPTURE), `CommandResult`, o helper `git`, `GitWorktree` (searchText/listFiles/diff),
  `safeJoin` (confinamento), `parseGateCommand`/`runGate` (allowlist npm de gate).

## Mudança implementada (evolução incremental)

- **Core puro** `command-execution-policy.ts` (`CommandExecutionPolicyV1`,
  `resolveCommandExecution`, `SUPERVISED_*`/`AUTONOMOUS_*`, `resolveCommandExecutionPolicy`,
  `READONLY_GIT_SUBCOMMANDS`). Autoridade EXEC distinta de READ/WRITE. Exportado do índice.
- **Protocolo** (`ollama-protocol.ts`): ações `exec` (program/args/timeoutMs) e `submit` no
  envelope; `parseExecRequest` (formato; autoridade fica na policy).
- **Contrato** (`coder-backend.ts`): `CoderWorkspace.exec?` (+ WorkspaceExecInput/Result);
  `CoderEditRequest.commandPolicy?`.
- **Worktree** (`worktree.ts`): `GitWorktree.runCommand` — spawn confinado a `root`, sem shell
  (exceto shims `.cmd` do Windows), `node_modules/.bin` no PATH, captura/timeout/cancel.
- **Laço** (`ollama-coder.ts`): modo EXEC (command policy + `workspace.exec`) habilita EDIT
  ITERATIVO (aplica e continua; atualiza cache) + ações `exec`/`submit`; valida exec pela
  policy (recusa vira observação); exitCode≠0 e erros de edição recuperáveis são observação
  bounded; qualquer terminal após edições válidas entrega o acumulado (submit implícito);
  `EXEC_SYSTEM` anexado ao system só em modo exec. Retrocompat: sem policy/exec, edit
  permanece TERMINAL (histórico).
- **Executor** (`worktree-executor.ts`): liga `workspace.exec`→`runCommand` e injeta
  `resolveCommandExecutionPolicy('supervised')` (wiring vivo mínimo do Governor).
- **OpenAI** herda tudo por delegação (model-agnostic).

## Provas locais (determinístico, zero gasto)

- `packages/core`: 83 suites / 1678 PASS (novo `command-execution-policy` 7); tsc core limpo.
- `apps/web` coder trio: 149→ (ollama-coder 47, +exec: EXEC roda+captura; TEST exit1→EDIT→TEST
  exit0→submit; comando fora da allowlist recusado; shell chaining recusado; git status/diff
  permitidos e commit/push/reset recusados; timeout observado; saída truncada; write fora do
  escopo recusado como observação (arquivo intacto) e sessão conclui; SEARCH→READ→TEST→EDIT→
  TEST→DIFF→submit; submit sem edições falha fechado; retrocompat sem policy). gpt-coder:
  EXEC(test)→EDIT→EXEC(test)→submit pelo transporte OpenAI (paridade).
- `apps/web` `worktree.test` 50 PASS (novos runCommand reais: git status/diff no root; node
  --version; timeout cancela).
- `apps/web` `worktree-executor.test` 43 PASS (1 fixture ajustada: `prompt_eval_count` 1000→
  100000, pois o system cresceu com SEARCH/EXEC e disparava falso `ollama_prompt_truncated`).
- Sweep adjacente (coder-backend, deepseek-harness*, executor-selection*, coder-placement,
  coder-model-policy, in-process-host-turn, backlog-host-turn-run): PASS.

## Falhas de infra (separadas de código, per AGENTS.md)

- `tsc --noEmit` do `apps/web`: 15 erros, TODOS nos 3 scripts one-off UNTRACKED do arco
  congelado de settlement — WIP preexistente, não tocado. ZERO erros nos arquivos desta fatia.

## Segurança / autoridades

- READ/WRITE/EXEC distintas. Ler não concede escrever; executar não concede rede nem git
  mutável. git read-only por subcomando; npm sem install; args sem metacaractere/`..`; cwd
  confinado (não exposto ao modelo). Write fora do escopo recusado + `contract_violation`
  pós-edição via git observado. Rede negada por POLICY/allowlist (não sandbox de kernel —
  documentado honestamente). Sem RunPod/OpenAI paga/autoridade paga/merge/push/deploy.

## Docs

- `docs/arquitetura/coding-harness-v3-agentic-runtime.md`: tabela atualizada, roadmap (SHELL/
  TEST/GIT DONE), nova §8 (EXEC/TEST/GIT, command/network policy, 3 autoridades, falha de
  teste recuperável, honestidade de enforcement, DeepSeek como referência).

## Próximo ponto de retomada

- Equivalência prática com Claude Code/Codex (gaps): resolução robusta de binários diretos
  (tsc/jest/vitest cross-platform, hoje via `npm run`); sandbox de rede de KERNEL; perfis
  autônomos vivos injetados pelo Governor (já existem no core: `AUTONOMOUS_*`). Depois:
  "brain" persistente orquestrando sessões (visão §1). Settlement B1/B2/B3 CONGELADO como
  benchmark (base `ccb7dcc`, ref `0bea4c8`).
