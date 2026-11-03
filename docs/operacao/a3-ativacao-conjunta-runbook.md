# Ativação conjunta do isolamento (A3 + CodexHome + workspaces dedicados) — runbook supervisionado

Estado: PREPARADO, NÃO EXECUTADO. Nada aqui altera o ambiente residente. Ato do operador, com o Codex Desktop fechado e sem Host/attempt.
Scripts: `scripts/gate-isolation-acl.ps1` (regras), `scripts/gate-isolation-activate.ps1` (ativação conjunta + rollback). Testados só em laboratório (G:\anima-iso-lab) com o sandbox real.

## 0. Duas trilhas (leia antes)

| Trilha | Quem protege | Mecanismo |
|---|---|---|
| **W — Windows nativo** (gates do Host `runGate`/`runCommand`; coder Codex nativo) | `CodexSandboxUsers` (CodexSandboxOffline) | ACLs: A3 no checkout + DENY na raiz de `~/.codex` + pai dedicado dos workspaces (este runbook) |
| **L — WSL** (o contrato single-item exige `ANIMA_CODEX_CLI_TRANSPORT=wsl`, ver `single-item-codex-readiness.ts`) | NADA do lado Windows: o Codex roda como o usuário no Linux; as ACLs do grupo não se aplicam | Perfil nativo de permissões do Codex (`default_permissions` + `permissions.<nome>.filesystem`), por invocação |

Provado no laboratório (Codex 0.162 no WSL): `codex sandbox -P :workspace` confina a ESCRITA mas deixa LER tudo (`/mnt/g/anima/apps/web/.env.local`, `~/.codex/auth.json` do Linux e do Windows). Com um perfil `extends=":workspace"` + `filesystem={"<caminho>"="none"}` ou, melhor, um perfil sem `extends` (lista de permissão: `:minimal`, `:workspace_roots`/`:cwd`/`:tmpdir` = write, instalação do Codex/Node = read) o `codex exec` real negou checkout, listagem e auth, escreveu no workspace e não tinha interop (`cmd.exe`). `--sandbox workspace-write` ANULA o perfil (a flag vence): o código atual (`buildCodexExecArgs`) ainda passa essa flag ⇒ a trilha L exige a mudança de código da seção 7 antes de qualquer attempt single-item.

## 1. Pré-condições (todas)

- [ ] Nenhum Codex Desktop/CLI, `node_repl`, Resident Host ou attempt rodando (`Get-Process codex*,node_repl`); serviço `CodexSandboxService.OpenAI.Codex` pode ficar.
- [ ] `dev`/`origin/dev` no commit que contém estes scripts; `origin/main` intacta; `git status` do checkout registrado (`git status --short > status-antes.txt`).
- [ ] Cópia confiável dos scripts FORA do checkout (o grupo tem Modify herdado em `G:\anima`): `C:\Users\GeanTeco\AnimaAclTools\` com `Get-FileHash` conferido contra o blob do commit (`git hash-object`).
- [ ] `StateDir` NOVO e inexistente (o driver o cria sem herança, só SYSTEM/Admins/usuário, com DENY explícito ao grupo — o Codex concede leitura ao grupo em diretórios do contexto de execução: log `granting read ACE ... for sandbox users`).
- [ ] `G:\anima-workspaces` inexistente (o driver cria, sem herança) e SEM worktrees dentro ao reverter.
- [ ] `ANIMA_CODEX_*`/`ANIMA_GATE_*` NÃO definidos globalmente nem no `.env.local` (só no processo do Host, seção 5).
- [ ] Decisão sobre `G:\` (ver riscos): a raiz concede Modify a `Usuários autenticados` ⇒ qualquer outra pasta de `G:` continua legível pelo sandbox.

## 2. Variáveis da sessão

```powershell
$T   = 'C:\Users\GeanTeco\AnimaAclTools'                         # cópia confiável dos scripts
$ST  = 'C:\Users\GeanTeco\AnimaAclState\joint-' + (Get-Date -Format yyyyMMdd-HHmm)
$CX  = "$env:LOCALAPPDATA\OpenAI\Codex\bin\<hash>\codex.exe"       # o hash muda com a versão: conferir antes
$SHA = (Get-FileHash "$T\gate-isolation-acl.ps1" -Algorithm SHA256).Hash
$dep = 'G:\anima\node_modules','G:\anima\packages','G:\anima\apps'   # ver §6 (junctions @anima/* apontam para packages/*)
$common = @{ Repo='G:\anima'; WorkspaceParent='G:\anima-workspaces'; CodexHome="$env:USERPROFILE\.codex"; StateDir=$ST;
             AclScript="$T\gate-isolation-acl.ps1"; ExpectedAclScriptSha256=$SHA; Dependencies=$dep;
             AllowProductionRepo=$true; AllowRealCodexHome=$true }
```

## 3. Fases

**A — Simulação, aplicação e sondas** (cada comando mostra o que fará; nada muda sem `-Apply`)
```powershell
& "$T\gate-isolation-activate.ps1" @common                      # simulação: 0 mudanças
& "$T\gate-isolation-activate.ps1" @common -Apply               # checkpoint → pai → A3 → CodexHome → verify
& "$T\gate-isolation-activate.ps1" @common -Verify -ProbeCodexPath $CX -ProbeSandboxBinExe codex.exe
```
PASS: `VERIFY: OK` (A3 + CodexHome, sonda efetiva: segredo/.git/listagem do checkout/auth/histórico negados; `.sandbox-bin` executável; workspace gravável).

**B — `codex exec` autenticado e curto** (diretório descartável DENTRO de `G:\anima-workspaces`, criado pelo Host: `git worktree add` + junction de `node_modules`; argv gerado por `buildCodexExecArgs`). PASS: `turn.completed`, arquivo escrito via apply_patch, `whoami` = `goma\codexsandboxoffline`.

**C — Isolamento** (sondas no workspace): ler `.env.local`, `.git/HEAD`, `docs/`, WIP de `G:\anima\.worktrees`, `~/.codex/auth.json` (só abrir handle) ⇒ todos negados; symlink/junction plantados no workspace ⇒ recusados pelo Host (`workspace-guard`); gate `require('@anima/core')` resolve (exige `$dep` com `packages`).

**D — Codex Desktop** (humano): abrir, conversa nova sandboxed (criar arquivo + `whoami`). PASS: abre logado e executa.

**E — Reversão** (mesmo ato, obrigatória)
```powershell
# remover antes as worktrees da prova (Host: git worktree remove/prune; junction com [IO.Directory]::Delete(<junction>,$false))
& "$T\gate-isolation-activate.ps1" @common -Rollback           # reverte CodexHome, A3, remove o pai se vazio; compara com o checkpoint
```
PASS: `rollback concluido: estado igual ao checkpoint`, `exit 0`; repetir 1× o item D (Desktop) e o item B (CLI) como controle. `exit 2` = rollback incompleto (ex.: pai não vazio): remover o que sobrou e repetir `-Rollback` (idempotente).

## 4. Rollback independente do Codex (e do driver)

1. Driver: `-Rollback` (só PowerShell; não usa o Codex).
2. Sem o driver: restaurar a DACL do checkpoint (testado em laboratório, 11 caminhos idênticos):
```powershell
$c = Get-Content "$ST\checkpoint-*\sddl-checkpoint.json" -Raw | ConvertFrom-Json
foreach ($k in $c.PSObject.Properties.Name) { $s = $c.$k; if (-not $s) { continue }
  $i = Get-Item -LiteralPath $k -Force
  $sec = if ($i.PSIsContainer) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
  $sec.SetSecurityDescriptorSddlForm($s, [System.Security.AccessControl.AccessControlSections]::Access)
  if ($i.PSIsContainer) { [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]$i, $sec) } else { [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.FileInfo]$i, $sec) } }
```
   Pai criado e vazio: `[IO.Directory]::Delete('G:\anima-workspaces',$false)`.
3. Último recurso para `~/.codex` (backup recursivo `icacls /save` feito na prova anterior): `icacls $env:USERPROFILE /restore <arquivo>` (apaga ACE de allow do grupo se usar `/remove:d` — por isso só em emergência).
Nunca `Set-Acl` com objeto de `Get-Acl` em diretório recém-protegido (SeSecurityPrivilege): usar a API de DACL acima.

## 5. Host (somente na sessão que o lança; não editar `.env.local`)

```powershell
$env:ANIMA_WORKTREE_PARENT        = 'G:\anima-workspaces'
$env:ANIMA_GATE_SANDBOX           = 'codex-windows'
$env:ANIMA_GATE_SANDBOX_CODEX_PATH = $CX            # caminho com hash: mudou ⇒ falha fechada (exit -3), nada executa
# single-item (trilha L): ANIMA_CODEX_CLI_TRANSPORT=wsl, ANIMA_CODEX_WSL_DISTRO/USER/CLI_PATH; ANIMA_CODEX_CLI_PROFILE vazio; modelo = 'default' (contrato)
# coder nativo (trilha W): ANIMA_CODEX_CLI_PATH=$CX, ANIMA_CODEX_CLI_MODEL explícito, ANIMA_CODEX_WINDOWS_SANDBOX só se for 'unelevated'
```
`config.toml` pessoal: o Codex grava/reescreve (trust por RAIZ do repositório: já existe `g:\anima`, então worktrees de G:\anima não acrescentam entrada; o mtime muda mesmo assim). `--ignore-user-config` não impede a escrita. Não há como evitá-la sem CODEX_HOME dedicado (fora do escopo).

## 6. Riscos residuais

- `G:\` concede `Modify` a Usuários autenticados: pastas irmãs (verificado: `anima-local-agent-poc`, o bundle `G:\anima-backup-presecret.bundle`; `anima-durability` já é protegida) e as 32 worktrees WIP em `%TEMP%` (o grupo tem `Modify` herdado, a escrita real é contida pelo token do sandbox) seguem acessíveis ao sandbox. A3 só cobre `G:\anima` e `~/.codex`.
- `node_modules/@anima/*` são junctions para `G:\anima\packages|apps` (checkout principal): sob A3 exigem carve-out RX (`$dep`) e fazem o gate testar o core do checkout, não o do candidato.
- O Codex concede ACEs de leitura ao grupo em diretórios do contexto (StateDir, cwd); o driver protege o StateDir com DENY, mas qualquer outro diretório de apoio pode ficar legível.
- Codex Desktop interativo sob o sandbox em `G:\anima` deixa de funcionar durante a ativação (usar o launcher WSL ou reverter).
- Trilha L depende da mudança de código (§7) e da versão do Codex (0.162 no WSL); feature/chave desconhecida falha alto.
- TOCTOU, `%TEMP%` gravável, symlinks LX, serviço do sandbox (SYSTEM) fora do alcance do DENY.

## 7. Pendências de código antes de qualquer attempt

1. `buildCodexExecArgs` (WSL): usar o perfil nativo (`default_permissions` + `permissions.<nome>.filesystem` com `:workspace_roots`/`:cwd`/`:tmpdir`=write, instalação do Codex/Node=read) e NÃO passar `--sandbox` quando o isolamento está ligado; teste do argv e prova com o Codex real (§0).
2. `linkNodeModules`: apontar `@anima/*` para os packages da worktree (ou aceitar o carve-out em `packages`/`apps` e documentar).
3. Commitar `gate-isolation-acl.ps1` (DACL-only, `exit 0`, cwd da sonda) e `gate-isolation-activate.ps1` com testes de laboratório reproduzíveis.
