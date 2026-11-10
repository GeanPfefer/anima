# NOMAD-01-D: CLIs oficiais no Nomad e causa explícita de executável ausente — 2026-11-10

Append-only. Tipo: **desenvolvimento** (código + testes) e **preparação de host** (instruções; nenhuma instalação feita pelo ANIMA). Sem schema, banco, attempt, claim ou work item. Formato de [`README.md`](README.md). Antecede: [NOMAD-01-C](2026-11-10-nomad-01-c-executors-check-host.md).

## Dados

- Branch `nomad/executor-not-found-cause`, base `nomad/executors-check-host` = `69ccb11`. Não integrado, não publicado.
- Relatório do Nomad usado: `C:\dev\logs\nomad-executors-20261110-113956.txt`.

## Estado observado no Nomad antes da instalação

- `claude` e `codex` ausentes do PATH, do npm global (`%APPDATA%\npm`), de `~\.local\bin` e das extensões do VS Code. Instalados apenas os apps desktop (Appx): `Claude 4.23118.1.0`, `OpenAI.Codex 26.1103.7773.0` e `OpenAI.CodexPrimaryRuntime`. Os binários internos desses apps não são CLIs oficiais e não são usados.
- Git Bash em `C:\Program Files\Git\bin\bash.exe` (pré-requisito do adaptador Claude no Windows).
- `anima executors check` no Windows: exit 0; `claude-code` e `codex-cli` apareciam como `version_check_failed`, e a dica do Codex mandava configurar WSL.
- Clone em `OneDrive\Desktop\anima`: `main` em `43bf3ce` (2026-06-20), limpo, sem os checkpoints da Goma. Sem valor para a reconciliação.

## Mudança

- `executor-readiness.ts`: nome sem caminho cujo `--version` nem é lançado (`runProcess` devolve -1 no `error` do spawn) passa a `executable_not_found`, como no diagnóstico do Codex (V1-04). Vale para Codex e Claude Code. Caminho absoluto existente que falha ao lançar continua `version_check_failed`. O teste antigo que esperava `version_check_failed` para -1 com `codex` sem caminho foi trocado por exit 1; o caso -1 ganhou teste próprio.
- `codex-executor-diagnostics.ts`: no Windows, a dica de executável ausente cita primeiro o transporte nativo (codex.exe no PATH ou `ANIMA_CODEX_CLI_PATH`) e mantém a orientação WSL, declarando que o Single-Item continua exigindo WSL. O bloqueio `single_item_codex_wsl_required` não foi tocado.

## Provas

- `executor-readiness` + `codex-executor-diagnostics`: 66 testes; regressão de CLI, executores, Codex, Claude Code, Single-Item, investigação, native-cli e worktree: 43 suítes ok, 1006 testes ok. A única falha (`worktree-executor` › gate FAIL realimentado) é pré-existente no Linux, presente nos logs completos de `21b2af9` e do NOMAD-01-A. `tsc --noEmit` limpo.

## Aviso `.env.local not found`

É a mensagem do próprio Node 24 para `--env-file-if-exists` quando o arquivo opcional não existe (o script `anima` carrega `.env.local` e `.env.codex-wsl.local`). Não indica erro nem exige banco; no Nomad nenhum dos dois existe. No PowerShell 5.1, juntar stderr com `2>&1` transforma essa linha em `NativeCommandError` e o console decodifica UTF-8 como OEM (texto corrompido): efeito do script de inventário, não do ANIMA.

## Instaladores oficiais (inspeção)

- Claude Code: `irm https://claude.ai/install.ps1 | iex` (sem administrador; `%USERPROFILE%\.local\bin\claude.exe`; atualização automática), conforme a documentação oficial.
- Codex CLI: `irm https://chatgpt.com/codex/install.ps1 | iex`. A versão do script em `openai/codex` (`scripts/install/install.ps1`) verifica SHA-256 dos assets, instala no escopo do usuário (`~\.codex\packages\standalone` com junction em `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`), adiciona esse diretório ao PATH do usuário e pergunta antes de desinstalar um Codex via npm/bun ou iniciar o Codex. Não exige administrador.
- Os bytes servidos pelos dois domínios não puderam ser baixados deste workspace (proxy). O procedimento exige baixar sem executar, auditar e só então executar.

## Efeitos externos

Nenhum push, merge, migration, banco, Docker, Supabase, Ubuntu ou custo de API.

## Próximo ponto exato de retomada

Auditar os instaladores baixados em `C:\dev\artifacts\installers`, instalar os dois CLIs, fazer login por assinatura e rodar `anima executors check` até `claude-code` e `codex-cli` aparecerem como `ready`.
