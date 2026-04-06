---
name: pull-youtubeInfo
description: Fetch YouTube transcript text with minimal metadata. Trigger this skill when the user pastes a youtube.com or youtu.be link, provides a YouTube video id, or asks what a YouTube video said.
---

# Pull YouTube Info

Use this skill when the user wants the subtitle text for one YouTube video.

Primary entrypoints:

- `node skills/pull-youtubeInfo/api/fetch_video_transcript.js "<youtube-url-or-id>" --pretty`
- `node skills/pull-youtubeInfo/scripts/fetch_youtube_subtitle.js "<youtube-url-or-id>" --pretty`

Notes:

- This skill is separate from `pull-bilibiliInfo`. The normalized JSON shape is similar, but the extraction logic is YouTube-specific.
- Use the shared Chrome remote debugging port. Current default is `9222`.
- The skill reuses a local Chrome session and opens the transcript panel to collect subtitle text from YouTube's panel data flow.
- Prefer the API entrypoint for external callers because it returns normalized `video` and `transcript` objects.
- The skill has a hard timeout of `30s`. If the task does not finish within `30s`, it must stop, close the page, and return `status: "unavailable"`.

Workflow:

1. Accept a YouTube watch URL, short URL, `shorts/` URL, or plain video id.
2. Connect to the local Chrome remote debugging session.
3. Detect available subtitle tracks from the player response.
4. Open the transcript panel and parse transcript segment text into JSON.
5. Return `full_text` and optional `segments`.

Output contract:

- `ok` is `true` when transcript text was extracted.
- `status` is `available` or `unavailable` for external callers that only need a binary result.
- `video.video_id`, `video.title`, and `video.url` identify the source video.
- `transcript.available_subtitles` lists the subtitle tracks exposed on the page.
- `transcript.has_ai_subtitle` indicates whether an auto-generated subtitle track was exposed.
- `transcript.full_text` contains the final transcript text.
- `transcript.segments` contains timestamped items when requested with `--with-segments`.
- `error` is non-null when transcript extraction failed.

Failure handling:

- If `ok` is `false`, stop immediately.
- Tell the user explicitly that this video currently cannot be fetched for subtitles.
- Do not continue with summary generation or inference when `transcript.full_text` is empty.
- If the skill returns a timeout error, do not retry in the same task. Stop and report the failure to the user directly so the caller does not hang.
