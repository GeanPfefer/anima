#requires -Version 5.1
<#
 Modelo A3 de isolamento por ACL para o executor/gates sob o sandbox do Codex (grupo local CodexSandboxUsers; usuario CodexSandboxOffline).

 O sandbox do Codex (token com escrita restrita) ja impede criar/sobrescrever/excluir/renomear FORA do workspace, mas NAO impede LEITURA.
 Este script fecha a leitura e a listagem do checkout principal, inclusive .git, segredos e codigo do control plane:

   1. DENY FullControl herdavel para o grupo na RAIZ do checkout protegido (leitura, listagem, escrita, exclusao, renomeacao).
   2. ALLOW Modify herdavel, EXPLICITO, no pai dos workspaces de execucao (novos workspaces herdam; ACE explicita precede a ACE herdada de negacao).
   3. ALLOW ReadAndExecute herdavel, EXPLICITO, em cada node_modules (as junctions criadas pelo Host apontam para la).
   4. DENY Read explicito em cada arquivo de segredo e, com -IncludeCodexAuth, no auth.json do Codex (defesa em profundidade).

 PADRAO = SIMULACAO (nao altera nada). -Apply aplica; -Verify confere (ACEs, ordem canonica e, com -ProbeCodexPath, o acesso EFETIVO sob o
 sandbox real); -Revert (com -Apply) remove SOMENTE as ACEs que este script realmente adicionou, registradas em -StatePath, preservando as
 ACEs preexistentes (inclusive ACE identica ja existente: ela e marcada "preexistente" e nunca removida).
 ATO DO OPERADOR: o ANIMA nao executa este script. Com -Repo G:\anima exige tambem -AllowProductionRepo.

 Avisos operacionais:
   - A propagacao da ACE herdavel percorre a arvore inteira do checkout (node_modules incluso): pode levar minutos.
   - Aplicado ao checkout em uso, o grupo do sandbox deixa de ler esse checkout: sessoes interativas do Codex que usam o sandbox do Windows
     naquele diretorio deixam de funcionar (o launcher WSL do runbook nao usa esse grupo). Prefira um pai de workspaces dedicado
     (ANIMA_WORKTREE_PARENT) e leia o relatorio antes de aplicar.
   - Se o pai dos workspaces estiver DENTRO do checkout (padrao .worktrees), todos os worktrees ali passam a ser legiveis pelo grupo.
#>
[CmdletBinding()]
param(
 [string]$Repo = 'G:\anima',
 [string]$WorkspaceParent,
 [string[]]$Dependencies,
 [string[]]$SecretFiles,
 [string]$Group = 'CodexSandboxUsers',
 [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'Anima\gate-isolation-acl-state.json'),
 [switch]$Apply, [switch]$Revert, [switch]$Verify,
 [switch]$IncludeCodexAuth,
 [switch]$AllowProductionRepo,
 [string]$ProbeCodexPath,
 [string]$ProbeNodePath = 'C:\Program Files\nodejs\node.exe'
)
$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath($Repo).TrimEnd('\')
if (-not $WorkspaceParent) { $WorkspaceParent = Join-Path $Repo '.worktrees' }
$WorkspaceParent = [IO.Path]::GetFullPath($WorkspaceParent).TrimEnd('\')
if ($Apply -and $Repo -ieq 'G:\anima' -and -not $AllowProductionRepo) { throw 'Alvo e o checkout de producao: exige -AllowProductionRepo (ato explicito do operador).' }
if ($WorkspaceParent -ieq $Repo) { throw 'WorkspaceParent nao pode ser a propria raiz protegida.' }

$R_Full = [System.Security.AccessControl.FileSystemRights]::FullControl
$R_Modify = [System.Security.AccessControl.FileSystemRights]::Modify
$R_RX = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
$R_Read = [System.Security.AccessControl.FileSystemRights]::Read
$I_Tree = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$I_None = [System.Security.AccessControl.InheritanceFlags]::None
$P_None = [System.Security.AccessControl.PropagationFlags]::None
$T_Allow = [System.Security.AccessControl.AccessControlType]::Allow
$T_Deny = [System.Security.AccessControl.AccessControlType]::Deny
$account = New-Object System.Security.Principal.NTAccount($env:COMPUTERNAME, $Group)
$sid = $account.Translate([System.Security.Principal.SecurityIdentifier])

if (-not $Dependencies) {
 $Dependencies = @("$Repo\node_modules") + @(Get-ChildItem "$Repo\apps", "$Repo\packages" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'node_modules' })
}
$Dependencies = @($Dependencies | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
if (-not $SecretFiles) { $SecretFiles = @("$Repo\apps\web\.env.local", "$Repo\apps\mobile\.env.local", "$Repo\supabase\.env") }
if ($IncludeCodexAuth) { $SecretFiles += (Join-Path $env:USERPROFILE '.codex\auth.json') }
$SecretFiles = @($SecretFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })

# Regras planejadas (ordem de aplicacao). Rights/flags sao exatamente o que sera gravado.
$planned = New-Object System.Collections.ArrayList
function Add-Plan($path, $kind, $rights, $inherit, $type) { [void]$planned.Add([pscustomobject]@{ Path = $path; Kind = $kind; Rights = $rights; Inherit = $inherit; Type = $type }) }
Add-Plan $Repo 'deny-tree' $R_Full $I_Tree $T_Deny
Add-Plan $WorkspaceParent 'allow-workspace' $R_Modify $I_Tree $T_Allow
foreach ($d in $Dependencies) { Add-Plan $d 'allow-deps' $R_RX $I_Tree $T_Allow }
foreach ($s in $SecretFiles) { Add-Plan $s 'deny-secret' $R_Read $I_None $T_Deny }

function New-Rule($p) { New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $p.Rights, $p.Inherit, $P_None, $p.Type) }
function Get-Sid($identity) { $identity.Translate([System.Security.Principal.SecurityIdentifier]).Value }
function Test-SameRule($existing, $p) {
 (-not $existing.IsInherited) -and (Get-Sid $existing.IdentityReference) -eq $sid.Value `
  -and $existing.AccessControlType -eq $p.Type -and (([int]$existing.FileSystemRights -band 0x1FFFFF) -bor 0x100000) -eq (([int]$p.Rights -band 0x1FFFFF) -bor 0x100000) `
  -and $existing.InheritanceFlags -eq $p.Inherit -and $existing.PropagationFlags -eq $P_None
}
function Find-Rule($path, $p) { (Get-Acl -LiteralPath $path).Access | Where-Object { Test-SameRule $_ $p } | Select-Object -First 1 }
function Read-State { if (Test-Path -LiteralPath $StatePath) { @(Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json) } else { @() } }
function Write-State($entries) {
 $dir = Split-Path $StatePath; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
 $tmp = "$StatePath.tmp"; ConvertTo-Json -InputObject @($entries) -Depth 5 | Set-Content -LiteralPath $tmp -Encoding UTF8; Move-Item -LiteralPath $tmp -Destination $StatePath -Force
}
function Describe($p) { '{0,-16} {1,-5} {2,-24} {3}' -f $p.Kind, $p.Type, $p.Rights, $p.Path }

Write-Output ("Grupo: {0} ({1})  Repo: {2}  Pai dos workspaces: {3}" -f $Group, $sid.Value, $Repo, $WorkspaceParent)
Write-Output ("Estado: {0}" -f $StatePath)
if ($WorkspaceParent.StartsWith($Repo + '\', [StringComparison]::OrdinalIgnoreCase)) { Write-Output 'AVISO: pai dos workspaces DENTRO do checkout protegido (todos os worktrees ali ficam legiveis pelo grupo).' }

if ($Verify) {
 $bad = 0
 foreach ($p in $planned) {
  if (-not (Test-Path -LiteralPath $p.Path)) { Write-Output ("[AUSENTE]  {0}" -f (Describe $p)); $bad++; continue }
  $found = Find-Rule $p.Path $p
  if (-not $found) { $bad++ }
  Write-Output ("[{0}] {1}" -f $(if ($found) { 'PRESENTE ' } else { 'FALTANDO ' }), (Describe $p))
 }
 # Ordem canonica no pai dos workspaces: a ACE explicita de ALLOW tem de vir ANTES de qualquer DENY herdada para o grupo.
 if (Test-Path -LiteralPath $WorkspaceParent) {
  $acl = @((Get-Acl -LiteralPath $WorkspaceParent).Access | Where-Object { (Get-Sid $_.IdentityReference) -eq $sid.Value })
  $firstAllow = -1; $firstInhDeny = -1
  for ($i = 0; $i -lt $acl.Count; $i++) {
   if ($acl[$i].AccessControlType -eq $T_Allow -and -not $acl[$i].IsInherited -and $firstAllow -lt 0) { $firstAllow = $i }
   if ($acl[$i].AccessControlType -eq $T_Deny -and $acl[$i].IsInherited -and $firstInhDeny -lt 0) { $firstInhDeny = $i }
  }
  if ($firstInhDeny -ge 0 -and ($firstAllow -lt 0 -or $firstAllow -gt $firstInhDeny)) { Write-Output '[ORDEM] FALHA: ALLOW explicito nao precede a DENY herdada no pai dos workspaces.'; $bad++ } else { Write-Output '[ORDEM] ok: ALLOW explicito precede a DENY herdada (ou nao ha DENY herdada).' }
 }
 # Acesso EFETIVO sob o sandbox real do Codex.
 if ($ProbeCodexPath) {
  if (-not (Test-Path -LiteralPath $ProbeCodexPath)) { throw "ProbeCodexPath inexistente: $ProbeCodexPath" }
  $canary = Join-Path $WorkspaceParent (".acl-probe-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $canary | Out-Null
  try {
   $secret = $SecretFiles | Select-Object -First 1; $dep = $Dependencies | Select-Object -First 1
   $js = Join-Path $canary 'probe.js'
   $lines = @(
    "const fs=require('fs'),p=require('path');const o={};const t=(n,f)=>{try{f();o[n]='ALLOWED'}catch(e){o[n]='DENIED'}};",
    ("t('read_secret',()=>fs.readFileSync({0},'utf8'));" -f (ConvertTo-Json "$secret")),
    ("t('list_repo',()=>fs.readdirSync({0}));" -f (ConvertTo-Json $Repo)),
    ("t('read_git',()=>fs.readFileSync(p.join({0},'.git','HEAD'),'utf8'));" -f (ConvertTo-Json $Repo)),
    ("t('write_repo',()=>fs.writeFileSync(p.join({0},'ACL-PROBE.txt'),'x'));" -f (ConvertTo-Json $Repo)),
    ("t('list_deps',()=>fs.readdirSync({0}));" -f (ConvertTo-Json "$dep")),
    ("t('write_deps',()=>fs.writeFileSync(p.join({0},'ACL-PROBE.txt'),'x'));" -f (ConvertTo-Json "$dep")),
    "t('write_workspace',()=>{fs.writeFileSync(p.join(process.cwd(),'ok.txt'),'legit');fs.readFileSync(p.join(process.cwd(),'ok.txt'),'utf8')});",
    "console.log(JSON.stringify(o));")
   Set-Content -LiteralPath $js -Value $lines -Encoding ASCII
   $out = Join-Path $canary 'probe.out'
   cmd /c ('"{0}" sandbox -P :workspace -C "{1}" -- "{2}" "{3}" > "{4}" 2>&1' -f $ProbeCodexPath, $canary, $ProbeNodePath, $js, $out)
   $json = (Get-Content -LiteralPath $out | Select-Object -Last 1)
   try { $r = $json | ConvertFrom-Json } catch { throw "Sonda sem resultado JSON: $json" }
   $expect = [ordered]@{ read_secret = 'DENIED'; list_repo = 'DENIED'; read_git = 'DENIED'; write_repo = 'DENIED'; list_deps = 'ALLOWED'; write_deps = 'DENIED'; write_workspace = 'ALLOWED' }
   foreach ($k in $expect.Keys) {
    $ok = ($r.$k -eq $expect[$k]); if (-not $ok) { $bad++ }
    Write-Output ("[EFETIVO {0}] {1,-16} esperado={2,-7} obtido={3}" -f $(if ($ok) { 'ok   ' } else { 'FALHA' }), $k, $expect[$k], $r.$k)
   }
  } finally { Remove-Item -LiteralPath $canary -Recurse -Force -ErrorAction SilentlyContinue }
 }
 Write-Output ("Verificacao: {0}" -f $(if ($bad -eq 0) { 'OK' } else { "$bad problema(s)" }))
 if ($bad -gt 0) { exit 1 } else { exit 0 }
}

if ($Revert) {
 $state = Read-State
 if (-not $state) { Write-Output 'Nada registrado em -StatePath: nada a reverter.'; exit 0 }
 $keep = New-Object System.Collections.ArrayList
 foreach ($e in $state) {
  if (-not $e.Added) { Write-Output ("[preexistente, mantido] {0} {1}" -f $e.Kind, $e.Path); continue }
  $p = [pscustomobject]@{ Path = $e.Path; Kind = $e.Kind; Rights = [System.Security.AccessControl.FileSystemRights][int]$e.Rights; Inherit = [System.Security.AccessControl.InheritanceFlags][int]$e.Inherit; Type = [System.Security.AccessControl.AccessControlType][int]$e.Type }
  if (-not $Apply) { Write-Output ("[simulacao] removeria: {0}" -f (Describe $p)); [void]$keep.Add($e); continue }
  if (Test-Path -LiteralPath $e.Path) {
   $acl = Get-Acl -LiteralPath $e.Path
   $match = $acl.Access | Where-Object { Test-SameRule $_ $p } | Select-Object -First 1
   if ($match) { [void]$acl.RemoveAccessRuleSpecific($match); Set-Acl -LiteralPath $e.Path -AclObject $acl }
   if ($match -and -not (Find-Rule $e.Path $p)) { Write-Output ("revertido: {0}" -f (Describe $p)); continue }
  }
  Write-Output ("[NAO REVERTIDO: regra nao encontrada/ainda presente] {0}" -f (Describe $p)); [void]$keep.Add($e)
 }
 if ($Apply) {
  if ($keep.Count -eq 0) { if (Test-Path -LiteralPath $StatePath) { Move-Item -LiteralPath $StatePath -Destination "$StatePath.reverted-$(Get-Date -Format yyyyMMddHHmmss)" } } else { Write-State $keep }
 }
 exit 0
}

# Aplicacao / simulacao
$state = New-Object System.Collections.ArrayList; foreach ($e in (Read-State)) { [void]$state.Add($e) }
foreach ($p in $planned) {
 if (-not (Test-Path -LiteralPath $p.Path)) { Write-Output ("[ausente, ignorado] {0}" -f (Describe $p)); continue }
 $already = Find-Rule $p.Path $p
 $recorded = $state | Where-Object { $_.Path -ieq $p.Path -and $_.Kind -eq $p.Kind } | Select-Object -First 1
 if (-not $Apply) { Write-Output ("[simulacao] {0}  {1}" -f $(if ($already) { 'ja existe' } else { 'aplicaria ' }), (Describe $p)); continue }
 if ($already) {
  if (-not $recorded) { [void]$state.Add([pscustomobject]@{ Path = $p.Path; Kind = $p.Kind; Rights = [int]$p.Rights; Inherit = [int]$p.Inherit; Type = [int]$p.Type; Added = $false; SddlBefore = (Get-Acl -LiteralPath $p.Path).Sddl }); Write-State $state }
  Write-Output ("ja existia: {0}" -f (Describe $p)); continue
 }
 $acl = Get-Acl -LiteralPath $p.Path; $before = $acl.Sddl
 $acl.AddAccessRule((New-Rule $p)); Set-Acl -LiteralPath $p.Path -AclObject $acl
 if (-not (Find-Rule $p.Path $p)) { throw ("Falha ao gravar a ACE (nao encontrada apos Set-Acl): " + (Describe $p)) }
 [void]$state.Add([pscustomobject]@{ Path = $p.Path; Kind = $p.Kind; Rights = [int]$p.Rights; Inherit = [int]$p.Inherit; Type = [int]$p.Type; Added = $true; SddlBefore = $before })
 Write-State $state   # grava a cada ACE: uma interrupcao deixa o registro fiel ao que foi feito
 Write-Output ("aplicado: {0}" -f (Describe $p))
}
