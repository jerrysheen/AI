---
name: pull-bilibiliInfo
description: Fetch Bilibili transcript text with minimal metadata. Trigger this skill when the user pastes a `bilibili.com` video link, provides a `BV...` id, or asks what a Bilibili video said or talked about.
---

# Pull Bilibili Info

## When To Trigger

Use this skill immediately when any of the following is true:

- The user provides a `BV...` id.
- The user pastes a `https://www.bilibili.com/video/...` link.
- The user pastes a `b23.tv` short link that resolves to a Bilibili video.
- The user asks questions such as "这个 B 站视频说了什么", "这视频讲了什么", "帮我总结这个 B 站视频", or similar requests to read or summarize one Bilibili video's content.

Do not wait for the user to explicitly mention subtitles or transcript extraction first. If the input clearly points to one Bilibili video and the user wants its content, invoke this skill.

## Primary Goal

Return the video's transcript text and minimal metadata in structured JSON so external callers can read the result directly.

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
3. If AI subtitles are missing, stop immediately and return a no-subtitle result directly.
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
- `transcript_source` is `subtitle` when a transcript is available.
- `available_subtitles` lists subtitle tracks when subtitle lookup succeeds.
- `has_ai_subtitle` indicates whether an `ai-*` track was exposed.
- `error` is non-null when metadata fetch failed or the preferred AI subtitle track was unavailable.
- If `has_ai_subtitle` is `false` or `error` indicates no AI subtitle track, the caller must explicitly say that this video currently has no AI subtitles.
- When there is no AI subtitle track, stop there. Do not try audio download, ASR, OCR, manual guessing, or summary generation from incomplete data.

If the script reports no subtitles:

- Treat that result as no available AI subtitle for the requested video.
- Tell the user explicitly that no AI subtitle is available for this video.
- Stop after reporting that status.
- Do not continue looking for alternative extraction paths.
- Do not claim a transcript summary when `full_text` is empty.
- Do not infer what the video said from title, metadata, comments, or thumbnails.
- Tell the user whether the final transcript came from subtitles only when `full_text` is non-empty.

For multi-video work later, keep each fetched result as one JSON artifact first. Aggregate only after individual pulls are verified.
