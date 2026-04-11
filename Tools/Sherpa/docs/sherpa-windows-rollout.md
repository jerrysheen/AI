# Sherpa ONNX Windows Rollout

## Decision

This repo uses the official `sherpa-onnx` Python runtime with `SenseVoice` and currently defaults to `CPU` on this machine. The active local scripts live under `skills/sherpa/scripts/`, not `autoTranslate`.

Official sources:

- Windows docs:
  `https://k2-fsa.github.io/sherpa/onnx/install/windows.html`
- CUDA wheel index:
  `https://k2-fsa.github.io/sherpa/onnx/cuda.html`
- Example official Python 3.11 wheels:
  `https://huggingface.co/csukuangfj/sherpa-onnx-wheels/resolve/main/cuda/cu128/sherpa_onnx-1.12.35%2Bcuda12.cudnn9-cp311-cp311-win_amd64.whl`
  `https://huggingface.co/csukuangfj/sherpa-onnx-wheels/resolve/main/cuda/cu118/sherpa_onnx-1.12.35%2Bcuda-cp311-cp311-win_amd64.whl`
- SenseVoice docs:
  `https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html`
  `https://k2-fsa.github.io/sherpa/onnx/sense-voice/python-api.html`
- SenseVoice model asset:
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`

## Why This Path

- The measured CPU path is currently faster than the measured CUDA path for this rollout.
- Python API gives direct access to recognition results and timing.

## Runtime Layout

- `.ai-data/tools/sherpa-onnx/`
- `.ai-data/tools/sherpa-onnx/venv/`
- `.ai-data/cache/sherpa-models/sensevoice/`
- `.ai-data/sherpa-onnx/runs/`

## Environment Keys

Copy `.env.example` to `.env`.

Required:

- `AI_AUTO_TRANSLATE_SHERPA_VENV`
- `AI_AUTO_TRANSLATE_SHERPA_MODEL_DIR`
- `AI_AUTO_TRANSLATE_SHERPA_PROVIDER`
- `AI_AUTO_TRANSLATE_SHERPA_WHEEL_VARIANT`

Defaults:

- provider: `cpu`
- wheel variant: `cpu`
- CUDA remains optional for later tuning

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\sherpa\scripts\install_windows_sherpa_worker.ps1
```

Force a specific variant:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\sherpa\scripts\install_windows_sherpa_worker.ps1 -WheelVariant cuda12.cudnn9
```

Allow CPU fallback:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\sherpa\scripts\install_windows_sherpa_worker.ps1 -AllowCpuFallback
```

## Healthcheck

```powershell
python .\skills\sherpa\scripts\sherpa_worker_doctor.py
```

Expected:

- venv exists
- `sherpa_onnx` import succeeds
- provider probe reports CUDA when available
- `tokens.txt` exists
- `model.int8.onnx` exists
- test decode succeeds if the model bundle test wav is present

## Start Local Service

```powershell
powershell -ExecutionPolicy Bypass -File .\start_local_transcribe_service.ps1
```

Double-click alternative:

```text
launch_local_transcribe_service.cmd
```

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## One-Key Use

Start the hotkey client:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_hotkey_transcribe_client.ps1
```

Double-click alternative:

```text
launch_hotkey_transcribe_client.cmd
```

Default hotkey:

- `Ctrl+\``

Current behavior:

- tray resident client starts in background
- hold `Ctrl+\`` to record microphone audio
- release `Ctrl+\`` to stop and transcribe
- a small top-right overlay shows `Ready / Recording / Transcribing / Pasted / Error`
- transcript text is copied to clipboard and pasted into the current input using `Ctrl+V`
- temporary microphone wav is deleted after transcription
- tray icon provides `Quit`

## Submit A Job

```powershell
$body = @{
  backend = "sherpa"
  mediaPath = "F:\path\to\audio.wav"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/jobs -ContentType "application/json" -Body $body
```

Poll:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/jobs/<job-id>
```

## Benchmark

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\sherpa\scripts\benchmark_windows_sherpa_worker.ps1 -InputFile "<wav>"
```

## Rollback

1. Stop the worker.
2. Remove Sherpa keys from `.env` if needed.
3. Remove `.ai-data/tools/sherpa-onnx` and `.ai-data/cache/sherpa-models/sensevoice` if you want a local cleanup.
4. Leave code and docs in place; the rollout is isolated.
