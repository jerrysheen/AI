[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
& (Join-Path $repoRoot "skills\autoTranslate\scripts\benchmark_windows_sherpa_worker.ps1") @Rest
