# Job Manager Skill

任务管理总控，用于统一管理多平台内容抓取任务。

## 功能

- **add**: 添加新任务（支持自动识别平台类型）
- **fetch**: 抓取任务，如已有结果则复用
- **summarize**: 为已有任务生成 `summary.txt` / `summary.json`
- **fetch-and-summarize**: 抓取并轮询进度，完成后直接生成总结
- **list**: 列出所有任务（支持按状态筛选）
- **process**: 处理待处理任务
- **clear**: 清空所有下载内容
- **clear-jobs**: 清空所有任务记录

## 支持的平台

- TikTok / 抖音
- 小红书 (xhs)
- Twitter (coming soon)

## 使用方法

```bash
# 清空下载内容
node skills/info-grab-manager/scripts/job_manager.js clear

# 清空任务记录
node skills/info-grab-manager/scripts/job_manager.js clear-jobs

# 添加任务（自动识别平台）
node skills/info-grab-manager/scripts/job_manager.js add "https://v.douyin.com/xxxx/"

# 添加任务（指定平台）
node skills/info-grab-manager/scripts/job_manager.js add "https://xhslink.com/xxxx/" xhs

# 抓取任务并立即返回 job_id
node skills/info-grab-manager/scripts/job_manager.js fetch "https://www.bilibili.com/video/BV1xx411c7mD" bilibili

# 为已抓取任务生成总结
node skills/info-grab-manager/scripts/job_manager.js summarize "https://www.bilibili.com/video/BV1xx411c7mD" bilibili

# 抓取并总结，同时输出轮询进度
node skills/info-grab-manager/scripts/job_manager.js fetch-and-summarize "https://www.bilibili.com/video/BV1xx411c7mD" bilibili

# 列出所有任务
node skills/info-grab-manager/scripts/job_manager.js list

# 列出特定状态的任务
node skills/info-grab-manager/scripts/job_manager.js list raw

# 处理所有待处理任务
node skills/info-grab-manager/scripts/job_manager.js process

# 处理单个任务
node skills/info-grab-manager/scripts/job_manager.js process job_20260411_abc123
```

## 任务状态流转

```
raw → pending → processing → processed / failed → translated → summarized → reported
```

- `raw`: 刚添加，未处理
- `pending`: 已入队，等待分发
- `processing`: 正在抓取/下载/转写
- `processed`: 已处理（内容已下载）
- `failed`: 处理失败
- `translated`: 已翻译
- `summarized`: 已摘要
- `reported`: 已生成报告
