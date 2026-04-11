# Sherpa ONNX Windows Rollout Task

## Goal

Build a `Windows + local/offline + background-resident` speech recognition path based on `sherpa-onnx`, with `SenseVoice` as the first model candidate.

## Current Repository Reality

This repository is currently empty aside from instructions. The design text assumed pre-existing worker scripts and a Whisper backend, but those files do not exist in this checkout as of `2026-04-11`.

Therefore this rollout is being executed as:

- create a minimal repo-managed Sherpa worker stack from scratch
- keep the contract compatible with a future Whisper backend
- document the repo/design mismatch so future sessions do not assume missing files

## Phase Decision

Chosen current path:

- runtime: official `sherpa-onnx` Python API
- accelerator: CPU by default on this machine
- first model: official `SenseVoice` int8 Sherpa model
- integration shape: Python transcription backend called by a local resident service
- upper layer: local hotkey client for one-key file transcription

Reason:

- CPU benchmark on this machine is faster than the measured CUDA path for the selected rollout
- Python API is the cleanest way to keep timing, JSON results, and output artifact control

## Official Sources

Windows install docs:

- `https://k2-fsa.github.io/sherpa/onnx/install/windows.html`

CUDA wheel index:

- `https://k2-fsa.github.io/sherpa/onnx/cuda.html`

Observed official Windows CUDA wheel examples for Python 3.11:

- `https://huggingface.co/csukuangfj/sherpa-onnx-wheels/resolve/main/cuda/cu128/sherpa_onnx-1.12.35%2Bcuda12.cudnn9-cp311-cp311-win_amd64.whl`
- `https://huggingface.co/csukuangfj/sherpa-onnx-wheels/resolve/main/cuda/cu118/sherpa_onnx-1.12.35%2Bcuda-cp311-cp311-win_amd64.whl`

SenseVoice docs:

- `https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html`
- `https://k2-fsa.github.io/sherpa/onnx/sense-voice/python-api.html`

SenseVoice model:

- `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`

## Provider Policy

- default target: `cpu`
- CUDA remains optional follow-up work
- upper-layer acceptance is based on CPU mode

## Delivery Order

1. Create repo layout and environment contract.
2. Add Windows installer for wheel + model.
3. Add Sherpa backend wrapper script.
4. Add resident worker.
5. Add benchmark and doctor scripts.
6. Add docs and validation notes.
7. Run local static validation in this session.

## Acceptance Criteria For This Checkout

This checkout is accepted when:

1. `Task.md` and docs capture exact official download URLs.
2. Installer script can create layout, install a working Sherpa runtime, download the model, and persist `.env`.
3. Doctor script can validate runtime, model files, provider selection, and perform a test decode when installed.
4. Transcription backend can emit:
   - `transcript.txt`
   - `transcript.json`
   - `transcript.srt`
   - `run-summary.json`
5. Resident worker exposes `/health`, `/jobs`, and `/jobs/:id`.
6. Benchmark script reports provider, load time, decode time, duration, and RTF.

## Known Limitation In This Session

- Runtime validation inside this Codex session is limited by restricted network access, so I can scaffold and locally lint the rollout, but not fetch the official wheels and model without approval.
