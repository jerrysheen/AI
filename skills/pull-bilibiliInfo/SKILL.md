---
name: pull-bilibiliInfo
description: Fetch Bilibili video content with multiple strategies: AI subtitles first, then normal subtitles, then ASR transcription from downloaded video as fallback. Trigger this skill when the user pastes a `bilibili.com/video/...` link, provides a `BV...` id, or asks what one Bilibili video said or talked about.
---

# Pull Bilibili Info

## Content Extraction Strategy

This skill uses a multi-layered approach to get video content:

1. **First, try AI subtitles** (`ai-zh` when available)
2. **Fallback to normal subtitles** (`zh` or other available tracks)
3. **Last resort: download video + ASR transcription** - when no subtitles exist, download the video and use speech-to-text

This ensures we can extract content from *any* Bilibili video, regardless of whether it has subtitles or not.

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
- Prefer "信息提取 / 内容展开" over "泛泛概括".
- If the user asks "讲了什么", default to a content-rich breakdown rather than a one-paragraph abstract summary.

## Workflow

1. For one video, first attempt to fetch AI subtitles (`ai-zh`).
2. If AI subtitles are missing but normal subtitles exist, use the normal subtitle track directly.
3. If no subtitle tracks exist at all:
   - Download the video
   - Run ASR (speech recognition) on the downloaded video
   - Use the ASR result as the transcript
4. Always try all available strategies before giving up.
5. Prefer the default lightweight JSON output and summarize from `full_text`.
6. Preserve metadata such as `title`, `subtitle_lang`, `has_ai_subtitle`, and `transcript_source`.
7. When presenting results to the user, extract key information densely from `full_text` instead of collapsing it too early into a vague summary.

The scripts can reuse a logged-in Chrome Bilibili tab to expose AI subtitles. Use environment variable `BILIBILI_COOKIE` only as a fallback when needed. Do not hardcode personal cookies into the script.

## Useful Commands

```bash
node skills/pull-bilibiliInfo/scripts/fetch_bilibili.js "BV1Ca411W7v9" --pretty
```

## Output Contract

- Every entrypoint prints JSON to stdout by default.
- `full_text` contains the final transcript text (from subtitles OR ASR).
- `transcript_source` indicates where the text came from:
  - `"ai_subtitle"` - from Bilibili AI subtitles
  - `"subtitle"` - from normal user-uploaded subtitles
  - `"asr"` - from speech recognition on downloaded video
- `available_subtitles` lists subtitle tracks when subtitle lookup succeeds.
- `has_ai_subtitle` indicates whether an `ai-*` track was exposed.
- `error` is non-null when metadata fetch failed and no usable content could be extracted.
- `video_path` is present when the video was downloaded.
- When `full_text` is non-empty, prefer detailed content extraction over generic summarization.
- If the caller wants a summary, keep it faithful to the transcript and include enough specifics that the user can tell what was actually said.

## Summary Output Schema (required when you summarize)

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
  "source_note": "summary comes from subtitle transcript or ASR of this video",
  "transcript_source": "ai_subtitle | subtitle | asr"
}
```

## Lightweight Rules

- `source.source_url` is mandatory.
- Never infer from title, thumbnail, comments, or outside knowledge.
- Always try ASR as a fallback when subtitles are unavailable.

## Transcript Source Notes

When reporting results to the user:

- If transcript came from AI subtitles: "内容来自B站AI字幕"
- If transcript came from normal subtitles: "内容来自B站字幕"
- If transcript came from ASR: "内容来自视频语音识别(ASR)"

For UP upload pages and date-range filtering, run `list-bilibili-up-videos` first and pass the selected `bvid` values into this skill.
For multi-video work later, keep each fetched result as one JSON artifact first. Aggregate only after individual pulls are verified.
