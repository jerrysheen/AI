# Task: info-grab-manager 开发和测试

## 目标
1. 重命名 job-manager 为 info-grab-manager
2. 集成并测试所有 pull skill
3. 增加批量处理能力：启动 pull 任务并保证每个任务完成

## 任务清单

### Phase 1: 基础功能和重命名
- [x] 重命名 job-manager → info-crab-manager → info-grab-manager
- [x] 更新所有文件中的引用（SKILL.md, README.md, CLAUDE.md）
- [x] 测试 info-grab-manager 基础命令（clear, clear-jobs, list, add）

### Phase 2: Pull Skill 集成测试
- [x] 测试 pull-tiktok
  - [x] 添加任务测试
  - [x] process 任务测试
  - [x] 验证数据落盘（video.mp4, metadata.json, content.txt）
  - [x] 验证状态更新（raw → pending → processed）
  - [x] 验证 job_timeline.json 事件
  - [x] 验证平台 index.json

- [x] 测试 pull-xhs
  - [x] 添加任务测试
  - [x] process 任务测试
  - [x] 验证数据落盘（metadata.json, content.txt, images/）
  - [x] 验证状态更新（raw → pending → processed）
  - [x] 验证 job_timeline.json 事件
  - [x] 验证平台 index.json

- [x] 测试 pull-Twitter
  - [x] 查看接口（fetch_twitter_enhanced.js, download_twitter_video.js）
  - [x] 设计统一接口方案
  - [x] 创建 fetch_twitter.js 统一接口
  - [x] 在 info-grab-manager 中实现 processTwitterJob
  - [x] 添加 Twitter 任务测试
  - [x] 验证完整流程（获取元数据 → 创建目录 → 触发转写）

- [x] pull-bilibiliInfo
  - [x] 查看现有的下载接口
  - [x] **结论**: 只有字幕获取功能，无视频下载接口
  - [x] → 标注并跳过，等待探索性研究

- [x] pull-youtubeInfo
  - [x] 查看现有的下载接口
  - [x] **结论**: 只有字幕获取功能，无视频下载接口
  - [x] → 标注并跳过，等待探索性研究

### Phase 3: 增强功能
- [x] 增加批量处理能力
  - [x] 确保 process 命令能处理所有 pending/raw 任务
  - [x] 增加任务完成保证（错误处理，继续下一个任务）
  - [x] 增加处理进度反馈（[x/y] 格式）
  - [x] 增加 process-all 命令别名

### Phase 4: 音频传输优化
- [x] 优化 autoTranslate 的 wav 上传大小
  - [x] 增加 --8khz 选项（8kHz 采样率，体积减半）
  - [x] 增加 --sample-rate 选项（自定义采样率）
  - [x] 增加 --audio-codec 选项（pcm_s16le, pcm_alaw, pcm_mulaw）
  - [x] 添加环境变量配置（AI_AUDIO_SAMPLE_RATE, AI_AUDIO_CODEC, AI_AUDIO_USE_8KHZ）
  - [x] 更新帮助文档和 .env.example

## 最终命名

- `info-grab-manager` (信息抓取管理器)

## Pull Skill 接口检查

### pull-tiktok
- 主函数: `fetchTikTokVideo(url, { job })`
- 位置: `skills/pull-tiktok/scripts/fetch_tiktok_video.js`
- 状态: ✅ 已集成

### pull-xhs
- 主函数: `fetchXhsNote(url, { job })`
- 位置: `skills/pull-xhs/scripts/fetch_xhs_note.js`
- 状态: ✅ 已集成

### pull-Twitter
- 主函数: `fetchTwitter(url, { job })`
- 位置: `skills/pull-Twitter/scripts/fetch_twitter.js`
- 状态: ✅ 已集成

### pull-bilibiliInfo
- 主函数 (旧): `fetchBilibiliTranscriptAuto()` - 仅字幕
- 主函数 (新): `fetchBilibili(url, { job })` - 优先 AI 字幕，回落 ASR
- 位置: `skills/pull-bilibiliInfo/scripts/fetch_bilibili.js`
- 状态: ✅ 已实现，AI 字幕优先，视频始终下载

### pull-youtubeInfo
- 主函数 (旧): `fetchYouTubeVideoTranscript()` - 仅字幕
- 主函数 (新): `fetchYoutube(url, { job })` - 优先 AI 字幕，回落 ASR
- 位置: `skills/pull-youtubeInfo/scripts/fetch_youtube.js`
- 状态: ✅ 已实现，AI 字幕优先，视频始终下载

---

## Phase 6: Twitter 转写问题修复 (已完成)

### 问题分析
- **现象**: Twitter 任务下载了 `video.mp4` 和 `upload.wav`，但没有 `transcript.txt`
- **状态**: `index.json` 中状态仍为 "downloading"，未更新为 "processed"
- **根因**:
  1. 转写失败时缺少错误处理和日志记录
  2. 文件重命名后未更新 `transcriptResult` 中的路径引用
  3. 失败时残留 `upload.wav` 未清理
  4. 缺少 timeline 事件记录

### 修复内容
- [x] 修复 `fetch_twitter.js`:
  - 添加转写失败时的错误处理和 timeline 事件
  - 文件重命名后正确更新 `transcriptResult` 路径
  - 失败时自动清理 `upload.wav`
  - 添加 `video_downloaded` 事件记录
  - 正确检测 transcript 文件是否存在再设置 `content_files`
- [x] 同步修复 `fetch_bilibili.js` 和 `fetch_youtube.js` 中的相同问题
- [x] 所有脚本在转写失败时都清理临时文件

---

## Phase 5: YouTube & Bilibili 完整集成 (探索性研究完成)

### 探索性研究结论 ✅
- **可行性报告**: `FEASIBILITY_REPORT.md` 已创建
- **核心工具**: yt-dlp 已在项目中配置 (`AI_YTDLP_COMMAND`)
- **现有功能**:
  - pull-bilibiliInfo: 已有 AI 字幕获取 + 音频下载 (yt-dlp)
  - pull-youtubeInfo: 已有 AI 字幕获取
- **融合方案**: yt-dlp 视频下载 + AI 字幕双路径，统一落盘格式

### 实施计划

#### pull-bilibiliInfo 增强
- [x] 创建 `fetch_bilibili.js` 统一接口
  - 复用 `fetchBilibiliTranscriptAuto()` 获取 AI 字幕
  - 新增 `downloadBilibiliVideo()` 使用 yt-dlp 下载视频
  - 支持回落策略: **AI 字幕优先** → 无字幕时 ASR 转写
- [x] 在 info-grab-manager 中实现 `processBilibiliJob()`
- [x] 测试完整流程: 加入任务 → 处理 → 数据落盘

#### pull-youtubeInfo 增强
- [x] 创建 `fetch_youtube.js` 统一接口
  - 复用 `fetchYouTubeSubtitle()` 获取 AI 字幕
  - 新增 `downloadYouTubeVideo()` 使用 yt-dlp 下载视频
  - 支持回落策略: **AI 字幕优先** → 无字幕时 ASR 转写
- [x] 在 info-grab-manager 中实现 `processYoutubeJob()`
- [ ] 测试完整流程: 加入任务 → 处理 → 数据落盘 (注: YouTube 需要 cookies，暂未测试)

### Phase 7: Bilibili & YouTube 验收测试 (已完成)

**验收标准**:
1. 测试视频确认无字幕
   - YouTube: https://www.youtube.com/watch?v=m_5OLW52JwI (需 cookies，未测试)
   - Bilibili: https://www.bilibili.com/video/BV1Ca411W7v9 ✅
2. 视频能正常下载 ✅
3. 能发送到远端 Whisper 进行 ASR 转写 ✅
4. 能接收回合理长度的转写内容 ✅ (约 8000 字，14 分钟视频)
5. 数据正确落盘 (video.mp4, metadata.json, content.txt, transcript.txt/json/srt) ✅
6. 状态正确更新 (raw → pending → processed) ✅

**测试步骤**:
- [x] 清理之前的测试数据
- [x] 通过 info-grab-manager 添加 Bilibili 任务
- [ ] 通过 info-grab-manager 添加 YouTube 任务 (需 cookies)
- [x] 执行 process 处理所有任务
- [x] 验证转写结果和数据落盘

### 修复的问题汇总
1. **Twitter 转写问题**: 失败时未正确处理，残留 upload.wav，状态未更新
2. **FFmpeg 路径问题**: 空字符串时仍传递 --ffmpeg-location 参数给 yt-dlp
3. **文件重命名问题**: 重命名后未更新 transcriptResult 中的路径引用
4. **错误处理**: 所有平台在转写失败时清理 upload.wav

### 统一接口设计要点
> **用户需求**: 上层只访问 info-grab-manager，加 job 并执行，所有平台返回统一格式
>
> - 不管是 AI 字幕还是翻译完的字幕，都放在 daily_jobs 统一结构里
> - content_files 统一字段: text, transcript, images, video
> - status 统一流转: raw → pending → processed
> - job_timeline.json 统一事件记录

### 数据落盘统一格式
```
downloads/{date}/
├── daily_jobs.json          # 所有平台任务统一管理
├── job_timeline.json         # 所有事件统一记录
├── bilibili/
│   ├── index.json
│   └── {bvid}_{title}/
│       ├── video.mp4          # yt-dlp 下载
│       ├── metadata.json      # 视频元数据
│       ├── content.txt        # 标题 + 描述
│       ├── transcript.txt     # AI 字幕 / ASR 结果
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

### 回落策略
1. **字幕优先**: 先尝试获取平台 AI 字幕 (Chrome CDP)
2. **ASR 回落**: AI 字幕失败 → 下载视频 → 触发 Whisper 转写
3. **降级处理**: 都失败 → 仅保存视频 + 元数据，标记状态
