[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $repoRoot
node .\skills\sherpa\scripts\local_transcribe_service.js
