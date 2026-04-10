@echo off
setlocal
set AI_AUTO_TRANSLATE_WORKER_BACKEND=gpu
node "%~dp0remote_transcribe_worker.js"
