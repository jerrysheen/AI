param(
    [Parameter(Mandatory = $true)]
    [string]$AudioFile,

    [string]$Model = "small",
    [string]$Language = "Chinese",
    [string]$OutputDir = "F:\AI\.ai-data\asr\bilibili"
)

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
$envPath = Join-Path $repoRoot ".env"

if (Test-Path -LiteralPath $envPath) {
    Get-Content -LiteralPath $envPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }

        $parts = $line.Split("=", 2)
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (-not $name) {
            return
        }
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

$ffmpegLocation = $env:AI_FFMPEG_LOCATION
if (-not $ffmpegLocation) {
    $ffmpegLocation = ".ai-data\tools\ffmpeg"
}
if (-not [System.IO.Path]::IsPathRooted($ffmpegLocation)) {
    $ffmpegLocation = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ffmpegLocation))
}

$whisperPython = $env:AI_WHISPER_PYTHON
if (-not $whisperPython) {
    $whisperPython = "python"
}

$resolvedAudioFile = [System.IO.Path]::GetFullPath($AudioFile)
$resolvedOutputDir = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    [System.IO.Path]::GetFullPath($OutputDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDir))
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
$env:PATH = "$ffmpegLocation;$env:PATH"

& $whisperPython -m whisper $resolvedAudioFile --language $Language --model $Model --output_format txt --output_dir $resolvedOutputDir
