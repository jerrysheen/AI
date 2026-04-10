@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0deploy_windows_cpu_worker.ps1"
