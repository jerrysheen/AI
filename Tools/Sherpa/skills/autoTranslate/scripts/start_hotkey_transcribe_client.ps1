[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

function Get-EnvMap {
    param([string]$RepoRoot)
    $values = @{}
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        $envFile = Join-Path $RepoRoot ".env.example"
    }
    if (Test-Path $envFile) {
        foreach ($line in Get-Content -Path $envFile) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
                continue
            }
            $parts = $trimmed -split "=", 2
            $values[$parts[0].Trim()] = $parts[1].Trim()
        }
    }
    return $values
}

function Resolve-RepoPath {
    param(
        [string]$RepoRoot,
        [string]$Value
    )
    if (-not $Value) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($Value)) {
        return $Value
    }
    return (Join-Path $RepoRoot ($Value -replace "/", "\"))
}

$envMap = Get-EnvMap -RepoRoot $repoRoot
$venvRoot = Resolve-RepoPath -RepoRoot $repoRoot -Value $envMap["AI_AUTO_TRANSLATE_SHERPA_VENV"]
if (-not $venvRoot) {
    $venvRoot = Join-Path $repoRoot ".ai-data\tools\sherpa-onnx\venv"
}
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$venvPythonw = Join-Path $venvRoot "Scripts\pythonw.exe"
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }
$pythonwExe = if (Test-Path $venvPythonw) { $venvPythonw } else { $pythonExe }

& $pythonExe -m pip install keyboard sounddevice pystray pillow
Set-Location $repoRoot
& $pythonwExe .\skills\autoTranslate\scripts\hotkey_transcribe_client.py
