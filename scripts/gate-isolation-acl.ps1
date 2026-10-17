#requires -Version 5.1
<#
 Negacao de LEITURA para o grupo do sandbox do Codex (CodexSandboxUsers) nos arquivos de segredo do control plane.
 O Host (seu usuario) continua lendo; o executor Codex e os gates sob ANIMA_GATE_SANDBOX=codex-windows (usuario CodexSandboxOffline) nao.
 PADRAO = SIMULACAO (nao altera nada). Use -Apply para aplicar, -Revert para remover somente o ACE de negacao criado aqui, -Verify para conferir.
 ATO DO OPERADOR: nao executado pelo ANIMA. Nao altera conteudo dos arquivos, apenas um ACE de negacao no arquivo.
#>
[CmdletBinding()]
param(
 [string]$Repo = 'G:\anima',
 [switch]$Apply, [switch]$Revert, [switch]$Verify,
 # Opcional: o token do Codex (~/.codex/auth.json) tambem e legivel pelo sandbox hoje. O agente Codex (nao sandboxed) o le sozinho;
 # confirme na tentativa supervisionada que o executor continua autenticando antes de manter esta negacao.
 [switch]$IncludeCodexAuth
)
$ErrorActionPreference = 'Stop'
$group = 'CodexSandboxUsers'
$list = @("$Repo\apps\web\.env.local", "$Repo\apps\mobile\.env.local", "$Repo\supabase\.env")
if ($IncludeCodexAuth) { $list += "$env:USERPROFILE\.codex\auth.json" }
$targets = $list | Where-Object { Test-Path -LiteralPath $_ }
if (-not $targets) { Write-Output 'Nenhum arquivo de segredo encontrado.'; exit 2 }
foreach ($f in $targets) {
 $acl = (& icacls $f) -join "`n"
 $has = $acl -match [regex]::Escape("$group") -and $acl -match '\(DENY\)'
 if ($Verify) { Write-Output ("{0}: negacao para {1} = {2}" -f $f, $group, $has); continue }
 if ($Revert) { if ($Apply) { & icacls $f /remove:d $group | Out-Null; Write-Output "revertido: $f" } else { Write-Output "[simulacao] removeria negacao em $f" }; continue }
 if ($Apply) { & icacls $f /deny "${group}:(R)" | Out-Null; Write-Output "negacao aplicada: $f" } else { Write-Output "[simulacao] aplicaria: icacls `"$f`" /deny ${group}:(R)" }
}
