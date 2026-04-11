[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$modelRoot = Join-Path $repoRoot ".ai-data\cache\sherpa-models\streaming-paraformer"
$assetName = "sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2"
$assetUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$assetName"
$archivePath = Join-Path $modelRoot $assetName
$modelDir = Join-Path $modelRoot "sherpa-onnx-streaming-paraformer-bilingual-zh-en"

New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null

if ($Force -or -not (Test-Path $archivePath)) {
    Invoke-WebRequest -Uri $assetUrl -OutFile $archivePath
}

if ($Force -or -not (Test-Path $modelDir)) {
    tar -xjf $archivePath -C $modelRoot
}

[System.IO.File]::WriteAllLines(
    (Join-Path $repoRoot ".env"),
    [string[]]((Get-Content (Join-Path $repoRoot ".env")) -replace '^AI_SHERPA_STREAMING_MODEL_DIR=.*$', 'AI_SHERPA_STREAMING_MODEL_DIR=.ai-data/cache/sherpa-models/streaming-paraformer/sherpa-onnx-streaming-paraformer-bilingual-zh-en')
)

[pscustomobject]@{
    model_dir = $modelDir
    encoder = Join-Path $modelDir "encoder.int8.onnx"
    decoder = Join-Path $modelDir "decoder.int8.onnx"
    tokens = Join-Path $modelDir "tokens.txt"
    docs = "https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html"
} | Format-List
