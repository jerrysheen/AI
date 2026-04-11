[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $repoRoot "skills\sherpa\scripts\start_local_transcribe_service.ps1")
