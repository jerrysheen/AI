$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installScript = Join-Path $scriptDir "install_windows_gpu_worker.ps1"
$startScript = Join-Path $scriptDir "start_remote_transcribe_worker_gpu.ps1"

function Write-Step($message) {
  Write-Host "[autoTranslate][gpu-deploy] $message"
}

Write-Step "running Windows GPU worker installation"
powershell -ExecutionPolicy Bypass -File $installScript

Write-Step "starting remote transcribe GPU worker"
powershell -ExecutionPolicy Bypass -File $startScript
