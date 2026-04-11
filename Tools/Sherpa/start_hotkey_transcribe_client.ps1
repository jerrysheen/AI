[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $env:SHERPA_HOTKEY_CHILD) {
    $env:SHERPA_HOTKEY_CHILD = "1"
    Start-Process powershell -WindowStyle Hidden -ArgumentList @(
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        (Join-Path $repoRoot "skills\sherpa\scripts\start_hotkey_transcribe_client.ps1")
    )
    return
}

& (Join-Path $repoRoot "skills\sherpa\scripts\start_hotkey_transcribe_client.ps1")
