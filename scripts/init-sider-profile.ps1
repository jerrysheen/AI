param(
    [string]$ConfigPath
)

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$targetScript = Join-Path $scriptDir "sider\init-sider-profile.ps1"

& $targetScript @PSBoundParameters
exit $LASTEXITCODE
