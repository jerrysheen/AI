---
name: autoTranslate
description: Transcribe local audio or video files with whisper.cpp, showing live progress and speed metrics. Trigger this skill when the user has a local media file and wants a full transcript quickly on the current machine.
---

# Auto Translate

Use this skill when the user already has a local media file and wants a local transcript with visible progress.

Primary entrypoints:

- `node skills/autoTranslate/scripts/transcribe_local_media.js "<local-media-path>"`
- `node skills/autoTranslate/api/transcribe_local_media.js "<local-media-path>"`
- `node skills/autoTranslate/scripts/remote_transcribe_worker.js`
- `node skills/autoTranslate/scripts/submit_remote_transcribe.js "<local-media-path>" --remote-base-url http://host:8768`

Workflow:

1. Accept one local media file path.
2. Load shared defaults from the repo-root `.env`.
3. Download the requested Whisper model if it is not already cached.
4. Extract mono 16k WAV audio with `ffmpeg`.
5. Run `whisper-cli` and print progress while transcribing.
6. Write `txt`, `json`, `srt`, and `run-summary.json` to the run directory.

Defaults:

- Default model: `base`
- Default language: `auto`
- Default threads: read from `.env`, else up to `4`
- Shared cache and run paths are repo-relative by default

Output contract:

- `ok` is `true` when the transcript run completed.
- `performance.transcribe_speed_multiplier` reports approximate realtime speed.
- `outputs.transcript_txt` / `transcript_json` / `transcript_srt` are the generated files.
- `run-summary.json` records timings for model preparation, probing, audio extraction, and transcription.

Notes:

- This skill is optimized for local CPU execution on the current machine.
- On Intel 8GB Macs, prefer `base` as the default quality/speed tradeoff.
- Use `tiny` only when speed matters more than text quality.
- When another machine is stronger, run the remote worker there and upload pre-extracted WAV files from the source machine.
