# autoTranslate

Local media transcription skill based on `ffmpeg`, `whisper.cpp`, and `faster-whisper`.

## What It Does

- accepts one local audio or video file
- extracts audio automatically
- runs `whisper-cli`
- prints stage progress and timing data
- writes `txt`, `json`, `srt`, and `run-summary.json`

## Commands

Full run with defaults:

```bash
node skills/autoTranslate/scripts/transcribe_local_media.js "/absolute/path/to/file.mp4"
```

Speed test on a short clip:

```bash
node skills/autoTranslate/scripts/transcribe_local_media.js "/absolute/path/to/file.mp4" --clip-seconds 60
```

Use a faster but lower-quality model:

```bash
node skills/autoTranslate/scripts/transcribe_local_media.js "/absolute/path/to/file.mp4" --model-size tiny
```

GPU local run with `faster-whisper`:

```bash
python skills/autoTranslate/scripts/transcribe_local_media_gpu.py "/absolute/path/to/file.mp4" --model-size small --compute-type float16 --debug
```

## Defaults From `.env`

The script reads the repo-root `.env` automatically and uses these defaults when present:

- `AI_AUTO_TRANSLATE_DEFAULT_MODEL`
- `AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE`
- `AI_AUTO_TRANSLATE_THREADS`
- `AI_AUTO_TRANSLATE_RUNS_DIR`
- `AI_AUTO_TRANSLATE_MODELS_DIR`
- `AI_WHISPER_CLI_COMMAND`
- `AI_FFMPEG_COMMAND`
- `AI_FFPROBE_COMMAND`
- `AI_AUTO_TRANSLATE_WORKER_BACKEND`
- `AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND`
- `AI_AUTO_TRANSLATE_GPU_DEVICE`
- `AI_AUTO_TRANSLATE_GPU_COMPUTE_TYPE`
- `AI_AUTO_TRANSLATE_GPU_BEAM_SIZE`
- `AI_AUTO_TRANSLATE_GPU_DEBUG`
- `AI_AUTO_TRANSLATE_GPU_MODELS_DIR`

## Output

Each run creates a directory under the configured runs path and writes:

- `transcript.txt`
- `transcript.json`
- `transcript.srt`
- `run-summary.json`

## Remote Worker

For a stronger Windows machine, run a lightweight HTTP worker there.

Start the worker on Windows:

```bat
skills\autoTranslate\scripts\start_remote_transcribe_worker.cmd
```

Or:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\autoTranslate\scripts\start_remote_transcribe_worker.ps1
```

One-click install and start on Windows:

```bat
skills\autoTranslate\scripts\deploy_windows_cpu_worker.cmd
```

Or:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\autoTranslate\scripts\deploy_windows_cpu_worker.ps1
```

For an NVIDIA Windows machine such as an RTX 5060 box, you can still prepare the GPU environment with:

```bat
skills\autoTranslate\scripts\deploy_windows_gpu_worker.cmd
```

Or:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\autoTranslate\scripts\deploy_windows_gpu_worker.ps1
```

GPU debug and benchmark on Windows:

```bat
skills\autoTranslate\scripts\benchmark_windows_gpu_worker.cmd "D:\path\to\sample.mp4" small 30
```

The GPU installer runs `gpu_worker_doctor.py`, creates a Python venv, and installs `faster-whisper`.

The HTTP worker can now handle both backends inside one service. Pick the backend per job:

```bash
node skills/autoTranslate/scripts/submit_remote_transcribe.js "/absolute/path/to/file.mp4" --remote-base-url http://WINDOWS_HOST:8768 --backend cpu
```

```bash
node skills/autoTranslate/scripts/submit_remote_transcribe.js "/absolute/path/to/file.mp4" --remote-base-url http://WINDOWS_HOST:8768 --backend gpu --model-size small --compute-type float16 --beam-size 5 --debug
```

Submit a local file to the remote worker from another machine:

```bash
node skills/autoTranslate/scripts/submit_remote_transcribe.js "/absolute/path/to/file.mp4" --remote-base-url http://WINDOWS_HOST:8768
```

The submit script defaults to extracting a mono 16k WAV locally before upload so the network payload is already transcription-ready.

The remote worker supports:

- `GET /health` for basic service checks
- `POST /jobs` to upload a WAV and create a transcription job
- `GET /jobs/<jobId>` to poll status and progress
- `GET /jobs/<jobId>/text` to read `transcript.txt` directly
- `GET /jobs/<jobId>/files/<name>` to download artifacts such as `transcript.json`, `transcript.srt`, `run-summary.json`, and `worker.log`

The polling response includes `progress.stage`, `progress.percent`, and `progress.message`.

`/health` now reports:

- `default_backend`
- `supported_backends`
- `gpu_available`

Large uploads are allowed by default. The worker upload limit is controlled by:

- `AI_AUTO_TRANSLATE_WORKER_MAX_UPLOAD_MB`

Current default is `2048` MB, so large WAV uploads do not fail due to a small body limit.

For safer LAN use, set:

- `AI_AUTO_TRANSLATE_WORKER_TOKEN`

When a token is set, the client should pass `--token <value>` or use the same env var locally.
