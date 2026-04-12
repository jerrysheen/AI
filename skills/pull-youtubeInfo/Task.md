# pull-youtubeInfo 任务清单

## 调研总结

参考了三个主流YouTube下载项目：

1. **yt-dlp** (https://github.com/yt-dlp/yt-dlp)
   - 活跃维护的youtube-dl分支
   - 支持 `--cookies-from-browser` 从浏览器加载cookies
   - 使用 `--extractor-args "youtube:player-client=CLIENT"` 切换客户端
   - 2025年后YouTube强制SABR streaming，需cookies或PO token

2. **youtube-dl** (https://github.com/ytdl-org/youtube-dl)
   - 原始项目，更新较慢
   - 支持代理、自定义UA、cookies

3. **YoutubeDownloader** (https://github.com/Tyrrrz/YoutubeDownloader)
   - 使用YoutubeExplode库
   - 提供GUI，支持账户登录

## 问题分析

当前问题：
- YouTube强制SABR streaming (2025年后)
- 无认证时返回403 Forbidden
- iOS/tv客户端需PO token，配置复杂

## 解决方案

采用**字幕优先，视频可选**策略：
1. 优先尝试获取YouTube AI字幕（无需认证）
2. 视频下载设为可选，提供cookies时才尝试
3. 当 metadata 可拿到但字幕不可拿到时，直接按空结果收口，不再默认继续尝试视频下载/ASR
4. 支持 `--cookies-from-browser` 和 `--cookies` 参数

## 使用方式

```bash
# 基础使用（仅字幕，无视频）
node skills/pull-youtubeInfo/scripts/fetch_youtube.js "https://www.youtube.com/watch?v=xxx" --pretty

# 使用浏览器cookies（可下载视频）
node skills/pull-youtubeInfo/scripts/fetch_youtube.js "https://www.youtube.com/watch?v=xxx" --cookies-from-browser chrome --pretty

# 指定 Chrome profile（推荐在有多个 Chrome 资料目录时使用）
node skills/pull-youtubeInfo/scripts/fetch_youtube.js "https://www.youtube.com/watch?v=xxx" --cookies-from-browser "chrome:Profile 2" --max-height 480 --pretty

# 通过info-grab-manager使用
node skills/info-grab-manager/scripts/job_manager.js add "https://www.youtube.com/watch?v=xxx" youtube
node skills/info-grab-manager/scripts/job_manager.js process
```
