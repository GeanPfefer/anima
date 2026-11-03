#requires -Version 5.1
<#
 Ativacao CONJUNTA e reversivel do isolamento (A3 no checkout + pai dedicado dos workspaces + DENY no CodexHome), sobre gate-isolation-acl.ps1.
 PADRAO = SIMULACAO. -Apply executa; -Rollback desfaz tudo que o estado registra; -Verify confere. ATO DO OPERADOR: o ANIMA nao executa este script.

 Passos (apply), cada um registrado em StateDir\joint-state.json ANTES de mutar:
   0 preflight   : nenhum processo Codex (a menos que -AllowRunningCodex), StateDir fora das arvores protegidas e sem ACE do grupo, hash do script de ACL
                   (-ExpectedAclScriptSha256), checkpoint de SDDL em StateDir\checkpoint-<ts>\
   1 workspaces  : cria o pai dedicado (se faltar), heranca desabilitada, so SYSTEM/Administradores/usuario atual com FullControl
   2 A3          : gate-isolation-acl.ps1 -Repo -WorkspaceParent (DENY no checkout, ALLOW explicito no pai e nas dependencias, DENY nos segredos)
   3 CodexHome   : gate-isolation-acl.ps1 -CodexHome -CodexHomeOnly (DENY na raiz, carve-outs de .sandbox/.sandbox-bin)
   4 verify      : -Verify de A3 e de CodexHome (com -ProbeCodexPath: acesso efetivo no sandbox real)
 Falha em qualquer passo => rollback automatico dos passos concluidos, em ordem inversa, e saida com erro. -Rollback (independente do Codex: so PowerShell)
 repete isso a partir do estado. O rollback do passo 1 remove o pai SOMENTE se foi criado aqui e estiver vazio; nunca apaga conteudo.
 Nunca usa icacls /remove:d. -InjectFailureAtStep <n> existe so para testar o rollback em laboratorio.
#>
[CmdletBinding()]
param(
 [string]$Repo = 'G:\anima',
 [string]$WorkspaceParent = 'G:\anima-workspaces',
 [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),
 [Parameter(Mandatory)][string]$StateDir,
 [Parameter(Mandatory)][string]$AclScript,
 [string]$ExpectedAclScriptSha256,
 [string[]]$Dependencies,
 [string[]]$SecretFiles,
 [string]$ProbeCodexPath,
 [string]$ProbeSandboxBinExe,
 [switch]$Apply, [switch]$Rollback, [switch]$Verify,
 [switch]$AllowProductionRepo, [switch]$AllowRealCodexHome, [switch]$AllowRunningCodex,
 [int]$InjectFailureAtStep = 0
)
$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath($Repo).TrimEnd('\'); $WorkspaceParent = [IO.Path]::GetFullPath($WorkspaceParent).TrimEnd('\')
$CodexHome = [IO.Path]::GetFullPath($CodexHome).TrimEnd('\'); $StateDir = [IO.Path]::GetFullPath($StateDir).TrimEnd('\'); $AclScript = [IO.Path]::GetFullPath($AclScript)
$statePath = Join-Path $StateDir 'joint-state.json'
$group = 'CodexSandboxUsers'
$sidGroup = (New-Object System.Security.Principal.NTAccount($env:COMPUTERNAME, $group)).Translate([System.Security.Principal.SecurityIdentifier]).Value
function Get-AclAccess($path) { $i = Get-Item -LiteralPath $path -Force; if ($i.PSIsContainer) { [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.DirectoryInfo]$i, [System.Security.AccessControl.AccessControlSections]::Access) } else { [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.FileInfo]$i, [System.Security.AccessControl.AccessControlSections]::Access) } }
function Set-AclAccess($path, $sec) { $i = Get-Item -LiteralPath $path -Force; if ($i.PSIsContainer) { [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]$i, $sec) } else { [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.FileInfo]$i, $sec) } }
function Log($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format HH:mm:ss), $m) }
function Under($a, $b) { $a.Equals($b, [StringComparison]::OrdinalIgnoreCase) -or $a.StartsWith($b + '\', [StringComparison]::OrdinalIgnoreCase) }
function Is-Reparse($p) { (([IO.File]::GetAttributes($p)) -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
function Read-Joint { if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null } }
function Write-Joint($o) { $tmp = "$statePath.tmp"; ($o | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $tmp -Encoding UTF8; Move-Item -LiteralPath $tmp -Destination $statePath -Force }
function Acl-Args($mode) {
 $h = @{}
 if ($mode -eq 'a3') { $h.Repo = $Repo; $h.WorkspaceParent = $WorkspaceParent; $h.StatePath = (Join-Path $StateDir 'a3-state.json'); if ($Dependencies) { $h.Dependencies = $Dependencies }; if ($SecretFiles) { $h.SecretFiles = $SecretFiles }; if ($AllowProductionRepo) { $h.AllowProductionRepo = $true } }
 else { $h.CodexHome = $CodexHome; $h.CodexHomeOnly = $true; $h.WorkspaceParent = $WorkspaceParent; $h.StatePath = (Join-Path $StateDir 'codexhome-state.json'); if ($AllowRealCodexHome) { $h.AllowRealCodexHome = $true } }
 $h
}
function Run-Acl($mode, [string[]]$flags) {
 $h = Acl-Args $mode; foreach ($f in $flags) { $h[$f] = $true }
 if ($flags -contains 'Verify' -and $ProbeCodexPath) { $h.ProbeCodexPath = $ProbeCodexPath; if ($mode -eq 'codex' -and $ProbeSandboxBinExe) { $h.ProbeSandboxBinExe = $ProbeSandboxBinExe } }
 $global:LASTEXITCODE = 0
 & $AclScript @h | ForEach-Object { "    $_" }
 $script:aclExit = $LASTEXITCODE
}
function Snapshot-Paths {
 $p = New-Object System.Collections.ArrayList
 foreach ($x in @($Repo, "$Repo\.git", "$Repo\.worktrees", "$Repo\node_modules", "$Repo\apps", "$Repo\packages", $CodexHome, "$CodexHome\.sandbox", "$CodexHome\.sandbox-bin", "$CodexHome\auth.json", "$CodexHome\config.toml", (Split-Path $WorkspaceParent))) { if (Test-Path -LiteralPath $x) { [void]$p.Add($x) } }
 # Alvos das regras do A3 (segredos e dependencias): sem eles o checkpoint nao permitiria restaurar a mao as ACEs explicitas desses arquivos.
 $sec = if ($SecretFiles) { $SecretFiles } else { @("$Repo\apps\web\.env.local", "$Repo\apps\mobile\.env.local", "$Repo\supabase\.env") }
 $dep = if ($Dependencies) { $Dependencies } else { @("$Repo\node_modules") + @(Get-ChildItem "$Repo\apps", "$Repo\packages" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'node_modules' }) }
 foreach ($x in @($sec) + @($dep)) { if ((Test-Path -LiteralPath $x) -and -not $p.Contains($x)) { [void]$p.Add($x) } }
 if (Test-Path -LiteralPath $WorkspaceParent) { [void]$p.Add($WorkspaceParent) }
 $p
}
function Norm($s) { $s -replace 'D:AI', 'D:' }
function Compare-Checkpoint($ckptFile) {
 $c = Get-Content -LiteralPath $ckptFile -Raw | ConvertFrom-Json; $bad = 0
 foreach ($k in $c.PSObject.Properties.Name) {
  $now = if (Test-Path -LiteralPath $k) { Norm (Get-Acl -LiteralPath $k).Sddl } else { '<ausente>' }
  $was = if ($c.$k) { Norm $c.$k } else { '<ausente>' }
  if ($now -ne $was) { $bad++; Log ("DIFERE do checkpoint: {0}" -f $k) }
 }
 if ($bad -eq 0) { Log ("checkpoint: {0} caminhos com SDDL identico (ignorando a flag cosmetica AI)" -f @($c.PSObject.Properties).Count) }
 $script:cmpBad = $bad
}

function Do-Rollback($state, $why) {
 Log ("ROLLBACK ({0})" -f $why)
 $errors = 0
 foreach ($step in @($state.started | Sort-Object -Descending)) {
  try {
   switch ($step) {
    3 { Log 'desfazendo passo 3 (CodexHome)'; Run-Acl 'codex' @('Revert', 'Apply'); if ($script:aclExit) { throw "revert CodexHome exit=$script:aclExit" } }
    2 { Log 'desfazendo passo 2 (A3)'; Run-Acl 'a3' @('Revert', 'Apply'); if ($script:aclExit) { throw "revert A3 exit=$script:aclExit" } }
    1 {
     Log 'desfazendo passo 1 (pai dos workspaces)'
     if ($state.parentCreated -and (Test-Path -LiteralPath $WorkspaceParent)) {
      if (Is-Reparse $WorkspaceParent) { throw 'pai dos workspaces virou reparse point: nao removo' }
      if (@(Get-ChildItem -LiteralPath $WorkspaceParent -Force).Count -eq 0) { [IO.Directory]::Delete($WorkspaceParent, $false); Log '    pai removido (vazio, criado por este script)' } else { Log '    pai NAO removido: nao esta vazio (conteudo preservado)' }
     } else { Log '    nada a fazer (pai preexistente)' }
    }
   }
  } catch { $errors++; Log ("FALHA no rollback do passo {0}: {1}" -f $step, $_.Exception.Message) }
 }
 if ($state.checkpoint -and (Test-Path -LiteralPath $state.checkpoint)) { Compare-Checkpoint $state.checkpoint; $errors += $script:cmpBad }
 if ($errors -eq 0) { $state.completed = @(); $state.started = @(); $state.status = 'rolled-back'; Write-Joint $state; Log 'rollback concluido: estado igual ao checkpoint' } else { $state.status = 'rollback-incompleto'; Write-Joint $state; Log 'ROLLBACK INCOMPLETO: use o checkpoint (SDDL) para recuperar; ver o roteiro'; }
 $errors
}

# ---------- validacoes comuns ----------
if (-not (Test-Path -LiteralPath $AclScript)) { throw "AclScript inexistente: $AclScript" }
if ($ExpectedAclScriptSha256 -and (Get-FileHash -LiteralPath $AclScript -Algorithm SHA256).Hash -ne $ExpectedAclScriptSha256.ToUpperInvariant()) { throw 'Hash do script de ACL diferente do esperado: recusado.' }
foreach ($prot in @($Repo, $CodexHome)) { if (Under $StateDir $prot) { throw "StateDir dentro de uma arvore protegida ($prot): recusado." } }
if (Under $AclScript $Repo) { Log 'AVISO: o script de ACL esta dentro do checkout (o grupo do sandbox tem Modify herdado ali); use uma copia confiavel com hash conferido.' }
# O Codex concede ACEs de LEITURA ao grupo do sandbox em diretorios do contexto de execucao (log "granting read ACE ... for sandbox users"): um
# StateDir comum pode virar legivel pelo grupo. Ao criar, o script desabilita a heranca, deixa so SYSTEM/Administradores/usuario e grava um DENY
# explicito para o grupo (negacao explicita precede qualquer ALLOW concedido depois).
if (-not (Test-Path -LiteralPath $StateDir)) {
 if ($Apply) {
  New-Item -ItemType Directory -Path $StateDir | Out-Null
  $sa = Get-AclAccess $StateDir; $sa.SetAccessRuleProtection($true, $false); foreach ($r in @($sa.Access)) { [void]$sa.RemoveAccessRule($r) }
  foreach ($id in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'), (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) { $sa.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))) }
  $sa.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier $sidGroup), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Deny')))
  Set-AclAccess $StateDir $sa
 }
}
if (Test-Path -LiteralPath $StateDir) { $aces = @((Get-Acl -LiteralPath $StateDir).Access | Where-Object { $_.AccessControlType -eq 'Allow' } | Where-Object { try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $sidGroup -or $_.IdentityReference.Value -match 'Everyone|Todos|Autenticados|Authenticated|BUILTIN\\Users|Usu.rios$' } catch { $false } }); if ($aces.Count -gt 0) { throw 'StateDir tem ACE do grupo do sandbox ou de grupos amplos: o estado poderia ser adulterado. Recusado.' } }
if ((Under $WorkspaceParent $Repo) -or (Under $Repo $WorkspaceParent) -or (Under $WorkspaceParent $CodexHome) -or (Under $CodexHome $WorkspaceParent)) { throw 'WorkspaceParent nao pode conter nem estar dentro do Repo ou do CodexHome.' }

# ---------- Rollback / Verify avulsos ----------
if ($Rollback) {
 $st = Read-Joint; if (-not $st) { Log 'Sem estado conjunto: nada a desfazer.'; exit 0 }
 $e = Do-Rollback $st 'solicitado'; if ($e -gt 0) { exit 2 } else { exit 0 }
}
if ($Verify) {
 $bad = 0
 Log 'verify A3'; Run-Acl 'a3' @('Verify'); if ($script:aclExit) { $bad++ }
 Log 'verify CodexHome'; Run-Acl 'codex' @('Verify'); if ($script:aclExit) { $bad++ }
 if ($bad) { Log "VERIFY: $bad bloco(s) com falha"; exit 1 } else { Log 'VERIFY: OK'; exit 0 }
}

# ---------- Apply / simulacao ----------
if (-not $Apply) {
 Log 'SIMULACAO (nada sera alterado). Passo 1: pai dos workspaces'
 Log ("    {0}: {1}" -f $(if (Test-Path -LiteralPath $WorkspaceParent) { 'ja existe' } else { 'seria criado, sem heranca, so SYSTEM/Admins/usuario' }), $WorkspaceParent)
 Log 'Passo 2: A3'; Run-Acl 'a3' @()
 Log 'Passo 3: CodexHome'; Run-Acl 'codex' @()
 exit 0
}
$existing = Read-Joint
if ($existing -and (($existing.completed -and @($existing.completed).Count -gt 0) -or ($existing.started -and @($existing.started).Count -gt 0))) { throw 'Ja existe ativacao em andamento/concluida (joint-state.json). Execute -Rollback antes.' }
if (-not $AllowRunningCodex) {
 $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(codex|Codex|codex-command-runner.*|node_repl|cua-repl)$' })
 if ($running.Count -gt 0) { throw ('Processos Codex em execucao: ' + (($running | ForEach-Object { "$($_.ProcessName)#$($_.Id)" }) -join ', ') + '. Feche-os (ou use -AllowRunningCodex).') }
}
# checkpoint (SDDL) e estado ANTES de qualquer mutacao
$ts = Get-Date -Format yyyyMMdd-HHmmss; $ck = Join-Path $StateDir "checkpoint-$ts"; New-Item -ItemType Directory -Path $ck | Out-Null
$ckFile = Join-Path $ck 'sddl-checkpoint.json'; $map = [ordered]@{}
foreach ($p in (Snapshot-Paths)) { $map[$p] = (Get-Acl -LiteralPath $p).Sddl }
if (-not (Test-Path -LiteralPath $WorkspaceParent)) { $map[$WorkspaceParent] = $null }
($map | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $ckFile -Encoding UTF8
Set-Content -LiteralPath (Join-Path $ck 'HASH.txt') ("sddl-checkpoint.json SHA256=" + (Get-FileHash -LiteralPath $ckFile).Hash)
$state = [pscustomobject]@{ startedAt = (Get-Date -Format o); status = 'applying'; completed = @(); started = @(); parentCreated = $false; checkpoint = $ckFile }
Write-Joint $state
Log ("checkpoint: {0} ({1} caminhos)" -f $ckFile, $map.Count)
function Start-Step($n) { $state.started = @($state.started) + $n; Write-Joint $state }
function Mark($n) { $state.completed = @($state.completed) + $n; Write-Joint $state; if ($InjectFailureAtStep -eq $n) { throw "falha injetada apos o passo $n (teste)" } }
try {
 # passo 1
 Log 'passo 1: pai dos workspaces'; Start-Step 1
 if (Test-Path -LiteralPath $WorkspaceParent) { if (Is-Reparse $WorkspaceParent) { throw 'pai dos workspaces e um reparse point' } } else { $state.parentCreated = $true; Write-Joint $state; New-Item -ItemType Directory -Path $WorkspaceParent | Out-Null }
 $acl = Get-AclAccess $WorkspaceParent; $acl.SetAccessRuleProtection($true, $false)
 foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
 $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
 foreach ($id in @($me, (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'), (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
 }
 Set-AclAccess $WorkspaceParent $acl
 Mark 1
 # passo 2
 Log 'passo 2: A3'; Start-Step 2; Run-Acl 'a3' @('Apply'); if ($script:aclExit) { throw "A3 apply exit=$script:aclExit" }
 Mark 2
 # passo 3
 Log 'passo 3: CodexHome'; Start-Step 3; Run-Acl 'codex' @('Apply'); if ($script:aclExit) { throw "CodexHome apply exit=$script:aclExit" }
 Mark 3
 # passo 4
 Log 'passo 4: verify'; Run-Acl 'a3' @('Verify'); if ($script:aclExit) { throw 'verify A3 falhou' }
 Run-Acl 'codex' @('Verify'); if ($script:aclExit) { throw 'verify CodexHome falhou' }
 if ($InjectFailureAtStep -eq 4) { throw 'falha injetada apos o passo 4 (teste)' }
 $state.status = 'active'; Write-Joint $state
 Log 'ATIVO. Para desfazer: -Rollback (mesmos parametros de caminho). Reverta no mesmo ato da prova.'
 exit 0
} catch {
 Log ("ERRO: {0}" -f $_.Exception.Message)
 $e = Do-Rollback $state 'falha automatica'
 if ($e -gt 0) { exit 3 } else { exit 1 }
}
