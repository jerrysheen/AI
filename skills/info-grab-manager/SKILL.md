---
name: info-grab-manager
description: 任务管理总控 - 管理多平台内容抓取任务的添加、处理和状态跟踪
---

# Job Manager Skill

任务管理总控，用于统一管理来自不同平台（TikTok、小红书、Twitter等）的内容抓取任务。

## 触发方式

```bash
# 清空下载内容
node skills/info-grab-manager/scripts/job_manager.js clear

# 列出所有任务
node skills/info-grab-manager/scripts/job_manager.js list [status]

# 只抓取
node skills/info-grab-manager/scripts/job_manager.js fetch <url> [source]

# 只总结已有任务
node skills/info-grab-manager/scripts/job_manager.js summarize <url|jobId> [source]

# 抓取并总结
node skills/info-grab-manager/scripts/job_manager.js fetch-and-summarize <url> [source]
```

## 调用约定

- 如果用户说“抓取 xxx”，优先使用 `fetch`
- 如果用户说“总结 xxx”，优先使用 `summarize`
- 如果用户说“抓取并总结 xxx”或“看这个视频说了什么”，必须使用 `fetch-and-summarize`
- 不要再用 `add + process` 两步流来承接“抓取并总结”场景；那种调用方式不会主动向上层输出轮询进度

## API 接口

```js
const api = require("./skills/info-grab-manager/api");

const started = await api.fetchJob("https://www.bilibili.com/video/BV1zFPpzxECA", "bilibili");
// => { job_id, status, progress, reused_existing_job? }

const status = api.getJobStatus(started.job_id);
// => { status, progress, is_terminal, data_path, content_files, ... }

const done = await api.waitForJob(started.job_id, {
  timeoutMs: 10 * 60 * 1000,
  pollIntervalMs: 2000,
});

const summarized = api.summarizeJob("https://www.bilibili.com/video/BV1zFPpzxECA", "bilibili");
// => { title, summary_text, summary_txt_path, summary_json_path, artifacts }

const finalResult = await api.fetchAndSummarize("https://www.bilibili.com/video/BV1zFPpzxECA", "bilibili");
// => 已抓取则直接复用，否则先抓取再输出 summary.txt / summary.json
```

## 输出格式

### add 命令
```
Added job: job_20260411_abc123
  Source: tiktok
  URL: https://v.douyin.com/xxxx/
```

### list 命令
```
=== Jobs (2/5) ===

[pending] job_20260411_abc123
  Source: tiktok - Video Title
  URL: https://v.douyin.com/xxxx/
  Content: video=true images=false text=true
  Created: 2026-04-11T10:30:00.000Z

=== Statistics ===
{
  "total": 5,
  "by_content_type": { ... },
  "by_status": { ... }
}
```

## 任务状态流转

```
raw → pending → processing → processed / failed → translated → summarized → reported
```

其中 `progress` 会暴露阶段和进度，例如：

```json
{
  "stage": "fetching_subtitle",
  "percent": 60,
  "message": "正在获取字幕",
  "updated_at": "2026-04-12T14:18:23.715Z"
}
```
