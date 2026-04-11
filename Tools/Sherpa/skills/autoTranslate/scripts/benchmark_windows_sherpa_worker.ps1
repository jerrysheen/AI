[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,
    [string]$Provider = "cuda"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$jobId = "benchmark-" + [guid]::NewGuid().ToString("N")
$outputDir = Join-Path $repoRoot ".ai-data\sherpa-onnx\runs\$jobId"
$scriptPath = Join-Path $PSScriptRoot "transcribe_local_media_sherpa.py"
$venvPython = Join-Path $repoRoot ".ai-data\tools\sherpa-onnx\venv\Scripts\python.exe"
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }

& $pythonExe $scriptPath --input $InputFile --provider $Provider --job-id $jobId --output-dir $outputDir

$summaryPath = Join-Path $outputDir "run-summary.json"
if (-not (Test-Path $summaryPath)) {
    throw "Benchmark summary not found: $summaryPath"
}

$summary = Get-Content -Raw -Path $summaryPath | ConvertFrom-Json
[pscustomobject]@{
    provider = $summary.provider
    audio_duration_seconds = $summary.audio_duration_seconds
    model_load_seconds = $summary.timing.model_load_seconds
    decode_seconds = $summary.timing.decode_seconds
    total_seconds = $summary.timing.total_seconds
    rtf = $summary.timing.rtf
    output_dir = $summary.output_dir
} | Format-List
