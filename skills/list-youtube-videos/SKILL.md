---
name: list-youtube-videos
description: List recent YouTube channel videos within a time range. Trigger this skill when the user provides a youtube.com channel or @handle URL and wants videos published in the last week, month, or a custom date range.
---

# List YouTube Videos

Use this skill when the user wants a YouTube channel's recent uploads, especially filtered by time range.

Primary entrypoints:

- `node skills/list-youtube-videos/api/list_channel_videos.js "<channel-url-or-handle>" --published-after 2026-03-01 --published-before 2026-03-31 --pretty`
- `node skills/list-youtube-videos/scripts/list_youtube_channel_videos.js "<channel-url-or-handle>" --published-after 2026-03-01 --published-before 2026-03-31 --pretty`

Workflow:

1. Accept a YouTube channel URL, `@handle`, `/channel/...`, `/c/...`, or `/user/...`.
2. Open the channel `videos` page through the shared local Chrome remote debugging session.
3. Collect visible video cards and keep loading more until enough candidates are available.
4. Resolve per-video publish dates from the watch pages.
5. Return the filtered list as JSON.

Output contract:

- `channel` identifies the source channel.
- `filters` records `published_after` and `published_before`.
- `videos` contains the final filtered video list.
- Each video includes `video_id`, `title`, `video_url`, `publish_time`, and `publish_timestamp`.
