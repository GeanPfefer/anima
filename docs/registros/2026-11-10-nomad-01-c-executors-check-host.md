# NOMAD-01-C: readiness dos executores do host sem banco (`anima executors check`) — 2026-11-10

Append-only. Tipo: **desenvolvimento** (código + testes; sem schema; sem banco; sem attempt, claim, lease ou work item). Formato de [`README.md`](README.md). Antecede: [NOMAD-01-A](2026-11-09-nomad-01-a-encerramento-de-arvore-posix.md).

## Dados

- Branch `nomad/executors-check-host`, base `nomad/posix-process-tree-kill` = `9262cfb` (sobre `origin/dev` = `21b2af9`). Não integrado, não publicado.
- Desenvolvido e testado num workspace Linux (Node 24.22.2); a validação Windows fica para o Nomad (`C:\dev\anima`).

## Estado do Nomad observado (NOMAD-01-B, relatórios em `C:\dev\logs`)

- Windows 11 Home 26200 x64, i7-10750H 6c/12t, 15,9 GB RAM, 46,8 GB livres em C:. PowerShell 5.1. Node 24.17.0, npm 11.13.0, Git 2.54.0. Docker 29.5.3 instalado, parado. WSL 2 apenas com `docker-desktop` (sem Ubuntu). Python ausente (alias da Microsoft Store).
- `claude` e `codex` **fora do PATH**; `~\.claude\.credentials.json` e `~\.codex\auth.json` existem (logins anteriores). Executáveis ainda não localizados.
- Outro clone em `C:\Users\tecop\OneDrive\Desktop\anima`, de estado desconhecido (preservado, não tocado).
- Validação Windows do NOMAD-01-A: 4 testes novos PASS; 0 regressões contra a base nas mesmas 11 suítes; typecheck limpo. 7 falhas idênticas na base e na branch, diagnosticadas: Python ausente (`restore-proof-gate`, 2); raiz fixa `G:\anima` da Goma nos testes (`project-tools`, `project-context-builder`, 4); teste defasado do porto `readBacklog` (`backlog-cycle/route`, 1, falha também no Linux).

## Compatibilidade dos executores (código em `21b2af9`)

- **Codex CLI**: `CodexCliCoderBackend` já tem transporte **nativo Windows** (`windows.sandbox` declarado, `--ignore-user-config`, features do agente desligadas) além do WSL. Executável por `ANIMA_CODEX_CLI_PATH` (default `codex` no PATH); wrappers `.cmd/.bat/.ps1` são recusados — exige o `codex.exe` nativo. Readiness: `codex --version` + `codex login status` (assinatura obrigatória; API key ⇒ `codex_login_not_subscription`).
- **Restrição de política**: o Single-Item com `codex-cli` exige o transporte WSL (`single_item_codex_wsl_required`, `single-item-codex-readiness.ts`), porque o perfil de permissões provado (`anima_single_item`, `codex-cli 0.162.x`) só existe no Codex Linux. No Nomad sem Ubuntu, o Single-Item via Codex está bloqueado por desenho; mudar isso é decisão humana (provar um perfil nativo Windows), não configuração.
- **Claude Code**: `ClaudeCodeCoderBackend` é nativo (`claude -p --restricted --tools … --permission-prompts none`), executável por `ANIMA_CLAUDE_CODE_PATH` (default `claude`), readiness `claude --version` + `claude auth status` + Git Bash no Windows. Não há exigência de WSL.
- Os gates, o Verifier, checkpoints e permissões são do host (`WorktreeExecutorAdapter`) e independem do executor.

## Lacuna e mudança

A única forma de ver a readiness pelo ANIMA era `anima work executors <id>`, que lê um work item do banco; num host sem banco (o Nomad) não havia como provar os executores pelos contratos do próprio ANIMA. Novo comando **`anima executors check [--json]`**: local como `toolchain check` (não autentica, não lê banco), reusa `probeAllExecutors` e `diagnoseCodexExecutor` sem nenhuma sondagem nova, e mostra observação por executor + diagnóstico do Codex. Sem contrato, elegibilidade nem recomendação (isso continua no `work executors`). O bloco de diagnóstico do Codex no render foi extraído para um helper comum, com a saída de `work executors` inalterada (testes existentes do V1-04 seguem verdes).

## Provas

- Testes novos: parser (aceita `--json`, recusa extras/`--reason`), runner (payload exato, diagnóstico, falha do diagnóstico ⇒ `codex: null`, sem segredo, sem recomendação) e entrypoint real pelo script `anima` com ambiente sem Supabase (exit 0, cinco executores, nenhum `authentication_required`).
- Regressão: `cli` + `executor*` + `codex*` + `claude-code*` + `single-item*` + `investigation-wsl*` + `native-cli*`: 34 suítes / 730 testes; `tsc --noEmit` de `apps/web` limpo; `git diff --check` limpo.
- Execução real no Linux: comando conclui com exit 0, sem `.env.local`; `claude` sondado de verdade (`claude_not_logged_in`), Codex `executable_not_found` com dica.

## Limitações

- Não executado no Windows nesta sessão. Os caminhos dos executáveis no Nomad ainda não foram descobertos.
- Arquivos tocados (`cli/app.ts`, `args.ts`, `render.ts`, `anima.ts`) são compartilhados; trabalho não publicado da Goma pode conflitar (adições localizadas, rebase simples esperado).

## Efeitos externos

Nenhum push, PR, merge, migration, escrita em banco, Docker, Supabase ou custo de API.

## Próximo ponto exato de retomada

No Nomad: localizar `claude.exe` e `codex.exe` nativos, rodar `anima executors check` com `ANIMA_CLAUDE_CODE_PATH`/`ANIMA_CODEX_CLI_PATH` apontando para eles, e fazer login interativo onde a sondagem indicar. Depois, decidir se o primeiro executor do Nomad é o Claude Code (nativo, sem WSL) ou se se instala Ubuntu para o Codex Single-Item.
