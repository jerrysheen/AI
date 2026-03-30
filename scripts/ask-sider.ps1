param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Question,

    [string]$ConfigPath,

    [switch]$AsJson,

    [switch]$SkipBrowserCleanup,

    [switch]$ReuseExistingChrome
)

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$targetScript = Join-Path $scriptDir "sider\ask-sider.ps1"

& $targetScript @PSBoundParameters
exit $LASTEXITCODE
