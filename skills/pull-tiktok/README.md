# pull-tiktok

抖音/TikTok 视频下载 & 音频提取模块

## 特点

- ✅ **不需要登录/cookies** - 直接解析抖音分享页面
- ✅ 支持分享文本和链接
- ✅ 自动提取视频信息（标题、作者等）
- ✅ 下载视频到本地
- ✅ 一键提取 WAV/MP3 音频
- ✅ 稳定可靠

## 安装依赖

- **Node.js** - 用于视频下载
- **ffmpeg** - 用于音频提取（可选，仅音频提取时需要）

```bash
# macOS 安装 ffmpeg
brew install ffmpeg

# Ubuntu 安装 ffmpeg
sudo apt install ffmpeg

# Windows 安装 ffmpeg
choco install ffmpeg
```

## 配置 (.env)

项目会自动读取 `../../.env` 文件中的配置：

```env
# ffmpeg 配置（如果 ffmpeg 不在 PATH 中）
AI_FFMPEG_COMMAND=ffmpeg
AI_FFPROBE_COMMAND=ffprobe

# 数据目录
AI_SHARED_DATA_DIR=.ai-data
```

## 使用方法

### 1. 仅下载视频

```bash
# 从分享文本中提取并下载
node scripts/fetch_tiktok_video.js "在抖音，记录美好生活！ https://v.douyin.com/xxxxx/" --pretty

# 直接使用链接
node scripts/fetch_tiktok_video.js "https://www.douyin.com/video/7123456789012345678" --pretty
```

### 2. 下载视频 + 提取音频（一步完成）⭐

```bash
# 下载并提取 WAV 音频（默认保留视频）
node scripts/fetch_tiktok_audio.js "https://v.douyin.com/xxxxx/" --wav --pretty

# 下载并提取音频，不保留视频文件
node scripts/fetch_tiktok_audio.js "分享文本..." --wav --no-keep-video --pretty

# 自定义保存目录
node scripts/fetch_tiktok_audio.js "https://v.douyin.com/xxxxx/" --wav --video-dir ./my-videos --audio-dir ./my-audios --pretty
```

### 3. 仅提取音频（已有视频文件）

```bash
node scripts/extract_audio.js ./downloads/video.mp4 --wav --pretty
```

## 输出格式

### fetch_tiktok_video.js（仅视频）

```json
{
  "source_url": "原始输入链接",
  "resolved_url": "解析后的最终链接",
  "video_id": "视频ID",
  "file_path": "/path/to/video.mp4",
  "file_exists": true,
  "file_size": 12345678,
  "title": "视频标题",
  "author": "作者名称",
  "error": null
}
```

### fetch_tiktok_audio.js（视频+音频）

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

## 文件存储位置

默认使用 `.ai-data` 目录：

```
.ai-data/
├── video/tiktok/    # 视频文件
│   └── {video_id}.mp4
└── audio/tiktok/    # 音频文件
    └── {video_id}.wav
```

## 技术方案

- **视频下载**: 直接解析抖音移动端分享页面的 `_ROUTER_DATA`，无需 cookies 或登录
- **音频提取**: 使用 ffmpeg 进行格式转换
