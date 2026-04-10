---
name: pull-tiktok
description: Fetch TikTok/Douyin videos from share links or text, optionally extract audio. Trigger this skill when the user pastes a TikTok or Douyin link, provides share text containing a video link, asks to download a TikTok/Douyin video, or asks to extract audio from a TikTok/Douyin video.
---

# Pull TikTok/Douyin Video & Audio

## When To Trigger

Use this skill immediately when any of the following is true:

- The user provides a TikTok/Douyin video link
- The user pastes share text containing a TikTok/Douyin link
- The user asks to download a TikTok/Douyin video
- The user asks to extract audio from a TikTok/Douyin video

## Primary Goal

Download TikTok/Douyin videos to local files, optionally extract WAV/MP3 audio, and return structured JSON with file paths and metadata.

## Usage

### Download Video Only

```bash
# Download a video
node scripts/fetch_tiktok_video.js "https://www.douyin.com/video/7123456789012345678" --pretty

# Download from share text
node scripts/fetch_tiktok_video.js "在抖音，记录美好生活！ https://v.douyin.com/xxxxx/" --pretty
```

### Download Video + Extract Audio

```bash
# Download video and extract WAV audio
node scripts/fetch_tiktok_audio.js "https://v.douyin.com/xxxxx/" --wav --pretty

# Download and extract audio without keeping the video
node scripts/fetch_tiktok_audio.js "分享文本..." --wav --no-keep-video --pretty
```

### Extract Audio from Existing Video

```bash
node scripts/extract_audio.js ./path/to/video.mp4 --wav --pretty
```

## Output Contract

### Video Only (fetch_tiktok_video.js)

```json
{
  "source_url": "原始输入链接",
  "resolved_url": "解析后的最终链接",
  "video_id": "视频ID",
  "file_path": "/path/to/downloaded/video.mp4",
  "file_exists": true,
  "file_size": 12345678,
  "title": "视频标题",
  "author": "作者名称",
  "error": null
}
```

### Video + Audio (fetch_tiktok_audio.js)

```json
{
  "source_url": "原始输入链接",
  "video_id": "视频ID",
  "title": "视频标题",
  "author": "作者名称",
  "video_path": "/path/to/video.mp4",
  "video_exists": true,
  "video_size": 3502659,
  "audio_path": "/path/to/audio.wav",
  "audio_exists": true,
  "audio_size": 3416188,
  "audio_format": "wav",
  "error": null
}
```
