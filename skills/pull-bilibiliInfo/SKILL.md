---
name: pull-bilibiliInfo
description: Fetch Bilibili transcript text with minimal metadata for one specific Bilibili video. Trigger this skill when the user pastes a `bilibili.com/video/...` link, provides a `BV...` id, or asks what one Bilibili video said or talked about.
---

# Pull Bilibili Info

## Hard Stop Rule

This skill is strict.

- Run one normal transcript fetch flow for the requested video.
- If the result shows `has_ai_subtitle = false`, or `error` says no AI subtitle track is available, reply explicitly that AI subtitles are unavailable for this video and stop.
- In that case, the caller should treat the result as `false` for transcript availability and end the workflow.
- Do not try another directory.
- Do not try another copy of the skill.
- Do not retry with alternate shell wrappers.
- Do not switch to other scripts, other APIs, OCR, ASR, audio download, browser scraping variants, or manual guessing.
- Do not keep probing once the no-AI-subtitle result is clear.

## When To Trigger

Use this skill immediately when any of the following is true:

- The user provides a `BV...` id.
- The user pastes a `https://www.bilibili.com/video/...` link.
- The user pastes a `b23.tv` short link that resolves to a Bilibili video.
- The user asks questions such as "这个 B 站视频说了什么", "这视频讲了什么", "帮我总结这个 B 站视频", or similar requests to read or summarize one Bilibili video's content.

Do not wait for the user to explicitly mention subtitles or transcript extraction first. If the input clearly points to one Bilibili video and the user wants its content, invoke this skill.
Do not use this skill for `space.bilibili.com/.../upload/video` pages or UP listing tasks. Use `list-bilibili-up-videos` first to get standardized `bvid` values, then run this skill on the chosen video ids.

## Primary Goal

Return the video's transcript text and minimal metadata in structured JSON so external callers can read the result directly.

Use these entrypoints:

1. Single video, automatic transcript:
[fetch_bilibili_transcript_auto.ps1](/F:/AI/skills/pull-bilibiliInfo/scripts/fetch_bilibili_transcript_auto.ps1)

2. Single video, subtitle only:
[fetch_bilibili_subtitle.js](/F:/AI/skills/pull-bilibiliInfo/scripts/fetch_bilibili_subtitle.js)

3. UP batch transcript run after listing:
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
- If `has_ai_subtitle` is `false`, transcript availability should be treated as `false`.
- When there is no AI subtitle track, stop there. Do not try audio download, ASR, OCR, manual guessing, or summary generation from incomplete data.

If the script reports no subtitles:

- Treat that result as no available AI subtitle for the requested video.
- Tell the user explicitly that no AI subtitle is available for this video.
- Tell the user explicitly that transcript availability is `false`.
- Stop after reporting that status.
- Do not continue looking for alternative extraction paths.
- Do not retry from another folder or another copy of the repository.
- Do not try to "fix" the result by switching command variants.
- Do not claim a transcript summary when `full_text` is empty.
- Do not infer what the video said from title, metadata, comments, or thumbnails.
- Tell the user whether the final transcript came from subtitles only when `full_text` is non-empty.

For UP upload pages and date-range filtering, run `list-bilibili-up-videos` first and pass the selected `bvid` values into this skill.
For multi-video work later, keep each fetched result as one JSON artifact first. Aggregate only after individual pulls are verified.
