# Project Builder V1-04: Codex via WSL — configuração persistente e diagnóstico — 2026-10-26

Append-only. Tipo: **implementação** (código + testes + doc; sem schema; sem attempt, sem work item novo, sem escrita no banco ou nos laboratórios). Formato de [`README.md`](README.md). Antecede: PROOF-EXT-03 (V1-03).

## Dados

- Branch `claude/v1-04-codex-wsl-config`, base `dev` = `origin/dev` = `e6490445349b710f09ac81e1ea77331ec7f1ed80`. Não integrado, não publicado.
- Ambiente após a pausa: dev/origin conferidos, 161 migrations, 0 claims/leases, PROOF-EXT-02 e 03 `completed`/integradas, labs 1 e 3 limpos (`62a1d1e`, `bf81de4`), 273 WIPs. Docker reiniciado (containers `Up` há segundos): a **publicação de portas do Supabase para o host estava inativa** (`docker ps` sem portas; `curl 127.0.0.1:54321` sem resposta) — registrado, **não corrigido** (fora do escopo; ver Pendências).

## Causa da dependência das variáveis temporárias

O executor `codex-cli` do Single-Item exige o transporte WSL (`single_item_codex_wsl_required`) e a configuração vinha só do ambiente do processo (`ANIMA_CODEX_CLI_TRANSPORT`, `ANIMA_CODEX_WSL_DISTRO`, `ANIMA_CODEX_WSL_USER`, `ANIMA_CODEX_WSL_CLI_PATH`). Nenhum arquivo persistente as definia, então cada comando precisava de exportações manuais; sem elas `work executors` mostrava só `version_check_failed` (a sondagem caía no `codex` nativo). Além disso um `ANIMA_CODEX_CLI_PATH` nativo era **ignorado em silêncio** quando o transporte era WSL.

## Solução (mínima, sobre o mecanismo existente)

1. **Persistência**: o script `anima` passa a carregar, além de `.env.local`, o arquivo `apps/web/.env.codex-wsl.local` (`--env-file-if-exists`, o mesmo mecanismo que já existia). O arquivo é ignorado pelo Git (`.gitignore`), tem modelo versionado (`apps/web/.env.codex-wsl.example`) e só define as quatro variáveis, sem segredos. Só a CLI o carrega (Next e resident host inalterados). Precedência: ambiente do processo > `.env.codex-wsl.local` > `.env.local`; testada com o Node real.
2. **Conflito/validação**: `resolveCodexCliConfig` recusa `ANIMA_CODEX_CLI_PATH` coexistindo com `ANIMA_CODEX_CLI_TRANSPORT=wsl`; a validação de distro/usuário/caminho Linux (já existente) falha fechada e a dica nomeia a variável.
3. **Diagnóstico**: novo `codex-executor-diagnostics.ts` (read-only, um `--version`) → bloco **Codex CLI** em `work executors` (transporte efetivo e a variável que o decidiu, distro, usuário, binário, versão, compatibilidade com `0.162.x`, disponibilidade e causa específica). O `executor-readiness` passa a usar o mesmo classificador (`classifyWslProbeFailure`), então distro/usuário/binário/launcher inexistentes têm motivo próprio (`wsl_distro_not_found`, `wsl_user_not_found`, `codex_binary_not_found`, `wsl_launcher_unavailable`); o motivo genérico `wsl_version_check_failed` continua para o resto. Medido na máquina: `wsl.exe` escreve o erro em **stdout**, UTF-16, localizado, exit -1 — a classificação usa primeiro `WSL_E_DISTRO_NOT_FOUND`/`WSL_E_USER_NOT_FOUND`.
4. Doc: `docs/operacao/codex-wsl-config-persistente.md`.

Não mudaram: adaptador `CodexCliCoderBackend`, perfil nativo, preflight do `execute-one` (`singleItemCodexRefusal`), aprovação, classificação, Verifier, Acceptance Contract, integração Git.

## Provas

- 32 testes novos (`codex-executor-diagnostics.test.ts`) + 3 em `cli/app.test.ts`: configuração válida (um `--version`, nada de `exec`/`login`), versão fora de 0.162.x, transporte legado e precedência, 6 configurações inválidas/conflitantes (sem lançar processo), `wsl.exe` ausente, 11 modos de falha com concordância readiness×diagnóstico (inclui as saídas reais do `wsl.exe`), nativo (PATH, ausente, wrapper, timeout), ausência de segredos, modelo `.env.codex-wsl.example` válido e sem segredos, preflight do Single-Item com e sem a configuração persistente (só `--version`/`status`), carga real do arquivo pelo Node (sem exportações; processo > arquivo; arquivo ausente tolerado), script e `.gitignore`.
- O teste do entrypoint nativo foi ajustado para tolerar o aviso do segundo arquivo opcional ausente.
- Regressão: 57 suítes / 1322 testes (cli, codex, executor, Single-Item, investigation-wsl, ollama, native-cli-coder, claude-code, external*, writer, supervisor, autonomous-backlog); `tsc` core e web limpos.
- **Validação real read-only** (processo novo, nenhuma variável `ANIMA_CODEX*` exportada): com o arquivo persistente → `wsl`, Ubuntu-24.04, geanteco, `…/bin/codex`, `codex-cli 0.162.0`, perfil compatível, `ready`. Controles negativos reais: sem o arquivo → nativo/`executable_not_found` + dica; distro inexistente → `wsl_distro_not_found`; usuário inexistente → `wsl_user_not_found`; binário inexistente → `codex_binary_not_found`; `ANIMA_CODEX_CLI_PATH` + WSL → `codex_transport_invalid` (conflito).

## Pendências

- Criar `apps/web/.env.codex-wsl.local` no checkout principal depois da integração (hoje só existe na worktree de desenvolvimento): `Copy-Item apps/web/.env.codex-wsl.example apps/web/.env.codex-wsl.local`.
- O resident host (`local-host`) não carrega o arquivo (decisão deliberada, escopo CLI); estender é uma decisão separada.
- `work executors` real (que lê o item no banco) não pôde ser executado após a pausa porque o Supabase não estava acessível do host (portas não publicadas); o mesmo código de sondagem/diagnóstico foi exercitado fora do banco.
