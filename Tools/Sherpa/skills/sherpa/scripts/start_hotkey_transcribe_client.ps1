[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$venvPython = Join-Path $repoRoot ".ai-data\tools\sherpa-onnx\venv\Scripts\python.exe"
$venvPythonw = Join-Path $repoRoot ".ai-data\tools\sherpa-onnx\venv\Scripts\pythonw.exe"
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }
$pythonwExe = if (Test-Path $venvPythonw) { $venvPythonw } else { $pythonExe }

& $pythonExe -m pip install keyboard sounddevice pystray pillow
Set-Location $repoRoot
& $pythonwExe .\skills\sherpa\scripts\hotkey_transcribe_client.py
