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

# 添加新任务
node skills/info-grab-manager/scripts/job_manager.js add <url> [source]

# 处理任务
node skills/info-grab-manager/scripts/job_manager.js process [jobId]
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
raw → pending → processed → translated → summarized → reported
```
