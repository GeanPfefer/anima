# Codex interativo nesta máquina — Windows / WSL

Launcher validado; versão conferida por `--version` em 2026-10-09:
`codex-cli 0.162.0`. Ubuntu-24.04, usuário geanteco, Node NVM v22.23.3.
Estes caminhos são configuração do operador nesta máquina; não são dependência
arquitetural do ANIMA nem configuração do CoderBackend governado.

## Inicialização no PowerShell

```powershell
Clear-Host
Set-Location G:\anima

wsl.exe -d Ubuntu-24.04 -u geanteco --cd /mnt/g/anima --exec /home/geanteco/.nvm/versions/node/v22.23.3/bin/codex --sandbox workspace-write --ask-for-approval on-request -c 'approvals_reviewer="auto_review"'
```

## Recuperação do histórico

```powershell
Clear-Host
Set-Location G:\anima

wsl.exe -d Ubuntu-24.04 -u geanteco --cd /mnt/g/anima --exec /home/geanteco/.nvm/versions/node/v22.23.3/bin/codex resume --all --sandbox workspace-write --ask-for-approval on-request -c 'approvals_reviewer="auto_review"'
```

`resume --all` abre o seletor incluindo sessões de outros diretórios, exibindo CWD.
Escolher a sessão pelo diretório e pelo checkpoint durável no repositório; não
iniciar repetidamente sessões novas para recuperar contexto. Flags conferidas em
`codex resume --help` local. Histórico nativo em `~/.codex/sessions/` complementa
os registros do ANIMA; não os substitui.

## Atualização pelo npm do NVM — somente quando autorizada

```powershell
Clear-Host
Set-Location G:\anima

wsl.exe -d Ubuntu-24.04 -u geanteco --exec /home/geanteco/.nvm/versions/node/v22.23.3/bin/npm --prefix /home/geanteco/.nvm/versions/node/v22.23.3 install -g @openai/codex@latest
```

A falha EACCES relatada ocorreu ao usar npm global do sistema, que tentou instalar
em `/usr/local/lib/node_modules`. O comando acima usa explicitamente npm e prefix
do NVM do usuário. Depois da atualização, conferir versão pelo mesmo executável
do launcher. Não trocar npm nem usar sudo para contornar esse incidente.
Nenhuma atualização/reinstalação foi feita na sessão de documentação.

A ajuda local em sandbox restrito emitiu aviso sobre criação de aliases PATH em
filesystem somente leitura, mas respondeu versão e ajuda com exit 0. Esse aviso
não demonstra uma nova falha de instalação nem requer reinstalação.


## Executor coder governado via WSL — opt-in (2026-10-10)

O launcher interativo acima continua independente do executor. Para o ANIMA Windows, configurar somente no processo autorizado:

```powershell
$env:ANIMA_CODEX_CLI_TRANSPORT = 'wsl'
$env:ANIMA_CODEX_WSL_DISTRO = 'Ubuntu-24.04'
$env:ANIMA_CODEX_WSL_USER = 'geanteco'
$env:ANIMA_CODEX_WSL_CLI_PATH = '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex'
```

Esses valores são desta máquina. Sem opt-in, o coder Windows permanece igual. Não usar ANIMA_CODEX_CLI_PATH=wsl.exe. Configuração inválida falha fechada; worktrees UNC ou com traversal são recusadas. ai-memory wrap não é compatível com esse modo. Readiness consulta o Codex Linux selecionado. Não copiar chaves ou autenticação do Windows: reutiliza ChatGPT do usuário Linux.

O host Windows conserva git, escopo, gates, checkpoint, Verifier e deadline. Transporte existente traduz drive paths para /mnt e passa argumentos por array sem shell; sandbox workspace-write/aprovação never permanecem. Signal/timeout seguem pelo runProcess existente. A prova de leitura não demonstra ausência universal de processos órfãos no cancelamento entre Windows/WSL; ver limites no registro.

[Implementação, testes e prova](../registros/2026-10-10-codex-wsl-coder.md). Nenhuma attempt autorizada por esta configuração.
