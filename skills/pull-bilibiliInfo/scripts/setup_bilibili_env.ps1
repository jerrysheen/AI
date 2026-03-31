param(
    [switch]$InstallCudaTorch,
    [switch]$ForceEnv
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[setup] $Message"
}

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-RepoRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
}

function Ensure-EnvFile {
    param(
        [string]$RepoRoot,
        [bool]$Overwrite
    )

    $envPath = Join-Path $RepoRoot ".env"
    $examplePath = Join-Path $RepoRoot ".env.example"

    if ((-not $Overwrite) -and (Test-Path -LiteralPath $envPath)) {
        Write-Step ".env already exists, keeping current values."
        return
    }

    if (-not (Test-Path -LiteralPath $examplePath)) {
        throw ".env.example not found at $examplePath"
    }

    Copy-Item -LiteralPath $examplePath -Destination $envPath -Force
    Write-Step "Created .env from .env.example"
}

function Invoke-PythonPip {
    param([string[]]$Arguments)
    & python -m pip @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pip command failed: python -m pip $($Arguments -join ' ')"
    }
}

function Ensure-Python {
    if (-not (Test-CommandExists "python")) {
        throw "python is required but was not found on PATH."
    }

    $versionOutput = & python --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "python exists but could not report its version."
    }
    Write-Step "Using $versionOutput"
}

function Install-PythonDependencies {
    param([bool]$InstallCudaTorch)

    Write-Step "Installing yt-dlp and openai-whisper..."
    Invoke-PythonPip -Arguments @("install", "yt-dlp", "openai-whisper")

    if ($InstallCudaTorch) {
        Write-Step "Installing CUDA-enabled torch (cu128)..."
        Invoke-PythonPip -Arguments @("install", "torch", "--index-url", "https://download.pytorch.org/whl/cu128")
    } else {
        Write-Step "Skipping CUDA torch install. Re-run with -InstallCudaTorch if needed."
    }
}

function Test-Torch {
    $script = @'
import torch
print("torch_version=", torch.__version__)
print("cuda_available=", torch.cuda.is_available())
print("cuda_device_count=", torch.cuda.device_count())
if torch.cuda.is_available():
    print("cuda_device_name=", torch.cuda.get_device_name(0))
'@
    $output = $script | python -
    if ($LASTEXITCODE -ne 0) {
        throw "Torch validation failed."
    }
    Write-Step "Torch validation:"
    Write-Host $output
}

function Test-FfmpegPath {
    param([string]$RepoRoot)

    $ffmpegDir = Join-Path $RepoRoot ".ai-data\tools\ffmpeg"
    $ffmpegExe = Join-Path $ffmpegDir "ffmpeg.exe"
    $ffprobeExe = Join-Path $ffmpegDir "ffprobe.exe"

    if ((Test-Path -LiteralPath $ffmpegExe) -and (Test-Path -LiteralPath $ffprobeExe)) {
        Write-Step "Repo-local ffmpeg is ready at $ffmpegDir"
        return $true
    }

    Write-Step "ffmpeg is not ready yet."
    Write-Host "Expected files:"
    Write-Host "  $ffmpegExe"
    Write-Host "  $ffprobeExe"
    Write-Host "You can either:"
    Write-Host "  1. Copy ffmpeg.exe and ffprobe.exe into .ai-data\\tools\\ffmpeg"
    Write-Host "  2. Or update AI_FFMPEG_LOCATION in .env to point at an existing ffmpeg directory"
    return $false
}

$repoRoot = Resolve-RepoRoot
Write-Step "Repo root: $repoRoot"

Ensure-Python
Ensure-EnvFile -RepoRoot $repoRoot -Overwrite:$ForceEnv
Install-PythonDependencies -InstallCudaTorch:$InstallCudaTorch
Test-Torch
[void](Test-FfmpegPath -RepoRoot $repoRoot)

Write-Step "Environment setup finished."
Write-Host "Next checks:"
Write-Host "  python -m yt_dlp --version"
Write-Host "  python -m whisper --help"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\skills\pull-bilibiliInfo\scripts\fetch_bilibili_transcript_auto.ps1 -Video \"BV1afXrBBEy7\" -Pretty"
