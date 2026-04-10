@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0deploy_windows_gpu_worker.ps1"
