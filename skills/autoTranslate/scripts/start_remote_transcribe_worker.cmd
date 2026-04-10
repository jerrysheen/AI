@echo off
setlocal
cd /d %~dp0\..\..
node skills\autoTranslate\scripts\remote_transcribe_worker.js
