[CmdletBinding()]
param(
    [string]$WheelVariant = "cuda12.cudnn9",
    [switch]$AllowCpuFallback,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

function Ensure-Directory {
    param([string]$PathValue)
    New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
}

function Set-EnvValue {
    param(
        [string]$EnvFile,
        [string]$Key,
        [string]$Value
    )

    $line = "$Key=$Value"
    if (-not (Test-Path $EnvFile)) {
        [System.IO.File]::WriteAllLines($EnvFile, @($line))
        return
    }

    $content = Get-Content -Path $EnvFile
    $updated = $false
    $next = foreach ($item in $content) {
        if ($item -match "^$([regex]::Escape($Key))=") {
            $updated = $true
            $line
        } else {
            $item
        }
    }
    if (-not $updated) {
        $next += $line
    }
    [System.IO.File]::WriteAllLines($EnvFile, [string[]]$next)
}

function Get-PythonWheelTag {
    $tag = python -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')"
    return $tag.Trim()
}

function Install-Wheel {
    param(
        [string]$PythonExe,
        [string]$Requirement
    )

    & $PythonExe -m pip install --upgrade pip
    & $PythonExe -m pip install -f "https://k2-fsa.github.io/sherpa/onnx/cuda.html" $Requirement
    & $PythonExe -m pip install soundfile
}

function Get-CudnnBinPath {
    $cudaPath = $env:CUDA_PATH
    $cudaMajor = $null
    if ($cudaPath -and $cudaPath -match "v(\d+)(?:\.\d+)?$") {
        $cudaMajor = $matches[1]
    }

    $roots = @("C:\Program Files\NVIDIA\CUDNN")
    $candidates = @()
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) {
            continue
        }
        $candidates += Get-ChildItem -Path $root -Recurse -Filter "cudnn64_9.dll" -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty DirectoryName
    }

    if (-not $candidates) {
        return $null
    }

    $candidates = $candidates | Select-Object -Unique

    if ($cudaMajor) {
        $matched = $candidates | Where-Object {
            $parts = $_ -split '[\\/]'
            $versionPart = if ($parts.Length -ge 2) { $parts[$parts.Length - 2] } else { "" }
            $versionPart -like "$cudaMajor.*"
        } | Select-Object -First 1
        if ($matched) {
            return $matched
        }
    }

    return ($candidates | Sort-Object | Select-Object -First 1)
}

function Expand-TarBz2 {
    param(
        [string]$ArchivePath,
        [string]$DestinationDirectory
    )

    Ensure-Directory -PathValue $DestinationDirectory
    tar -xjf $ArchivePath -C $DestinationDirectory
}

$repoRoot = Get-RepoRoot
$sharedDataRoot = Join-Path $repoRoot ".ai-data"
$toolRoot = Join-Path $sharedDataRoot "tools\sherpa-onnx"
$venvRoot = Join-Path $toolRoot "venv"
$cacheRoot = Join-Path $sharedDataRoot "cache"
$modelRoot = Join-Path $cacheRoot "sherpa-models\sensevoice"
$runRoot = Join-Path $sharedDataRoot "sherpa-onnx\runs"
$envFile = Join-Path $repoRoot ".env"
$wheelTag = Get-PythonWheelTag

$wheelVersion = "1.12.35"
$wheelMatrix = @{
    "cuda12.cudnn9" = "sherpa-onnx==$wheelVersion+cuda12.cudnn9"
    "cuda"          = "sherpa-onnx==$wheelVersion+cuda"
}

$modelAsset = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2"
$modelUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$modelAsset"
$modelDirName = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
$modelArchive = Join-Path $modelRoot $modelAsset

Ensure-Directory -PathValue $sharedDataRoot
Ensure-Directory -PathValue $toolRoot
Ensure-Directory -PathValue $modelRoot
Ensure-Directory -PathValue $runRoot

if ($Force -and (Test-Path $venvRoot)) {
    Remove-Item -Recurse -Force -LiteralPath $venvRoot
}

if (-not (Test-Path $venvRoot)) {
    python -m venv $venvRoot
}

$pythonExe = Join-Path $venvRoot "Scripts\python.exe"
$selectedVariant = $WheelVariant
$provider = "cuda"
$installAttemptLog = @()
$installed = $false

$variantsToTry = @($WheelVariant)
if ($WheelVariant -ne "cuda") {
    $variantsToTry += "cuda"
}

foreach ($variant in $variantsToTry) {
    if (-not $wheelMatrix.ContainsKey($variant)) {
        continue
    }
    try {
        Install-Wheel -PythonExe $pythonExe -Requirement $wheelMatrix[$variant]
        $selectedVariant = $variant
        $installed = $true
        break
    } catch {
        $installAttemptLog += "variant=$variant failed: $($_.Exception.Message)"
    }
}

if (-not $installed) {
    if (-not $AllowCpuFallback) {
        throw "CUDA wheel installation failed. Re-run with -AllowCpuFallback to permit CPU fallback. Attempts: $($installAttemptLog -join ' | ')"
    }
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install sherpa-onnx
    & $pythonExe -m pip install soundfile
    $provider = "cpu"
    $selectedVariant = "cpu"
}

if ($Force -or -not (Test-Path $modelArchive)) {
    Invoke-WebRequest -Uri $modelUrl -OutFile $modelArchive
}

if ($Force -or -not (Test-Path (Join-Path $modelRoot $modelDirName))) {
    Expand-TarBz2 -ArchivePath $modelArchive -DestinationDirectory $modelRoot
}

$modelDir = Join-Path $modelRoot $modelDirName
$cudnnBinPath = Get-CudnnBinPath

Set-EnvValue -EnvFile $envFile -Key "AI_SHARED_DATA_DIR" -Value ".ai-data"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_ROOT" -Value ".ai-data/tools/sherpa-onnx"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_VENV" -Value ".ai-data/tools/sherpa-onnx/venv"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_MODEL_DIR" -Value ".ai-data/cache/sherpa-models/sensevoice/$modelDirName"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_BACKEND" -Value "sherpa"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_MODEL" -Value "sensevoice"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_PROVIDER" -Value $provider
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_WHEEL_VARIANT" -Value $selectedVariant
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_EXTRA_PATHS" -Value $cudnnBinPath
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_LANGUAGE" -Value "auto"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_USE_ITN" -Value "1"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_SHERPA_NUM_THREADS" -Value "1"
Set-EnvValue -EnvFile $envFile -Key "AI_AUTO_TRANSLATE_OUTPUT_ROOT" -Value ".ai-data/sherpa-onnx/runs"

$probeOutput = & $pythonExe -c "import json, sherpa_onnx; print(json.dumps({'import_ok': True, 'version': getattr(sherpa_onnx, '__version__', 'unknown')}))"

[pscustomobject]@{
    provider = $provider
    wheel_variant = $selectedVariant
    cudnn_bin = $cudnnBinPath
    python = $pythonExe
    model_dir = $modelDir
    install_attempts = $installAttemptLog
    probe = $probeOutput
} | Format-List
