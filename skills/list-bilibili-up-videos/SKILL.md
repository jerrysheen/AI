---
name: list-bilibili-up-videos
description: List videos from a Bilibili UP upload page and filter them by publish time. Trigger this skill when the user provides a `space.bilibili.com/.../upload/video` link or asks which videos an UP published within a date range.
---

# List Bilibili UP Videos

## When To Trigger

Use this skill immediately when any of the following is true:

- The user pastes a `https://space.bilibili.com/<mid>/upload/video` link.
- The user provides a Bilibili UP `mid` and asks for uploaded videos.
- The user asks questions such as "这个 up 在 xxxx 日期范围内更新了哪几个视频", "这个 up 最近发了什么", "筛出这周发的视频", or similar upload-page listing requests.

Do not use this skill for single-video transcript reading. For `BV...` ids and `bilibili.com/video/...` links, use `pull-bilibiliInfo` instead.

## Primary Goal

Return a filtered list of uploaded videos with standardized video identifiers so downstream workflows can pass selected `bvid` values into `pull-bilibiliInfo`.

## Entry Point

- UP upload page listing: [list_bilibili_up_videos.js](/Users/jerry/Desktop/AI/skills/list-bilibili-up-videos/scripts/list_bilibili_up_videos.js)

## Workflow

1. Resolve the UP upload page from `space.bilibili.com/.../upload/video` or `mid`.
2. Reuse the shared logged-in Chrome debug session.
3. Collect visible uploaded videos from the upload page.
4. Enrich each video with publish time when available.
5. Apply the requested publish-time filters.
6. Return standardized identifiers for each matched video.

## Useful Command

```bash
node ./skills/list-bilibili-up-videos/scripts/list_bilibili_up_videos.js "https://space.bilibili.com/472747194/upload/video" --published-after 2026-03-26T00:00:00+08:00 --published-before 2026-03-31T23:59:59+08:00 --pretty
```

## Output Contract

- The script prints JSON to stdout by default.
- Each matched video includes:
  - `bvid`
  - `video_id`
  - `video_id_type`
  - `video_url`
  - `title`
  - `publish_time`
  - `publish_timestamp`
- `video_id` must equal the canonical `bvid`.
- `video_id_type` must be `bvid`.
- `filters.published_after` and `filters.published_before` echo the normalized date filters.
- `video_count` is the number of videos after filtering.

## Downstream Rule

When the user wants transcript extraction after listing, pass the selected `bvid` values into `pull-bilibiliInfo`. Do not mix listing logic and transcript logic in the same skill.
