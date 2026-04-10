---
name: pull-bilibiliInfo
description: Fetch Bilibili transcript text with minimal metadata for one specific Bilibili video. Trigger this skill when the user pastes a `bilibili.com/video/...` link, provides a `BV...` id, or asks what one Bilibili video said or talked about.
---

# Pull Bilibili Info

## Hard Stop Rule

This skill is strict.

- Run one normal transcript fetch flow for the requested video.
- Prefer `ai-zh` first when available.
- If the result shows no AI subtitle track but exposes normal subtitle tracks such as `zh`, fall back to the normal subtitle track and continue.
- Only stop when neither AI subtitles nor normal subtitles are available.
- Do not try another directory.
- Do not try another copy of the skill.
- Do not retry with alternate shell wrappers.
- Do not switch to other scripts, other APIs, OCR, ASR, audio download, browser scraping variants, or manual guessing.
- Do not keep probing once subtitle unavailability is clear.

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

Extraction priority:

- Prefer extracting as much concrete video information as possible from the transcript and metadata.
- Do not over-compress the result into a short high-level summary unless the user explicitly asks for a brief summary.
- When answering from this skill, prioritize:
  - what the video actually covered
  - key points in the order they appeared
  - important terms, mechanisms, examples, conclusions, and caveats
  - notable names, products, versions, numbers, dates, and claims when present
- If the transcript is long, compress only enough to keep the answer readable, but still preserve the main informational content.
- Prefer “信息提取 / 内容展开” over “泛泛概括”.
- If the user asks “讲了什么”, default to a content-rich breakdown rather than a one-paragraph abstract summary.

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
3. If AI subtitles are missing but normal subtitles exist, use the normal subtitle track directly.
4. If no subtitle tracks exist at all, stop and return a no-subtitle result directly.
5. Prefer the default lightweight JSON output and summarize from `full_text`.
6. Preserve metadata such as `title`, `subtitle_lang`, `has_ai_subtitle`, and `transcript_source`.
7. When presenting results to the user, extract key information densely from `full_text` instead of collapsing it too early into a vague summary.

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
- `error` is non-null when metadata fetch failed or no usable subtitle track was available.
- If `has_ai_subtitle` is `false` but `full_text` is non-empty, that means the transcript came from a normal subtitle track.
- Treat transcript availability as `false` only when `full_text` is empty and no usable subtitle track was found.
- When there is no usable subtitle track, stop there. Do not try audio download, ASR, OCR, manual guessing, or summary generation from incomplete data.
- When `full_text` is non-empty, prefer detailed content extraction over generic summarization.
- If the caller wants a summary, keep it faithful to the transcript and include enough specifics that the user can tell what was actually said.

Summary output schema (required when you summarize):

- If you produce any summary, output exactly one JSON object and follow this schema.
- Do not output free-form prose before or after the JSON.

```json
{
  "summary_version": "v1",
  "source": {
    "platform": "bilibili",
    "source_url": "https://www.bilibili.com/video/BV...",
    "source_title": "video title",
    "publish_time": "2026-04-01T12:00:00+08:00",
    "author_channel": "uploader name",
    "video_id": "BV...",
    "retrieved_at": "2026-04-09T09:30:00+08:00"
  },
  "summary": "content summary based on transcript",
  "key_points": [
    "point 1",
    "point 2"
  ],
  "source_note": "summary comes from subtitle transcript of this video"
}
```

Lightweight rules:

- `source.source_url` is mandatory.
- If transcript is unavailable, do not summarize.
- Never infer from title, thumbnail, comments, or outside knowledge.

If the script reports no subtitles:

- Treat that result as no available subtitle for the requested video.
- Tell the user explicitly whether AI subtitles were unavailable and whether normal subtitles were also unavailable.
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
