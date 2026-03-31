---
name: pull-bilibiliInfo
description: Fetch Bilibili transcript text with minimal metadata. Use when Codex needs to pull one or more Bilibili videos by URL or BV id, detect whether CC or AI subtitles are available, and fall back to audio ASR when subtitles are missing.
---

# Pull Bilibili Info

Use these entrypoints:

1. Single video, automatic transcript:
[fetch_bilibili_transcript_auto.ps1](/F:/AI/skills/pull-bilibiliInfo/scripts/fetch_bilibili_transcript_auto.ps1)

2. Single video, subtitle only:
[fetch_bilibili_subtitle.js](/F:/AI/skills/pull-bilibiliInfo/scripts/fetch_bilibili_subtitle.js)

3. UP upload page listing:
[list_bilibili_up_videos.js](/F:/AI/skills/pull-bilibiliInfo/scripts/list_bilibili_up_videos.js)

4. UP batch transcript run:
[fetch_bilibili_up_transcripts.js](/F:/AI/skills/pull-bilibiliInfo/scripts/fetch_bilibili_up_transcripts.js)

Prefer this workflow:

1. For one video, run the automatic transcript entrypoint first.
2. Prefer `ai-zh` first when subtitles exist.
3. If subtitles are missing, fall back to audio download plus Whisper ASR.
4. Prefer the default lightweight JSON output and summarize from `full_text`.
5. Preserve metadata such as `title`, `subtitle_lang`, `has_ai_subtitle`, and `transcript_source`.

The scripts can reuse a logged-in Chrome Bilibili tab to expose AI subtitles. Use environment variable `BILIBILI_COOKIE` only as a fallback when needed. Do not hardcode personal cookies into the script.

Useful commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\pull-bilibiliInfo\scripts\setup_bilibili_env.ps1 -InstallCudaTorch
```

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\pull-bilibiliInfo\scripts\fetch_bilibili_transcript_auto.ps1 -Video "BV1afXrBBEy7" -Pretty
```

```powershell
node .\skills\pull-bilibiliInfo\scripts\list_bilibili_up_videos.js "https://space.bilibili.com/472747194/upload/video" --published-after 2026-03-26T00:00:00+08:00 --published-before 2026-03-31T23:59:59+08:00 --pretty
```

```powershell
node .\skills\pull-bilibiliInfo\scripts\fetch_bilibili_up_transcripts.js "https://space.bilibili.com/472747194/upload/video" --published-after 2026-03-26T00:00:00+08:00 --published-before 2026-03-31T23:59:59+08:00 --pretty
```

Output contract:

- Every entrypoint prints JSON to stdout by default.
- `full_text` contains the final transcript text.
- `transcript_source` is:
  - `subtitle`
  - `audio_asr`
- `available_subtitles` lists subtitle tracks when subtitle lookup succeeds.
- `has_ai_subtitle` indicates whether an `ai-*` track was exposed.
- `audio_file` and `asr_file` are populated when fallback ASR is used.
- `error` is non-null when metadata, audio download, or ASR failed.

If the script reports no subtitles:

- The automatic transcript entrypoint should continue into audio ASR unless audio fallback is explicitly disabled.
- Tell the user whether the final transcript came from subtitles or ASR.
- Do not claim a transcript summary when `full_text` is empty.

For multi-video work later, keep each fetched result as one JSON artifact first. Aggregate only after individual pulls are verified.
