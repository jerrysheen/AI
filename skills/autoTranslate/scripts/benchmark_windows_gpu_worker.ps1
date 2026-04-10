$ErrorActionPreference = "Stop"

param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [string]$ModelSize = "small",
  [double]$ClipSeconds = 30,
  [string]$ComputeType = "float16",
  [int]$BeamSize = 5
)

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

$pythonCommand = $env:AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND
if (-not $pythonCommand) {
  throw "AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND is not set. Run install_windows_gpu_worker.cmd first."
}

$scriptPath = Join-Path $scriptDir "transcribe_local_media_gpu.py"
& $pythonCommand $scriptPath $InputPath --model-size $ModelSize --clip-seconds $ClipSeconds --compute-type $ComputeType --beam-size $BeamSize --debug
