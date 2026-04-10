@echo off
setlocal
if "%~1"=="" (
  echo Usage: benchmark_windows_gpu_worker.cmd ^<media-file^> [model-size] [clip-seconds]
  exit /b 1
)
set MODEL=%~2
if "%MODEL%"=="" set MODEL=small
set CLIP=%~3
if "%CLIP%"=="" set CLIP=30
powershell -ExecutionPolicy Bypass -File "%~dp0benchmark_windows_gpu_worker.ps1" -InputPath "%~1" -ModelSize "%MODEL%" -ClipSeconds %CLIP%
