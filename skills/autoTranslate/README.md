# autoTranslate

Local media transcription skill based on `ffmpeg` and `whisper.cpp`.

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

Submit a local file to the remote worker from another machine:

```bash
node skills/autoTranslate/scripts/submit_remote_transcribe.js "/absolute/path/to/file.mp4" --remote-base-url http://WINDOWS_HOST:8768
```

The submit script defaults to extracting a mono 16k WAV locally before upload so the network payload is already transcription-ready.
