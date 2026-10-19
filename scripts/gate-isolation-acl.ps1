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

 -CodexHome <dir> (opcional; nenhuma ativacao implicita): protege a raiz do diretorio do Codex (CODEX_HOME, normalmente %USERPROFILE%\.codex).
   O grupo do sandbox tem ReadAndExecute herdado em tudo ali (auth.json, historico, sessoes, config...). O script
     1. garante (e, se faltar, adiciona) ALLOW explicito herdavel em .sandbox-bin (ReadAndExecute) e .sandbox (Modify) - os dois diretorios que o
        sandbox usa; ACE ja existente que os COBRE e mantida e marcada "preexistente";
     2. so entao grava UM DENY FullControl herdavel para o grupo na raiz. ALLOW explicito dos filhos precede o DENY herdado (provado e conferido por -Verify).
   -CodexHomeOnly aplica somente isso (sem as regras do checkout). Validacao fail-closed: caminho absoluto de unidade (sem relativo/UNC/".."),
   nao a raiz do volume, diretorio real SEM reparse point na cadeia, com .sandbox-bin, que nao contenha nem esteja contido em -Repo/-WorkspaceParent.
   -Apply no ~/.codex real exige -AllowRealCodexHome. O script nunca segue links: um carve-out que virou reparse point e recusado na reversao
   (a negacao da raiz ainda e removida). -Verify confere ACEs, ordem, filhos com heranca desabilitada, ausencia de ALLOW de escrita do grupo na raiz
   e, com -ProbeCodexPath, o acesso efetivo sob o sandbox real (apenas ABRE handles/lista diretorios; nenhum byte de credencial e lido);
   -ProbeSandboxBinExe <nome> tambem executa esse binario de .sandbox-bin (--version) sob a negacao.
   Reversao (-Revert -Apply) usa a API .NET e remove so o que o script adicionou (StatePath); NUNCA icacls /remove:d, que apaga tambem o ALLOW do grupo.
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
 [string]$ProbeNodePath = 'C:\Program Files\nodejs\node.exe',
 # Opcional (nenhuma ativacao implicita): protege a raiz do diretorio do Codex (CODEX_HOME) contra o grupo do sandbox.
 [string]$CodexHome,
 [switch]$CodexHomeOnly,
 [switch]$AllowRealCodexHome,
 [string]$ProbeSandboxBinExe
)
$ErrorActionPreference = 'Stop'
if ($CodexHomeOnly -and -not $CodexHome) { throw '-CodexHomeOnly exige -CodexHome.' }
$doRepo = -not $CodexHomeOnly
$Repo = [IO.Path]::GetFullPath($Repo).TrimEnd('\')
if (-not $WorkspaceParent) { $WorkspaceParent = Join-Path $Repo '.worktrees' }
$WorkspaceParent = [IO.Path]::GetFullPath($WorkspaceParent).TrimEnd('\')
if ($doRepo -and $Apply -and $Repo -ieq 'G:\anima' -and -not $AllowProductionRepo) { throw 'Alvo e o checkout de producao: exige -AllowProductionRepo (ato explicito do operador).' }
if ($doRepo -and $WorkspaceParent -ieq $Repo) { throw 'WorkspaceParent nao pode ser a propria raiz protegida.' }

# --- Validacao do CodexHome: diretorio REAL, absoluto, sem links (nem nos ancestrais), com os diretorios operacionais do sandbox ---
function Test-IsReparse($path) { (([IO.File]::GetAttributes($path)) -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
function Assert-NoReparseChain($full, $label) {
 $root = [IO.Path]::GetPathRoot($full); $cur = $root
 foreach ($part in ($full.Substring($root.Length) -split '\\' | Where-Object { $_ })) {
  $cur = Join-Path $cur $part
  if (Test-Path -LiteralPath $cur) { if (Test-IsReparse $cur) { throw "$label recusado: '$cur' e um reparse point (symlink/junction)." } }
 }
}
function Resolve-CodexHome($raw) {
 if ($raw -notmatch '^[A-Za-z]:[\\/]') { throw 'CodexHome deve ser caminho absoluto de unidade local (sem relativo, sem UNC).' }
 if (($raw -split '[\\/]') -contains '..') { throw 'CodexHome com segmento ".." recusado.' }
 if ($raw -match '[<>"|?*\0]') { throw 'CodexHome com caracteres invalidos.' }
 $full = [IO.Path]::GetFullPath($raw).TrimEnd('\')
 if ($full.Length -le 3) { throw 'CodexHome nao pode ser a raiz de um volume.' }
 if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "CodexHome inexistente ou nao e diretorio: $full" }
 Assert-NoReparseChain $full 'CodexHome'
 # Na reversao a raiz continua sendo validada (formato, links, ancestrais), mas os carve-outs nao: se algum virou link, o item e recusado
 # individualmente e a negacao da raiz ainda pode ser removida.
 if (-not $Revert) {
  $bin = Join-Path $full '.sandbox-bin'
  if (-not (Test-Path -LiteralPath $bin -PathType Container)) { throw 'CodexHome sem .sandbox-bin (o carve-out operacional nao existe): destino inesperado, recusado.' }
  foreach ($carve in '.sandbox-bin', '.sandbox') { $c = Join-Path $full $carve; if ((Test-Path -LiteralPath $c) -and (Test-IsReparse $c)) { throw "$carve e um reparse point: recusado." } }
 }
 $under = { param($a, $b) $a.Equals($b, [StringComparison]::OrdinalIgnoreCase) -or $a.StartsWith($b + '\', [StringComparison]::OrdinalIgnoreCase) }
 foreach ($other in @($Repo, $WorkspaceParent)) {
  if ($doRepo -or $other -ne $Repo) { if ((& $under $full $other) -or (& $under $other $full)) { throw "CodexHome e '$other' nao podem conter um ao outro (a negacao herdavel engoliria o outro)." } }
 }
 if ($Apply -and ($full -ieq (Join-Path $env:USERPROFILE '.codex')) -and -not $AllowRealCodexHome) { throw 'Alvo e o ~/.codex real: exige -AllowRealCodexHome (ato explicito do operador).' }
 $full
}
if ($CodexHome) { $CodexHome = Resolve-CodexHome $CodexHome }

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

if ($doRepo) {
 if (-not $Dependencies) {
  $Dependencies = @("$Repo\node_modules") + @(Get-ChildItem "$Repo\apps", "$Repo\packages" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'node_modules' })
 }
 $Dependencies = @($Dependencies | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
 if (-not $SecretFiles) { $SecretFiles = @("$Repo\apps\web\.env.local", "$Repo\apps\mobile\.env.local", "$Repo\supabase\.env") }
 if ($IncludeCodexAuth) { $SecretFiles += (Join-Path $env:USERPROFILE '.codex\auth.json') }
 $SecretFiles = @($SecretFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
} else { $Dependencies = @(); $SecretFiles = @() }

# Regras planejadas (ordem de aplicacao). Rights/flags sao exatamente o que sera gravado.
# Cover = a regra e um carve-out: vale como satisfeita se ja existe ACE explicita de ALLOW do grupo que a COBRE (direitos superiores, herdavel).
$planned = New-Object System.Collections.ArrayList
function Add-Plan($path, $kind, $rights, $inherit, $type, [bool]$cover = $false) { [void]$planned.Add([pscustomobject]@{ Path = $path; Kind = $kind; Rights = $rights; Inherit = $inherit; Type = $type; Cover = $cover }) }
if ($doRepo) {
 Add-Plan $Repo 'deny-tree' $R_Full $I_Tree $T_Deny
 Add-Plan $WorkspaceParent 'allow-workspace' $R_Modify $I_Tree $T_Allow
 foreach ($d in $Dependencies) { Add-Plan $d 'allow-deps' $R_RX $I_Tree $T_Allow }
 foreach ($s in $SecretFiles) { Add-Plan $s 'deny-secret' $R_Read $I_None $T_Deny }
}
if ($CodexHome) {
 # Carve-outs ANTES da negacao: em nenhum instante o sandbox fica sem os diretorios que o Codex mantem para ele.
 Add-Plan (Join-Path $CodexHome '.sandbox-bin') 'allow-codex-sandbox-bin' $R_RX $I_Tree $T_Allow $true
 if (Test-Path -LiteralPath (Join-Path $CodexHome '.sandbox') -PathType Container) { Add-Plan (Join-Path $CodexHome '.sandbox') 'allow-codex-sandbox' $R_Modify $I_Tree $T_Allow $true }
 Add-Plan $CodexHome 'deny-codexhome' $R_Full $I_Tree $T_Deny
}

function New-Rule($p) { New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $p.Rights, $p.Inherit, $P_None, $p.Type) }
function Get-Sid($identity) { $identity.Translate([System.Security.Principal.SecurityIdentifier]).Value }
function Test-SameRule($existing, $p) {
 (-not $existing.IsInherited) -and (Get-Sid $existing.IdentityReference) -eq $sid.Value `
  -and $existing.AccessControlType -eq $p.Type -and (([int]$existing.FileSystemRights -band 0x1FFFFF) -bor 0x100000) -eq (([int]$p.Rights -band 0x1FFFFF) -bor 0x100000) `
  -and $existing.InheritanceFlags -eq $p.Inherit -and $existing.PropagationFlags -eq $P_None
}
function Find-Rule($path, $p) { (Get-Acl -LiteralPath $path).Access | Where-Object { Test-SameRule $_ $p } | Select-Object -First 1 }
# Carve-out coberto: ALLOW explicito do grupo, herdavel (CI+OI), cujos direitos incluem todos os bits exigidos.
function Test-CoverRule($existing, $p) {
 $need = ([int]$p.Rights -band 0x1FFFFF) -bor 0x100000; $have = ([int]$existing.FileSystemRights -band 0x1FFFFF) -bor 0x100000
 (-not $existing.IsInherited) -and (Get-Sid $existing.IdentityReference) -eq $sid.Value -and $existing.AccessControlType -eq $p.Type `
  -and ($have -band $need) -eq $need -and ($existing.InheritanceFlags -band $p.Inherit) -eq $p.Inherit
}
function Find-Planned($p) {
 if ($p.Cover) { (Get-Acl -LiteralPath $p.Path).Access | Where-Object { Test-CoverRule $_ $p } | Select-Object -First 1 } else { Find-Rule $p.Path $p }
}
function Assert-NotReparse($path) { if ((Test-Path -LiteralPath $path) -and (Test-IsReparse $path)) { throw "Recusado: '$path' e um reparse point; o script nao segue links." } }
function Read-State { if (Test-Path -LiteralPath $StatePath) { @(Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json) } else { @() } }
function Write-State($entries) {
 $dir = Split-Path $StatePath; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
 $tmp = "$StatePath.tmp"; ConvertTo-Json -InputObject @($entries) -Depth 5 | Set-Content -LiteralPath $tmp -Encoding UTF8; Move-Item -LiteralPath $tmp -Destination $StatePath -Force
}
function Describe($p) { '{0,-16} {1,-5} {2,-24} {3}' -f $p.Kind, $p.Type, $p.Rights, $p.Path }

if ($doRepo) { Write-Output ("Grupo: {0} ({1})  Repo: {2}  Pai dos workspaces: {3}" -f $Group, $sid.Value, $Repo, $WorkspaceParent) } else { Write-Output ("Grupo: {0} ({1})  (somente CodexHome)" -f $Group, $sid.Value) }
if ($CodexHome) { Write-Output ("CodexHome: {0}" -f $CodexHome) }
Write-Output ("Estado: {0}" -f $StatePath)
if ($doRepo -and $WorkspaceParent.StartsWith($Repo + '\', [StringComparison]::OrdinalIgnoreCase)) { Write-Output 'AVISO: pai dos workspaces DENTRO do checkout protegido (todos os worktrees ali ficam legiveis pelo grupo).' }

if ($Verify) {
 $bad = 0
 foreach ($p in $planned) {
  if (-not (Test-Path -LiteralPath $p.Path)) { Write-Output ("[AUSENTE]  {0}" -f (Describe $p)); $bad++; continue }
  $found = Find-Planned $p
  if (-not $found) { $bad++ }
  Write-Output ("[{0}] {1}" -f $(if ($found) { 'PRESENTE ' } else { 'FALTANDO ' }), (Describe $p))
 }
 # Ordem canonica no pai dos workspaces: a ACE explicita de ALLOW tem de vir ANTES de qualquer DENY herdada para o grupo.
 if ($doRepo -and (Test-Path -LiteralPath $WorkspaceParent)) {
  $acl = @((Get-Acl -LiteralPath $WorkspaceParent).Access | Where-Object { (Get-Sid $_.IdentityReference) -eq $sid.Value })
  $firstAllow = -1; $firstInhDeny = -1
  for ($i = 0; $i -lt $acl.Count; $i++) {
   if ($acl[$i].AccessControlType -eq $T_Allow -and -not $acl[$i].IsInherited -and $firstAllow -lt 0) { $firstAllow = $i }
   if ($acl[$i].AccessControlType -eq $T_Deny -and $acl[$i].IsInherited -and $firstInhDeny -lt 0) { $firstInhDeny = $i }
  }
  if ($firstInhDeny -ge 0 -and ($firstAllow -lt 0 -or $firstAllow -gt $firstInhDeny)) { Write-Output '[ORDEM] FALHA: ALLOW explicito nao precede a DENY herdada no pai dos workspaces.'; $bad++ } else { Write-Output '[ORDEM] ok: ALLOW explicito precede a DENY herdada (ou nao ha DENY herdada).' }
 }
 # CodexHome: ordem dos carve-outs, propagacao da negacao e ausencia de ampliacao inesperada (somente metadados; nenhum arquivo e aberto).
 if ($CodexHome) {
  Assert-NotReparse $CodexHome
  foreach ($p in ($planned | Where-Object { $_.Cover })) {
   if (-not (Test-Path -LiteralPath $p.Path)) { continue }
   Assert-NotReparse $p.Path
   $acl = @((Get-Acl -LiteralPath $p.Path).Access | Where-Object { (Get-Sid $_.IdentityReference) -eq $sid.Value })
   $firstAllow = -1; $firstInhDeny = -1
   for ($i = 0; $i -lt $acl.Count; $i++) {
    if ($acl[$i].AccessControlType -eq $T_Allow -and -not $acl[$i].IsInherited -and $firstAllow -lt 0) { $firstAllow = $i }
    if ($acl[$i].AccessControlType -eq $T_Deny -and $acl[$i].IsInherited -and $firstInhDeny -lt 0) { $firstInhDeny = $i }
   }
   if ($firstInhDeny -ge 0 -and ($firstAllow -lt 0 -or $firstAllow -gt $firstInhDeny)) { Write-Output ("[ORDEM] FALHA: ALLOW explicito nao precede a DENY herdada em {0}" -f $p.Path); $bad++ } else { Write-Output ("[ORDEM] ok: {0}" -f (Split-Path $p.Path -Leaf)) }
  }
  # Filhos diretos com heranca desabilitada NAO recebem a negacao: seguem legiveis.
  foreach ($child in (Get-ChildItem -LiteralPath $CodexHome -Force)) {
   if (@('.sandbox', '.sandbox-bin') -contains $child.Name) { continue }
   if ((Get-Acl -LiteralPath $child.FullName).AreAccessRulesProtected) { Write-Output ("[PROPAGACAO] FALHA: '{0}' tem heranca desabilitada (a negacao nao chega)." -f $child.Name); $bad++ }
  }
  # Ampliacao inesperada: o grupo nao pode ter ALLOW explicito de escrita na raiz do CodexHome.
  $broad = @((Get-Acl -LiteralPath $CodexHome).Access | Where-Object { (Get-Sid $_.IdentityReference) -eq $sid.Value -and $_.AccessControlType -eq $T_Allow -and -not $_.IsInherited -and (([int]$_.FileSystemRights) -band 0x40116) -ne 0 })
  if ($broad.Count -gt 0) { Write-Output '[AMPLIACAO] FALHA: o grupo tem ALLOW de escrita explicito na raiz do CodexHome.'; $bad++ } else { Write-Output '[AMPLIACAO] ok: sem ALLOW de escrita do grupo na raiz do CodexHome.' }
 }
 # Acesso EFETIVO sob o sandbox real do Codex.
 if ($ProbeCodexPath) {
  if (-not (Test-Path -LiteralPath $ProbeCodexPath)) { throw "ProbeCodexPath inexistente: $ProbeCodexPath" }
  if (-not (Test-Path -LiteralPath $WorkspaceParent -PathType Container)) { throw "A sonda precisa de um pai de workspaces existente (-WorkspaceParent): $WorkspaceParent" }
  $canary = Join-Path $WorkspaceParent (".acl-probe-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $canary | Out-Null
  try {
   $js = Join-Path $canary 'probe.js'
   $lines = @("const fs=require('fs'),p=require('path');const o={};const t=(n,f)=>{try{f();o[n]='ALLOWED'}catch(e){o[n]='DENIED'}};")
   $expect = [ordered]@{}
   if ($doRepo) {
    $secret = $SecretFiles | Select-Object -First 1; $dep = $Dependencies | Select-Object -First 1
    $lines += @(
     ("t('read_secret',()=>fs.readFileSync({0},'utf8'));" -f (ConvertTo-Json "$secret")),
     ("t('list_repo',()=>fs.readdirSync({0}));" -f (ConvertTo-Json $Repo)),
     ("t('read_git',()=>fs.readFileSync(p.join({0},'.git','HEAD'),'utf8'));" -f (ConvertTo-Json $Repo)),
     ("t('write_repo',()=>fs.writeFileSync(p.join({0},'ACL-PROBE.txt'),'x'));" -f (ConvertTo-Json $Repo)),
     ("t('list_deps',()=>fs.readdirSync({0}));" -f (ConvertTo-Json "$dep")),
     ("t('write_deps',()=>fs.writeFileSync(p.join({0},'ACL-PROBE.txt'),'x'));" -f (ConvertTo-Json "$dep")))
    foreach ($kv in @(@('read_secret', 'DENIED'), @('list_repo', 'DENIED'), @('read_git', 'DENIED'), @('write_repo', 'DENIED'), @('list_deps', 'ALLOWED'), @('write_deps', 'DENIED'))) { $expect[$kv[0]] = $kv[1] }
   }
   if ($CodexHome) {
    # Somente ABRE o handle (nenhum byte e lido) / lista diretorios: serve tanto para a replica ficticia quanto para o ~/.codex real.
    $lines += ("const H={0};" -f (ConvertTo-Json $CodexHome))
    $lines += "const opn=(f)=>fs.closeSync(fs.openSync(p.join(H,f),'r'));"
    $lines += "t('codexhome_list',()=>fs.readdirSync(H));"
    foreach ($name in 'auth.json', 'config.toml', 'thread_history_1.sqlite', 'state_5.sqlite', 'logs_2.sqlite', 'session_index.jsonl') {
     if (Test-Path -LiteralPath (Join-Path $CodexHome $name) -PathType Leaf) { $lines += ("t('open_{0}',()=>opn({1}));" -f $name, (ConvertTo-Json $name)); $expect["open_$name"] = 'DENIED' }
    }
    foreach ($name in 'sessions', 'archived_sessions', 'attachments', 'secrets') {
     if (Test-Path -LiteralPath (Join-Path $CodexHome $name) -PathType Container) { $lines += ("t('list_{0}',()=>fs.readdirSync(p.join(H,{1})));" -f $name, (ConvertTo-Json $name)); $expect["list_$name"] = 'DENIED' }
    }
    $lines += "t('sandbox_bin_list',()=>fs.readdirSync(p.join(H,'.sandbox-bin')));"
    $expect['codexhome_list'] = 'DENIED'; $expect['sandbox_bin_list'] = 'ALLOWED'
   }
   $lines += "t('write_workspace',()=>{fs.writeFileSync(p.join(process.cwd(),'ok.txt'),'legit');fs.readFileSync(p.join(process.cwd(),'ok.txt'),'utf8')});"
   $expect['write_workspace'] = 'ALLOWED'
   $lines += "console.log(JSON.stringify(o));"
   Set-Content -LiteralPath $js -Value $lines -Encoding ASCII
   $out = Join-Path $canary 'probe.out'
   cmd /c ('"{0}" sandbox -P :workspace -C "{1}" -- "{2}" "{3}" > "{4}" 2>&1' -f $ProbeCodexPath, $canary, $ProbeNodePath, $js, $out)
   $json = (Get-Content -LiteralPath $out | Select-Object -Last 1)
   try { $r = $json | ConvertFrom-Json } catch { throw "Sonda sem resultado JSON: $json" }
   if ($CodexHome -and $ProbeSandboxBinExe) {
    # Executar um binario do carve-out sob a negacao da raiz (o runner do Codex mora ali): --version deve sair com 0.
    $exe = Join-Path (Join-Path $CodexHome '.sandbox-bin') $ProbeSandboxBinExe
    $out2 = Join-Path $canary 'exec.out'
    cmd /c ('"{0}" sandbox -P :workspace -C "{1}" -- "{2}" --version > "{3}" 2>&1' -f $ProbeCodexPath, $canary, $exe, $out2)
    $execOk = ($LASTEXITCODE -eq 0)
    $r | Add-Member -NotePropertyName exec_sandbox_bin -NotePropertyValue $(if ($execOk) { 'ALLOWED' } else { 'DENIED' }) -Force
    $expect['exec_sandbox_bin'] = 'ALLOWED'
   }
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
  if ((Test-Path -LiteralPath $e.Path) -and (Test-IsReparse $e.Path)) { Write-Output ("[NAO REVERTIDO: o caminho agora e um reparse point; o script nao segue links] {0}" -f (Describe $p)); [void]$keep.Add($e); continue }
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
 Assert-NotReparse $p.Path
 $already = Find-Planned $p
 $recorded = $state | Where-Object { $_.Path -ieq $p.Path -and $_.Kind -eq $p.Kind } | Select-Object -First 1
 if (-not $Apply) { Write-Output ("[simulacao] {0}  {1}" -f $(if ($already) { 'ja existe' } else { 'aplicaria ' }), (Describe $p)); continue }
 if ($already) {
  if (-not $recorded) { [void]$state.Add([pscustomobject]@{ Path = $p.Path; Kind = $p.Kind; Rights = [int]$p.Rights; Inherit = [int]$p.Inherit; Type = [int]$p.Type; Added = $false; SddlBefore = (Get-Acl -LiteralPath $p.Path).Sddl }); Write-State $state }
  Write-Output ("ja existia{0}: {1}" -f $(if ($p.Cover) { ' (carve-out coberto)' } else { '' }), (Describe $p)); continue
 }
 $acl = Get-Acl -LiteralPath $p.Path; $before = $acl.Sddl
 $acl.AddAccessRule((New-Rule $p)); Set-Acl -LiteralPath $p.Path -AclObject $acl
 if (-not (Find-Planned $p)) { throw ("Falha ao gravar a ACE (nao encontrada apos Set-Acl): " + (Describe $p)) }
 [void]$state.Add([pscustomobject]@{ Path = $p.Path; Kind = $p.Kind; Rights = [int]$p.Rights; Inherit = [int]$p.Inherit; Type = [int]$p.Type; Added = $true; SddlBefore = $before })
 Write-State $state   # grava a cada ACE: uma interrupcao deixa o registro fiel ao que foi feito
 Write-Output ("aplicado: {0}" -f (Describe $p))
}
