---
name: pull-youtubeInfo
description: Fetch YouTube transcript text with minimal metadata. Trigger this skill when the user pastes a youtube.com or youtu.be link, provides a YouTube video id, or asks what a YouTube video said.
---

# Pull YouTube Info

Use this skill when the user wants subtitle text or basic metadata for one YouTube video.

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

Primary entrypoints:

- `node skills/pull-youtubeInfo/scripts/fetch_youtube.js "<youtube-url-or-id>" --pretty`
- `node skills/pull-youtubeInfo/api/fetch_video_transcript.js "<youtube-url-or-id>" --pretty`
- `node skills/pull-youtubeInfo/scripts/fetch_youtube_subtitle.js "<youtube-url-or-id>" --pretty`

Notes:

- This skill is separate from `pull-bilibiliInfo`. The normalized JSON shape is similar, but the extraction logic is YouTube-specific.
- Use the shared Chrome remote debugging port. Current default is `9222`.
- The skill reuses a local Chrome session and opens the transcript panel to collect subtitle text from YouTube's panel data flow.
- Prefer `scripts/fetch_youtube.js` for job-system integration because it writes into `downloads/` and updates `daily_jobs.json`.
- Prefer the API entrypoint for transcript-only callers because it returns normalized `video` and `transcript` objects.
- The skill has a hard timeout of `60s`. If the task does not finish within `60s`, it must stop, close the page, and return `status: "unavailable"`.
- When metadata is available but subtitles are not, the integrated fetch flow now stops early and records an empty transcript/video result instead of continuing with video download or ASR by default.

Workflow:

1. Accept a YouTube watch URL, short URL, `shorts/` URL, or plain video id.
2. Try fetching lightweight metadata first so the task can still be indexed even when subtitles are missing.
3. Connect to the local Chrome remote debugging session.
4. Detect available subtitle tracks from the player response.
5. Open the transcript panel and parse transcript segment text into JSON.
6. If subtitles are unavailable and the caller did not explicitly request download fallback with cookies, stop and record an empty result.
7. When presenting results to the user, extract key information densely from `full_text` instead of collapsing it too early into a vague summary.

Output contract:

- `ok` is `true` when transcript text was extracted.
- `status` is `available` or `unavailable` for external callers that only need a binary result.
- `video.video_id`, `video.title`, and `video.url` identify the source video.
- `transcript.available_subtitles` lists the subtitle tracks exposed on the page.
- `transcript.has_ai_subtitle` indicates whether an auto-generated subtitle track was exposed.
- `transcript.full_text` contains the final transcript text.
- `transcript.segments` contains timestamped items when requested with `--with-segments`.
- `error` is non-null when transcript extraction failed.
- When `transcript.full_text` is non-empty, prefer detailed content extraction over generic summarization.
- If the caller wants a summary, keep it faithful to the transcript and include enough specifics that the user can tell what was actually said.

Summary output schema (required when you summarize):

- If you produce any summary, output exactly one JSON object and follow this schema.
- Do not output free-form prose before or after the JSON.

```json
{
  "summary_version": "v1",
  "source": {
    "platform": "youtube",
    "source_url": "https://www.youtube.com/watch?v=...",
    "source_title": "video title",
    "publish_time": "2026-04-01T12:00:00+08:00",
    "author_channel": "channel name",
    "video_id": "video id",
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

Failure handling:

- If `ok` is `false`, stop immediately.
- Tell the user explicitly that this video currently cannot be fetched for subtitles.
- Do not continue with summary generation or inference when `transcript.full_text` is empty.
- In the job-integrated flow, write `content_files.transcript = null` and `content_files.video = null` for the empty-result case instead of pretending download/ASR is still pending.
- If the skill returns a timeout error, do not retry in the same task. Stop and report the failure to the user directly so the caller does not hang.
