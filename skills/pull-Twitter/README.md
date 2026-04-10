# pull-Twitter

Twitter/X 内容抓取模块，**无需登录**即可获取用户推文、单条推文，以及 **Twitter Notes 长文/文章**。

## 工作原理

**双轨制抓取方案**：

1. **Nitter RSS**（优先）：快速、无需浏览器，用于普通短推文
2. **Chrome CDP**（备选）：当检测到长文/文章时，自动使用 Chrome 浏览器抓取完整内容

## 安装

无需额外安装依赖，但需要 Chrome 浏览器用于抓取长文。

## 使用方式

### 命令行使用

```bash
# 获取用户最新推文（默认 20 条）
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "@username" --pretty

# 使用用户名（不带 @）
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "username" --pretty

# 指定数量
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "username" --limit 10 --pretty

# 获取单条推文（自动检测是否为长文）
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "https://x.com/username/status/1234567890" --pretty

# 强制使用 Chrome CDP（即使是短推文）
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "https://x.com/username/status/12345" --force-chrome --pretty

# 增强用户时间线中的所有文章推文
node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "@username" --enhance-all --pretty

# 下载单条视频推文的 mp4 文件
node skills/pull-Twitter/scripts/download_twitter_video.js "https://x.com/username/status/12345" --pretty

# 指定目标码率和输出路径
node skills/pull-Twitter/scripts/download_twitter_video.js "https://x.com/username/status/12345" --bitrate 832000 --output assets/downloads/sample.mp4 --pretty

# 对本地视频做全量转录，并输出 txt/json/srt
# 该命令现在是 skills/autoTranslate 的兼容包装器，结果会落到 repo-root .ai-data/auto-translate 下
node skills/pull-Twitter/scripts/transcribe_video_local.js assets/downloads/sample.mp4

# 先测试 60 秒片段速度
node skills/pull-Twitter/scripts/transcribe_video_local.js assets/downloads/sample.mp4 --clip-seconds 60

# 如果只想优先测速度，可切回 tiny
node skills/pull-Twitter/scripts/transcribe_video_local.js assets/downloads/sample.mp4 --model-size tiny
```

### API 使用

```javascript
const { fetchTwitter, fetchTwitterEnhanced } = require('./api');

// 自动识别输入类型（用户名或推文 URL）
const result = await fetchTwitter('@username');
const result2 = await fetchTwitter('https://x.com/username/status/12345');

// 对于文章推文，会自动使用 Chrome CDP 获取完整内容
const articleResult = await fetchTwitter('https://x.com/username/status/1234567890');
if (articleResult.tweet.enriched_by_chrome) {
  console.log('已获取完整长文内容！');
}
```

## 推文类型检测

每条推文都包含以下标记，用于自动判断抓取方式：

| 标记 | 说明 |
|------|------|
| `is_article` | 是否为文章/长文链接 |
| `has_video` | 是否包含视频 |
| `is_short_content` | 是否为短内容（< 100 字符）|
| `is_only_link` | 是否仅包含链接 |
| `needs_chrome` | 是否建议使用 Chrome CDP |
| `enriched_by_chrome` | 是否已通过 Chrome CDP 增强 |

## 输出格式

### 单条推文（长文）

```json
{
  "source": "hybrid_nitter_chrome",
  "instance": "https://nitter.net",
  "chrome_used": true,
  "found": true,
  "tweet": {
    "tweet_id": "1234567890",
    "tweet_url": "https://x.com/username/status/1234567890",
    "text": "完整的长文内容...",
    "author_handle": "@username",
    "published_at": "Tue, 07 Apr 2026 07:44:30 GMT",
    "published_timestamp": 1775547870,
    "is_article": true,
    "needs_chrome": true,
    "enriched_by_chrome": true
  }
}
```

### 用户时间线

```json
{
  "source": "nitter_rss",
  "user_ref": "@username",
  "handle": "username",
  "tweet_count": 20,
  "tweets": [
    {
      "tweet_id": "12345",
      "text": "普通短推文内容",
      "is_article": false,
      "needs_chrome": false
    }
  ]
}
```

## 配置

内置多个 Nitter 实例作为备选，自动故障转移：

```javascript
const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.nixnet.services",
];
```

## 限制

- 单条推文需要在用户最新推文中才能通过 Nitter 找到
- Chrome CDP 需要本地 Chrome 浏览器
- Nitter 实例可用性可能随时间变化
- 在受限沙箱或 DNS 受限环境中，Nitter 域名解析可能失败；应在真实联网环境下做最终验收
- 视频下载当前依赖公开 syndication 接口暴露 `video_info.variants`；若 X 后续调整返回结构，需要同步更新脚本
- 视频文件已可下载；Twitter 目录下的本地转录命令当前复用 `skills/autoTranslate`，避免维护两套转录实现
- 本地转录当前走 `whisper.cpp` 的 CPU 路线；实际质量和速度取决于所选模型与机器配置
