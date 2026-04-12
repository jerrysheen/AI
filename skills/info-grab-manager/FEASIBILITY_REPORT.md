# YouTube & Bilibili 视频下载方案可行性报告

**日期**: 2026-04-11
**目标**: 探索 pull-youtubeInfo 和 pull-bilibiliInfo 的视频下载方案，与现有 AI 字幕功能融合

---

## 一、现有架构分析

### 1.1 已有的 Pull Skill 模式

| Skill | 抓取方式 | 视频下载 | 字幕获取 | 统一接口 |
|-------|---------|---------|---------|---------|
| pull-tiktok | 页面解析 + 直链下载 | ✅ | ❌ | `fetchTikTokVideo(url, { job })` |
| pull-xhs | 页面解析 + 直链下载 | ✅ | ❌ | `fetchXhsNote(url, { job })` |
| pull-Twitter | Nitter RSS + 直链下载 | ✅ | ❌ | `fetchTwitter(url, { job })` |
| pull-bilibiliInfo | Chrome CDP + yt-dlp | ⚠️ 仅音频 | ✅ AI字幕 | 需要适配 |
| pull-youtubeInfo | Chrome CDP | ❌ | ✅ AI字幕 | 需要适配 |

### 1.2 现有工具链

**yt-dlp 已配置**:
- 环境变量: `AI_YTDLP_COMMAND="python -m yt_dlp"`
- 已在 pull-bilibiliInfo 中使用: `fetch_bilibili_audio.js`
- 支持平台: YouTube, Bilibili, Twitter, TikTok, 等 1000+ 站点

---

## 二、技术方案设计

### 2.1 核心思路: yt-dlp + AI 字幕双路径

```
输入 URL
    ↓
[1] 解析平台类型 (youtube/bilibili)
    ↓
[2] 并行/串行执行:
    ├─ 路径 A: yt-dlp 下载视频/音频
    └─ 路径 B: Chrome CDP 获取 AI 字幕
    ↓
[3] 数据融合: 视频 + 字幕 + 元数据
    ↓
[4] 触发转写 (如无字幕时)
    ↓
[5] 统一落盘格式
```

### 2.2 统一接口设计

```javascript
// pull-bilibiliInfo/scripts/fetch_bilibili.js
async function fetchBilibili(url, { job }) {
  return {
    source_url: url,
    video_id: bvid,
    title: "...",
    author: "...",
    content_type: { has_video: true, has_images: false, has_text: true },

    // 视频文件
    video_path: "video.mp4",
    video_exists: true,
    video_size: 12345678,

    // 音频文件 (可选)
    audio_path: "audio.m4a",
    audio_exists: true,

    // 字幕: 优先 AI 字幕，回落 ASR
    transcript_source: "ai_subtitle" | "asr",
    transcript_path: "transcript.txt",
    transcript_json_path: "transcript.json",
    transcript_srt_path: "transcript.srt",

    // 元数据
    metadata_path: "metadata.json",
    content_path: "content.txt",

    task_dir: "...",
    job_id: "...",
  };
}

// pull-youtubeInfo/scripts/fetch_youtube.js
async function fetchYouTube(url, { job }) {
  // 同上述结构
}
```

### 2.3 yt-dlp 命令配置

**YouTube 视频下载**:
```bash
# 下载最佳质量 MP4
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  -o "%(id)s.%(ext)s" \
  --write-description \
  --write-info-json \
  --cookies-from-browser chrome \
  <youtube-url>
```

**Bilibili 视频下载**:
```bash
# 下载最佳质量
yt-dlp -f "bestvideo+bestaudio/best" \
  -o "%(id)s.%(ext)s" \
  --cookies-from-browser chrome \
  <bilibili-url>
```

---

## 三、分步实施计划

### Phase 1: pull-bilibiliInfo 增强
1. **创建 `fetch_bilibili.js` 统一接口**
   - 复用 `fetchBilibiliTranscriptAuto()` 获取 AI 字幕
   - 复用 `downloadBilibiliAudio()` 下载音频
   - 新增 `downloadBilibiliVideo()` 下载视频
   - 按 info-grab-manager 格式落盘

2. **更新 info-grab-manager**
   - 添加 `processBilibiliJob()` 函数
   - 集成到 `processPendingJobs()`

### Phase 2: pull-youtubeInfo 增强
1. **创建 `fetch_youtube.js` 统一接口**
   - 复用 `fetchYouTubeSubtitle()` 获取 AI 字幕
   - 新增 `downloadYouTubeVideo()` 使用 yt-dlp
   - 新增 `downloadYouTubeAudio()` 可选
   - 按 info-grab-manager 格式落盘

2. **更新 info-grab-manager**
   - 添加 `processYoutubeJob()` 函数
   - 集成到 `processPendingJobs()`

### Phase 3: 回落与容错
1. **字幕回落策略**:
   - 优先尝试 AI 字幕 (Chrome CDP)
   - AI 字幕失败 → 下载视频 → ASR 转写
   - ASR 也失败 → 仅保存视频 + 元数据

2. **视频回落策略**:
   - yt-dlp 下载失败 → 标记但继续保存字幕
   - 记录错误到 `job_timeline.json`

---

## 四、数据落盘格式统一

```
downloads/{date}/
├── daily_jobs.json
├── job_timeline.json
├── bilibili/
│   ├── index.json
│   └── {bvid}_{title}/
│       ├── video.mp4          # yt-dlp 下载
│       ├── audio.m4a          # (可选)
│       ├── metadata.json      # 视频元数据
│       ├── content.txt        # 标题 + 描述
│       ├── transcript.txt     # AI 字幕 或 ASR 结果
│       ├── transcript.json    # 结构化字幕
│       └── transcript.srt     # SRT 格式
└── youtube/
    ├── index.json
    └── {video_id}_{title}/
        ├── video.mp4
        ├── metadata.json
        ├── content.txt
        ├── transcript.txt
        ├── transcript.json
        └── transcript.srt
```

---

## 五、风险与注意事项

### 5.1 已知风险
1. **yt-dlp 更新**: 平台反爬策略变化可能需要更新 yt-dlp
2. **Cookie 依赖**: 高清视频可能需要浏览器 Cookie
3. **下载时长**: 长视频下载耗时较长，需要超时处理
4. **存储空间**: 视频文件体积大，需要磁盘空间监控

### 5.2 缓解措施
1. 环境变量配置 yt-dlp 路径，方便更新
2. 支持 `--cookies-from-browser` 和 `--cookies` 选项
3. 分阶段处理: 先保存字幕，后台下载视频
4. 记录文件大小，提供清理机制

---

## 六、结论与建议

### ✅ 可行性结论: **高度可行**

理由:
1. ✅ yt-dlp 已在项目中配置并使用
2. ✅ AI 字幕功能已完整实现
3. ✅ info-grab-manager 框架已就绪
4. ✅ 只需按统一模式封装即可

### 建议实施顺序
1. **先做 pull-bilibiliInfo**: 已有音频下载代码可参考
2. **再做 pull-youtubeInfo**: 模式一致，可复用代码
3. **最后优化**: 增加进度反馈、断点续传等高级功能

### 预期收益
- info-grab-manager 统一管理 5 大平台 (tiktok/xhs/twitter/bilibili/youtube)
- AI 字幕 + 视频下载 + ASR 回落，完整链路
- 上层只需调用 info-grab-manager，无需关心底层细节
