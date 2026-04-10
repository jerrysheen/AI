---
name: pull-xhs
description: Fetch Xiaohongshu (小红书) notes/posts from share links or text, download images and videos. Trigger this skill when the user pastes a Xiaohongshu (小红书) link, provides share text containing a note link, asks to download Xiaohongshu content, or asks to extract images/videos from a Xiaohongshu note.
---

# Pull Xiaohongshu (小红书) Note & Media

## When To Trigger

Use this skill immediately when any of the following is true:

- The user provides a Xiaohongshu (小红书) note link
- The user pastes share text containing a Xiaohongshu link
- The user asks to download Xiaohongshu content
- The user asks to extract images/videos from a Xiaohongshu note

## Primary Goal

Download Xiaohongshu (小红书) notes to local files, download images and videos, and return structured JSON with file paths and metadata.

## Usage

### Download Note Content Only

```bash
# Download a note
node scripts/fetch_xhs_note.js "https://www.xiaohongshu.com/explore/xxxxx" --pretty

# Download from share text
node scripts/fetch_xhs_note.js "分享文案... https://xhslink.com/xxxxx/" --pretty
```

## Output Contract

### Note Content (fetch_xhs_note.js)

```json
{
  "source_url": "原始输入链接",
  "resolved_url": "解析后的最终链接",
  "note_id": "笔记ID",
  "title": "笔记标题",
  "content": "笔记内容",
  "author": "作者名称",
  "image_paths": ["/path/to/image1.jpg", "/path/to/image2.jpg"],
  "image_exists": [true, true],
  "image_sizes": [123456, 789012],
  "video_paths": ["/path/to/video1.mp4"],
  "video_exists": [true],
  "video_sizes": [3456789],
  "error": null
}
```
