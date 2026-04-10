$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..\..")
$envPath = Join-Path $repoRoot ".env"
$sharedDataDir = Join-Path $repoRoot ".ai-data"
$toolsDir = Join-Path $sharedDataDir "tools"
$whisperDir = Join-Path $toolsDir "whispercpp"
$whisperBinDir = Join-Path $whisperDir "bin"
$modelsDir = Join-Path $sharedDataDir "cache\whisper\models"

function Write-Step($message) {
  Write-Host "[autoTranslate][setup] $message"
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

function Download-File($url, $destination) {
  Write-Step "downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $destination
}

function Ensure-WhisperCpp() {
  $whisperExe = Join-Path $whisperBinDir "whisper-cli.exe"
  if (Test-Path $whisperExe) {
    Write-Step "whisper-cli.exe already present"
    return $whisperExe
  }

  Ensure-Dir $whisperDir
  $zipPath = Join-Path $env:TEMP "whisper-bin-x64.zip"
  Download-File "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip" $zipPath

  $extractDir = Join-Path $whisperDir "release"
  if (Test-Path $extractDir) {
    Remove-Item -Recurse -Force $extractDir
  }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $found = Get-ChildItem -Path $extractDir -Filter "whisper-cli.exe" -Recurse | Select-Object -First 1
  if (-not $found) {
    throw "whisper-cli.exe was not found after extracting whisper-bin-x64.zip"
  }

  Ensure-Dir $whisperBinDir
  Copy-Item -Path (Join-Path $found.Directory.FullName "*") -Destination $whisperBinDir -Recurse -Force
  return (Join-Path $whisperBinDir "whisper-cli.exe")
}

Write-Step "repo root: $repoRoot"
Ensure-Dir $sharedDataDir
Ensure-Dir $toolsDir
Ensure-Dir $modelsDir

Ensure-WingetPackage "OpenJS.NodeJS.LTS"
Ensure-WingetPackage "Gyan.FFmpeg"
$whisperExe = Ensure-WhisperCpp

Ensure-EnvLine "AI_FFMPEG_COMMAND" "ffmpeg"
Ensure-EnvLine "AI_FFPROBE_COMMAND" "ffprobe"
Ensure-EnvLine "AI_WHISPER_CLI_COMMAND" $whisperExe
Ensure-EnvLine "AI_AUTO_TRANSLATE_DEFAULT_MODEL" "base"
Ensure-EnvLine "AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE" "auto"
Ensure-EnvLine "AI_AUTO_TRANSLATE_THREADS" "4"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_HOST" "0.0.0.0"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_PORT" "8768"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_MAX_UPLOAD_MB" "2048"
Ensure-EnvLine "AI_AUTO_TRANSLATE_WORKER_JOBS_DIR" ".ai-data/auto-translate/remote-jobs"

Write-Step "installation complete"
Write-Step "worker start command:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\skills\autoTranslate\scripts\start_remote_transcribe_worker.ps1"
Write-Host "cmd /c .\skills\autoTranslate\scripts\start_remote_transcribe_worker.cmd"
