$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..\..")
$envPath = Join-Path $repoRoot ".env"
$sharedDataDir = Join-Path $repoRoot ".ai-data"
$toolsDir = Join-Path $sharedDataDir "tools"
$venvDir = Join-Path $toolsDir "autoTranslate-gpu-venv"
$modelsDir = Join-Path $sharedDataDir "cache\faster-whisper"
$requirementsPath = Join-Path $scriptDir "requirements-gpu.txt"

function Write-Step($message) {
  Write-Host "[autoTranslate][gpu-setup] $message"
}

function Ensure-Dir($path) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Ensure-EnvLine($key, $value) {
  if (-not (Test-Path $envPath)) {
    New-Item -ItemType File -Path $envPath | Out-Null
  }

  $content = Get-Content $envPath -Raw
  if ($content -match "(?m)^$([regex]::Escape($key))=") {
    $updated = [regex]::Replace($content, "(?m)^$([regex]::Escape($key))=.*$", "$key=$value")
    Set-Content -Path $envPath -Value $updated -NoNewline
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$key=$value`r`n"
    Set-Content -Path $envPath -Value $content -NoNewline
  }
}

function Ensure-WingetPackage($id) {
  $listOutput = winget list --id $id --exact --accept-source-agreements 2>$null | Out-String
  if ($LASTEXITCODE -eq 0 -and $listOutput -match [regex]::Escape($id)) {
    Write-Step "$id already installed"
    return
  }

  Write-Step "installing $id via winget"
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
}

function Ensure-Command($commandName, $message) {
  $command = Get-Command $commandName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw $message
  }
  return $command.Path
}

Write-Step "repo root: $repoRoot"
Ensure-Dir $sharedDataDir
Ensure-Dir $toolsDir
Ensure-Dir $modelsDir

Ensure-WingetPackage "OpenJS.NodeJS.LTS"
Ensure-WingetPackage "Gyan.FFmpeg"
Ensure-WingetPackage "Python.Python.3.11"

$nvidiaSmi = Ensure-Command "nvidia-smi" "nvidia-smi not found. Install NVIDIA driver first."
Write-Step "nvidia-smi: $nvidiaSmi"
nvidia-smi

$pythonCommand = Ensure-Command "python" "python not found after installation"

if (-not (Test-Path $venvDir)) {
  Write-Step "creating Python venv: $venvDir"
  & $pythonCommand -m venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvPip = Join-Path $venvDir "Scripts\pip.exe"

Write-Step "upgrading pip tooling"
& $venvPython -m pip install --upgrade pip setuptools wheel

Write-Step "installing GPU transcription dependencies"
& $venvPip install -r $requirementsPath

Write-Step "running GPU doctor"
& $venvPython (Join-Path $scriptDir "gpu_worker_doctor.py") --debug

Ensure-EnvLine "AI_FFMPEG_COMMAND" "ffmpeg"
Ensure-EnvLine "AI_FFPROBE_COMMAND" "ffprobe"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_HOST" "0.0.0.0"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_PORT" "8768"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_BACKEND" "gpu"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_MAX_UPLOAD_MB" "2048"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_JOBS_DIR" ".ai-data/auto-translate/remote-jobs"
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND" $venvPython
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_DEVICE" "cuda"
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_COMPUTE_TYPE" "float16"
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_BEAM_SIZE" "5"
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_DEBUG" "1"
Ensure-EnvLine "AI_AUTO_TRANSLATE_GPU_MODELS_DIR" ".ai-data/cache/faster-whisper"

Write-Step "installation complete"
Write-Step "GPU worker start command:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\skills\autoTranslate\scripts\start_remote_transcribe_worker_gpu.ps1"
Write-Host "cmd /c .\skills\autoTranslate\scripts\start_remote_transcribe_worker_gpu.cmd"
