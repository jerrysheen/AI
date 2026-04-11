[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,
    [switch]$SimulateRealtime
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$venvPython = Join-Path $repoRoot ".ai-data\tools\sherpa-onnx\venv\Scripts\python.exe"
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }
$scriptPath = Join-Path $PSScriptRoot "transcribe_local_media_streaming_paraformer.py"
$args = @($scriptPath, "--input", $InputFile)
if ($SimulateRealtime) { $args += "--simulate-realtime" }
& $pythonExe @args
