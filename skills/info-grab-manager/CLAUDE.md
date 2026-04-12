# Job Manager Skill

这是任务管理总控 skill，用于协调各个平台的内容抓取任务。

## 目录结构

```
info-grab-manager/
├── SKILL.md              # Skill 定义
├── CLAUDE.md             # 本文档
├── api/
│   └── index.js          # API 入口
├── scripts/
│   └── job_manager.js    # 主脚本
└── config/               # 配置文件
```

## 与其他 Skill 的集成

- pull-tiktok: 处理抖音/ TikTok 视频
- pull-xhs: 处理小红书笔记
- pull-Twitter: 处理 Twitter 推文

## 数据存储

任务数据存储在 `downloads/daily_jobs.json`，按日期组织下载内容。
