$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..\..")
$envPath = Join-Path $repoRoot ".env"

if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }
    $pair = $line.Split("=", 2)
    if (-not [System.Environment]::GetEnvironmentVariable($pair[0], "Process")) {
      [System.Environment]::SetEnvironmentVariable($pair[0], $pair[1], "Process")
    }
  }
}

$env:AI_AUTO_TRANSLATE_WORKER_BACKEND = "gpu"
$workerScript = Join-Path $scriptDir "remote_transcribe_worker.js"
node $workerScript
