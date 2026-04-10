$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installScript = Join-Path $scriptDir "install_windows_cpu_worker.ps1"
$startScript = Join-Path $scriptDir "start_remote_transcribe_worker.ps1"

function Write-Step($message) {
  Write-Host "[autoTranslate][deploy] $message"
}

Write-Step "running Windows CPU worker installation"
powershell -ExecutionPolicy Bypass -File $installScript

Write-Step "starting remote transcribe worker"
powershell -ExecutionPolicy Bypass -File $startScript
