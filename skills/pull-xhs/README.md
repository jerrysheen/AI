# pull-xhs

小红书（Xiaohongshu）笔记内容 & 媒体下载模块

## 特点

- 🚧 **开发中...** - 正在紧张开发中
- ✅ **不需要登录/cookies** - 直接解析小红书分享页面
- ✅ 支持分享文本和链接
- ✅ 自动提取笔记信息（标题、作者、内容等）
- ✅ 下载图片和视频到本地
- ✅ 稳定可靠

## 安装依赖

- **Node.js** - 用于内容下载

```bash
# 无需额外依赖
```

## 配置 (.env)

项目会自动读取 `../../.env` 文件中的配置：

```env
# 数据目录
AI_SHARED_DATA_DIR=.ai-data
```

## 使用方法

### 1. 下载笔记内容和媒体

```bash
# 从分享文本中提取并下载
node scripts/fetch_xhs_note.js "分享文案... https://xhslink.com/xxxxx/" --pretty

# 直接使用链接
node scripts/fetch_xhs_note.js "https://www.xiaohongshu.com/explore/xxxxx" --pretty
```

## 输出格式

### fetch_xhs_note.js（笔记内容+媒体）

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

## 文件存储位置

默认使用 `.ai-data` 目录：

```
.ai-data/
├── image/xhs/      # 图片文件
│   └── {note_id}_{index}.jpg
└── video/xhs/      # 视频文件
    └── {note_id}_{index}.mp4
```

## 技术方案

- **内容抓取**: 正在研究中...
