# Codex via WSL — configuração persistente e diagnóstico (Project Builder V1-04)

Complementa o runbook do launcher interativo (`docs/operacao/codex-wsl.md`, mantido fora deste commit). Estes valores são desta máquina
(Ubuntu-24.04, usuário `geanteco`, Node NVM v22.23.3); não são dependência arquitetural do ANIMA.

## O problema

O executor `codex-cli` do Single-Item exige o transporte WSL (`single_item_codex_wsl_required` sem ele). Até o V1-03 as quatro variáveis
`ANIMA_CODEX_*` precisavam ser exportadas à mão a cada comando; sem elas `work executors` mostrava um enigmático `version_check_failed`.

## Configuração persistente

1. Copie o modelo: `Copy-Item apps/web/.env.codex-wsl.example apps/web/.env.codex-wsl.local` (o `.local` é ignorado pelo Git e não tem segredos).
2. Ajuste distribuição, usuário e caminho do `codex` se a máquina mudar:

```
ANIMA_CODEX_CLI_TRANSPORT=wsl
ANIMA_CODEX_WSL_DISTRO=Ubuntu-24.04
ANIMA_CODEX_WSL_USER=geanteco
ANIMA_CODEX_WSL_CLI_PATH=/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex
```

O script `npm run anima` carrega `.env.local` e depois `.env.codex-wsl.local` (`--env-file-if-exists`). Só a CLI carrega este arquivo: o Next e o
resident host não mudam de comportamento. O Codex Linux usa a assinatura do usuário Linux; nunca coloque chave de API, token ou senha aqui.

### Precedência (explícita)

1. variável já definida no ambiente do processo (vence qualquer arquivo);
2. `.env.codex-wsl.local`;
3. `.env.local`;
4. o transporte legado `ANIMA_INVESTIGATION_CODEX_TRANSPORT` só vale quando `ANIMA_CODEX_CLI_TRANSPORT` está ausente.

Conflito é recusado (fail-closed): `ANIMA_CODEX_CLI_PATH` (executável nativo) **não pode** coexistir com `ANIMA_CODEX_CLI_TRANSPORT=wsl` — antes
era ignorado em silêncio. Configuração inválida (distro, usuário ou caminho Linux malformados, transporte desconhecido) falha fechada, nomeando a variável.
O arquivo só define variáveis; nada nele é executado pelo ANIMA.

## Diagnóstico (somente leitura)

`npm run anima -- work executors <UUID>` agora acrescenta o bloco **Codex CLI**: transporte efetivo e a variável que o decidiu, distribuição,
usuário, binário resolvido, versão (`--version`, um único processo), compatibilidade com a linha `0.162.x` do perfil Single-Item, disponibilidade e a
causa específica. Não inicia attempt, worktree, coder nem escreve nada; o login por assinatura continua vindo da observação de readiness.

| causa | significa |
|---|---|
| `codex_transport_invalid` / `investigation_transport_invalid` | configuração inválida ou conflitante (a dica nomeia a variável) |
| `wsl_not_installed` | `wsl.exe` não existe em `SystemRoot\System32` |
| `wsl_launcher_unavailable` | o `wsl.exe` não pôde ser lançado (sem nenhuma saída) |
| `wsl_distro_not_found` | `ANIMA_CODEX_WSL_DISTRO` não existe (`WSL_E_DISTRO_NOT_FOUND`) |
| `wsl_user_not_found` | `ANIMA_CODEX_WSL_USER` não existe na distribuição (`WSL_E_USER_NOT_FOUND`) |
| `codex_binary_not_found` | `ANIMA_CODEX_WSL_CLI_PATH` não existe (exit 127 / "No such file") |
| `wsl_version_probe_timeout` | WSL parado ou sob pressão de memória |
| `wsl_version_check_failed` | `codex --version` falhou por outro motivo |
| `wsl_codex_not_logged_in` / `codex_login_not_subscription` | Codex Linux sem login ou autenticado por chave de API |
| `executable_not_found` / `version_check_failed` | transporte nativo (sem WSL) sem `codex` utilizável; em Windows a dica aponta este arquivo |

`wsl.exe` escreve a mensagem de erro em **stdout**, em UTF-16 (o decode UTF-8 intercala NUL), localizada e com exit code -1; por isso a classificação usa
primeiro os códigos estáveis do WSL e só depois padrões de texto e exit code.

## Preflight do `work execute-one`

Inalterado: continua exigindo a configuração WSL (`single_item_codex_wsl_required`), a versão/login por assinatura (`single_item_codex_authentication_unproved`)
e roda só `--version` e `login status` — nunca `exec`. Com o arquivo persistente presente, o preflight passa sem exportações. Lembrete operacional já registrado:
rodar `execute-one` pelo PowerShell, sem sondas WSL antes (a admissão exige ≥ 25% de RAM livre).
