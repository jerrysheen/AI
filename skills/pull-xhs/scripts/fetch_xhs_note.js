#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const {
  getXhsDownloadDir,
  ensureDir,
  getTaskItemDir,
  getTaskImagesDir,
  sanitizeDirName,
  addJobToDailyJobs,
  updateJobStatus,
  addTimelineEvent,
  addTaskToPlatformIndex,
  updateTaskInPlatformIndex,
  detectContentTypeFromData,
} = require("./runtime_shim");

// ==================== 稳健性配置 ====================
const CONFIG = {
  // 请求延迟（毫秒）
  requestDelayMs: 2000,
  // 媒体下载延迟（毫秒）
  mediaDownloadDelayMs: 500,
  // User-Agent 轮换池
  userAgents: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  ],
  // 缓存目录
  cacheDir: path.join(__dirname, "..", ".cache"),
  // 缓存有效期（毫秒）- 24小时
  cacheTtlMs: 24 * 60 * 60 * 1000,
};

let lastRequestTime = 0;

// 随机选择 User-Agent
function getRandomUserAgent() {
  return CONFIG.userAgents[Math.floor(Math.random() * CONFIG.userAgents.length)];
}

// 请求延迟，避免频繁请求
async function rateLimit(delayMs = CONFIG.requestDelayMs) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < delayMs) {
    await new Promise(resolve => setTimeout(resolve, delayMs - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(CONFIG.cacheDir)) {
    fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
  }
}

// 生成缓存键
function getCacheKey(url) {
  const urlObj = new URL(url);
  // 只保留路径部分，去掉查询参数（如 xsec_token 等临时参数）
  const cleanPath = urlObj.pathname;
  return `xhs_page_${Buffer.from(cleanPath).toString("base64url")}.json`;
}

// 从缓存读取
function getFromCache(url) {
  ensureCacheDir();
  const cacheKey = getCacheKey(url);
  const cachePath = path.join(CONFIG.cacheDir, cacheKey);

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      const age = Date.now() - cached.timestamp;
      if (age < CONFIG.cacheTtlMs) {
        return cached.data;
      }
    } catch (e) {
      // 缓存读取失败，忽略
    }
  }
  return null;
}

// 写入缓存
function saveToCache(url, data) {
  ensureCacheDir();
  const cacheKey = getCacheKey(url);
  const cachePath = path.join(CONFIG.cacheDir, cacheKey);

  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      timestamp: Date.now(),
      url: url,
      data: data,
    }, null, 2), "utf8");
  } catch (e) {
    // 缓存写入失败，忽略
  }
}

// 从输入文本中提取小红书链接
function extractXhsUrl(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const patterns = [
    /(https?:\/\/www\.xiaohongshu\.com\/explore\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/www\.xiaohongshu\.com\/discovery\/item\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/xhslink\.com\/[^\s<>"'{}|\\^`\[\]]+)/,
  ];

  for (const pattern of patterns) {
    const match = String(inputText).match(pattern);
    if (match) {
      return match[1];
    }
  }

  const trimmed = String(inputText).trim();
  if (trimmed && !trimmed.includes(" ") && trimmed.length > 5) {
    if (/^\d+$/.test(trimmed)) {
      return `https://www.xiaohongshu.com/explore/${trimmed}`;
    }
  }

  throw new Error(`Unable to extract Xiaohongshu URL from input: ${inputText.slice(0, 100)}`);
}

// 解析短链接（带请求限制）
async function resolveShortUrl(shortUrl) {
  await rateLimit();

  return new Promise((resolve, reject) => {
    const url = new URL(shortUrl);
    const client = url.protocol === "https:" ? https : http;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.xiaohongshu.com/",
      },
    };

    let data = "";
    const req = client.request(options, (res) => {
      if (res.headers.location) {
        resolve(res.headers.location);
        return;
      }

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        // 如果没有重定向但有内容，检查是否有 meta refresh
        const metaRefresh = data.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"'>]+)["']/i);
        if (metaRefresh) {
          resolve(metaRefresh[1]);
          return;
        }
        resolve(shortUrl);
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// 修复 JSON 中的 trailing commas（类似 YAML 解析）
function fixJsonForParsing(jsonStr) {
  // 移除单行注释
  let fixed = jsonStr.replace(/\/\/[^\n]*$/gm, "");
  // 移除多行注释
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, "");

  // 处理对象中的 trailing commas
  fixed = fixed.replace(/,(\s*[}\]])/g, "$1");

  // 处理数组中的 trailing commas
  fixed = fixed.replace(/,(\s*\])/g, "$1");

  return fixed;
}

// 从页面中提取笔记数据
function extractNoteData(html) {
  // 查找所有 script 标签
  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  // 反向查找，因为 __INITIAL_STATE__ 通常在页面后面
  const scripts = [];
  while ((match = scriptPattern.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  scripts.reverse();

  for (const script of scripts) {
    if (script.includes("window.__INITIAL_STATE__")) {
      try {
        // 使用 eval 在沙箱中解析（仅用于解析已知来源的页面数据）
        const window = {};
        // eslint-disable-next-line no-eval
        eval(script);

        if (window.__INITIAL_STATE__) {
          return window.__INITIAL_STATE__;
        }
      } catch (e) {
        continue;
      }
    }
  }

  throw new Error("window.__INITIAL_STATE__ not found in page");
}

// 深度获取对象中的值
function deepGet(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (key.startsWith("[") && key.endsWith("]")) {
      // 数组索引
      const index = parseInt(key.slice(1, -1), 10);
      if (Array.isArray(current)) {
        current = current[index];
      } else if (typeof current === "object") {
        // 如果是对象，尝试获取 values 数组的对应索引
        const values = Object.values(current);
        current = values[index];
      } else {
        return undefined;
      }
    } else {
      current = current[key];
    }
  }
  return current;
}

// 从数据中提取笔记信息
function extractNoteInfo(pageData) {
  // 尝试多种路径来找到笔记数据
  let note = null;
  let noteId = null;

  // 路径1: note.noteDetailMap.{noteId}.note - 需要从 firstNoteId 获取 noteId
  if (pageData.note && pageData.note.firstNoteId) {
    noteId = pageData.note.firstNoteId;
    if (pageData.note.noteDetailMap && pageData.note.noteDetailMap[noteId]) {
      note = pageData.note.noteDetailMap[noteId].note;
    }
  }

  // 路径2: 尝试从 currentNoteId 获取
  if (!note && pageData.note && pageData.note.currentNoteId) {
    noteId = pageData.note.currentNoteId;
    if (pageData.note.noteDetailMap && pageData.note.noteDetailMap[noteId]) {
      note = pageData.note.noteDetailMap[noteId].note;
    }
  }

  // 路径3: noteDetailMap 的第一个值
  if (!note && pageData.note && pageData.note.noteDetailMap) {
    const keys = Object.keys(pageData.note.noteDetailMap);
    if (keys.length > 0) {
      noteId = keys[0];
      note = pageData.note.noteDetailMap[noteId].note;
    }
  }

  // 路径4: 尝试移动端路径
  if (!note) {
    const phoneKeys = ["noteData", "data", "noteData"];
    note = deepGet(pageData, phoneKeys);
  }

  if (!note) {
    throw new Error("Note data not found in __INITIAL_STATE__");
  }

  // 提取图片 URL
  const imageUrls = [];
  const imageList = note.imageList || note.image_list || [];
  for (const img of imageList) {
    // 尝试不同的图片 URL 路径
    let url = null;
    if (img.url) {
      url = img.url;
    } else if (img.urlDefault) {
      url = img.urlDefault;
    } else if (img.infoList && img.infoList.length > 0) {
      url = img.infoList[0].url;
    } else if (img.traceId) {
      // 使用 CDN 拼接
      url = `https://sns-img-bd.xhscdn.com/${img.traceId}`;
    }

    if (url) {
      // 确保 URL 是完整的
      if (!url.startsWith("http")) {
        url = `https:${url}`;
      }
      imageUrls.push(url);
    }
  }

  // 提取视频 URL
  const videoUrls = [];
  if (note.video) {
    let videoUrl = null;
    if (note.video.media && note.video.media.stream && note.video.media.stream.h264 && note.video.media.stream.h264.length > 0) {
      videoUrl = note.video.media.stream.h264[0].masterUrl;
    } else if (note.video.consumer && note.video.consumer.originVideoKey) {
      videoUrl = `https://sns-video-bd.xhscdn.com/${note.video.consumer.originVideoKey}`;
    } else if (note.video.videoUrl) {
      videoUrl = note.video.videoUrl;
    }

    if (videoUrl) {
      if (!videoUrl.startsWith("http")) {
        videoUrl = `https:${videoUrl}`;
      }
      videoUrls.push(videoUrl);
    }
  }

  // 提取交互信息
  const interactInfo = note.interactInfo || {};

  // 提取用户信息
  const user = note.user || {};

  return {
    note_id: note.noteId || note.note_id || "",
    title: note.title || "",
    content: note.desc || note.content || "",
    author: user.nickname || user.nickName || "",
    author_id: user.userId || user.user_id || "",
    image_urls: imageUrls,
    video_urls: videoUrls,
    create_time: note.time || note.create_time || 0,
    last_update_time: note.lastUpdateTime || 0,
    type: note.type || "normal",
    likes: interactInfo.likedCount || interactInfo.like_count || 0,
    collects: interactInfo.collectedCount || interactInfo.collect_count || 0,
    comments: interactInfo.commentCount || interactInfo.comment_count || 0,
    shares: interactInfo.shareCount || interactInfo.share_count || 0,
    tag_list: (note.tagList || []).map(t => t.name || "").filter(Boolean),
  };
}

// 获取页面内容（带缓存和请求限制）
async function fetchPage(url, useCache = true) {
  // 先尝试从缓存读取
  if (useCache) {
    const cached = getFromCache(url);
    if (cached) {
      return cached;
    }
  }

  // 请求速率限制
  await rateLimit();

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.xiaohongshu.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    };

    let data = "";
    const req = client.request(options, (res) => {
      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let newLocation = res.headers.location;
        if (!newLocation.startsWith("http")) {
          newLocation = new URL(newLocation, url).toString();
        }
        fetchPage(newLocation, false).then(resolve).catch(reject);
        return;
      }

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        // 保存到缓存
        if (data.includes("window.__INITIAL_STATE__")) {
          saveToCache(url, data);
        }
        resolve(data);
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.end();
  });
}

// 下载媒体文件（支持重定向，带请求限制）
async function downloadMediaFile(mediaUrl, outputPath, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error("Too many redirects");
  }

  // 如果文件已存在，直接返回文件大小
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    return stats.size;
  }

  // 媒体文件下载速率限制
  await rateLimit(CONFIG.mediaDownloadDelayMs);

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(mediaUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Referer": "https://www.xiaohongshu.com/",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    };

    let fileStream = null;
    let totalBytes = 0;

    const req = client.request(options, (res) => {
      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (fileStream) {
          fileStream.close();
          fs.rmSync(outputPath, { force: true });
        }
        let newLocation = res.headers.location;
        if (!newLocation.startsWith("http")) {
          newLocation = new URL(newLocation, mediaUrl).toString();
        }
        downloadMediaFile(newLocation, outputPath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        if (fileStream) {
          fileStream.close();
          fs.rmSync(outputPath, { force: true });
        }
        reject(new Error(`HTTP ${res.statusCode} while downloading media`));
        return;
      }

      fileStream = fs.createWriteStream(outputPath);
      res.pipe(fileStream);

      res.on("data", (chunk) => {
        totalBytes += chunk.length;
      });

      fileStream.on("finish", () => {
        fileStream.close(() => {
          resolve(totalBytes);
        });
      });
    });

    req.on("error", (err) => {
      if (fileStream) {
        fileStream.close();
        fs.rmSync(outputPath, { force: true });
      }
      reject(err);
    });

    req.setTimeout(180000, () => {
      req.destroy();
      if (fileStream) {
        fileStream.close();
      }
      reject(new Error("Download timeout"));
    });

    req.end();
  });
}

// 主函数
async function fetchXhsNote(inputTextOrUrl, options = {}) {
  const date = options.date || new Date();
  let job = options.job || null;
  let taskDir = null;
  let imagesDir = null;
  let jobId = null;

  const result = {
    source_url: null,
    resolved_url: null,
    note_id: null,
    title: null,
    content: null,
    author: null,
    author_id: null,
    type: null,
    create_time: null,
    last_update_time: null,
    tags: [],
    likes: 0,
    collects: 0,
    comments: 0,
    shares: 0,
    image_paths: [],
    image_exists: [],
    image_sizes: [],
    image_urls: [],
    video_paths: [],
    video_exists: [],
    video_sizes: [],
    video_urls: [],
    text_path: null,
    text_exists: false,
    metadata_path: null,
    metadata_exists: false,
    content_type: { has_video: false, has_images: false, has_text: false },
    task_dir: null,
    job_id: null,
    error: null,
    error_hint: null,
  };

  try {
    const sourceUrl = extractXhsUrl(inputTextOrUrl);
    result.source_url = sourceUrl;

    let resolvedUrl = sourceUrl;
    if (sourceUrl.includes("xhslink.com")) {
      resolvedUrl = await resolveShortUrl(sourceUrl);
    }
    result.resolved_url = resolvedUrl;

    const html = await fetchPage(resolvedUrl);
    const pageData = extractNoteData(html);
    const noteInfo = extractNoteInfo(pageData);

    result.note_id = noteInfo.note_id;
    result.title = noteInfo.title;
    result.content = noteInfo.content;
    result.author = noteInfo.author;
    result.author_id = noteInfo.author_id;
    result.type = noteInfo.type;
    result.create_time = noteInfo.create_time;
    result.last_update_time = noteInfo.last_update_time;
    result.tags = noteInfo.tag_list;
    result.likes = noteInfo.likes;
    result.collects = noteInfo.collects;
    result.comments = noteInfo.comments;
    result.shares = noteInfo.shares;
    result.image_urls = noteInfo.image_urls;
    result.video_urls = noteInfo.video_urls;

    // 检测内容类型
    result.content_type = {
      has_video: noteInfo.video_urls.length > 0,
      has_images: noteInfo.image_urls.length > 0,
      has_text: !!(noteInfo.title || noteInfo.content),
    };

    // 获取或创建任务目录
    taskDir = getTaskItemDir("xhs", noteInfo.title || noteInfo.note_id, noteInfo.note_id, date);
    imagesDir = getTaskImagesDir("xhs", noteInfo.title || noteInfo.note_id, noteInfo.note_id, date);
    ensureDir(taskDir);
    ensureDir(imagesDir);
    result.task_dir = taskDir;

    // 添加到 daily_jobs.json（如果没有传入 job）
    if (!job) {
      job = addJobToDailyJobs({
        source: "xhs",
        source_url: sourceUrl,
        title: noteInfo.title || "小红书笔记",
        content_type: result.content_type,
        status: "pending",
      });
      jobId = job.job_id;
      result.job_id = jobId;

      // 添加时间线事件
      addTimelineEvent({
        action: "job_created",
        job_id: jobId,
        content_type: result.content_type,
        details: "从直接输入链接创建任务",
      }, date);
    } else {
      jobId = job.job_id;
      result.job_id = jobId;
    }

    // 添加到平台索引
    addTaskToPlatformIndex("xhs", {
      task_id: noteInfo.note_id,
      job_id: jobId,
      title: noteInfo.title,
      author: noteInfo.author,
      content_type: result.content_type,
      status: "downloading",
      dir_path: path.relative(path.join(getXhsDownloadDir(date), ".."), taskDir),
    }, date);

    const metadataPath = path.join(taskDir, "metadata.json");
    const contentPath = path.join(taskDir, "content.txt");

    // 下载图片
    for (let i = 0; i < noteInfo.image_urls.length; i++) {
      const ext = noteInfo.image_urls[i].match(/\.(webp|jpe?g|png|heic)(?:\?|$)/i) ? "" : ".jpg";
      const outputPath = path.join(imagesDir, `img${i}${ext}`);
      try {
        const downloadedBytes = await downloadMediaFile(noteInfo.image_urls[i], outputPath);
        result.image_paths.push(outputPath);
        result.image_sizes.push(downloadedBytes);
        result.image_exists.push(true);
      } catch (e) {
        result.image_paths.push(outputPath);
        result.image_sizes.push(0);
        result.image_exists.push(false);
      }
    }

    // 下载视频并转写
    result.video_transcripts = [];
    for (let i = 0; i < noteInfo.video_urls.length; i++) {
      const outputPath = path.join(taskDir, `video.mp4`);
      let transcriptResult = null;
      try {
        const downloadedBytes = await downloadMediaFile(noteInfo.video_urls[i], outputPath);
        result.video_paths.push(outputPath);
        result.video_sizes.push(downloadedBytes);
        result.video_exists.push(true);

        // 视频下载成功后进行转写
        try {
          const { transcribeVideo } = require("../../../src/shared/video_transcriber");
          transcriptResult = await transcribeVideo(outputPath, {
            keepWav: false,
            outputDir: taskDir,
          });
          // 重命名转录文件为统一名称
          if (transcriptResult) {
            const targetTranscriptPath = path.join(taskDir, "transcript.txt");
            const targetJsonPath = path.join(taskDir, "transcript.json");
            const targetSrtPath = path.join(taskDir, "transcript.srt");

            // 重命名 transcript.txt
            if (transcriptResult.transcript_path && fs.existsSync(transcriptResult.transcript_path) && transcriptResult.transcript_path !== targetTranscriptPath) {
              fs.renameSync(transcriptResult.transcript_path, targetTranscriptPath);
            }
            // 重命名 transcript.json
            if (transcriptResult.transcript_json_path && fs.existsSync(transcriptResult.transcript_json_path) && transcriptResult.transcript_json_path !== targetJsonPath) {
              fs.renameSync(transcriptResult.transcript_json_path, targetJsonPath);
            }
            // 重命名 transcript.srt
            if (transcriptResult.transcript_srt_path && fs.existsSync(transcriptResult.transcript_srt_path) && transcriptResult.transcript_srt_path !== targetSrtPath) {
              fs.renameSync(transcriptResult.transcript_srt_path, targetSrtPath);
            }
          }
        } catch (transcribeError) {
          console.error("Transcribe error:", transcribeError.message);
        }
      } catch (e) {
        result.video_paths.push(outputPath);
        result.video_sizes.push(0);
        result.video_exists.push(false);
      }
      result.video_transcripts.push(transcriptResult);
    }

    // 保存文字描述到文件
    try {
      let textContent = "";
      if (noteInfo.title) {
        textContent += `${noteInfo.title}\n\n`;
      }
      if (noteInfo.content) {
        textContent += `${noteInfo.content}\n`;
      }
      fs.writeFileSync(contentPath, textContent, "utf8");
      result.text_path = contentPath;
      result.text_exists = true;
    } catch (e) {
      result.text_path = contentPath;
      result.text_exists = false;
    }

    // 保存完整元数据到 JSON 文件
    try {
      fs.writeFileSync(metadataPath, JSON.stringify(noteInfo, null, 2), "utf8");
      result.metadata_path = metadataPath;
      result.metadata_exists = true;
    } catch (e) {
      result.metadata_path = metadataPath;
      result.metadata_exists = false;
    }

    // 构建 content_files 对象
    const contentFiles = {
      text: "content.txt",
      transcript: noteInfo.video_urls.length > 0 ? "transcript.txt" : null,
      images: noteInfo.image_urls.length > 0 ? "images/" : null,
      video: noteInfo.video_urls.length > 0 ? "video.mp4" : null,
    };

    // 更新状态为 processed
    updateJobStatus(jobId, "processed", {
      title: result.title || "小红书笔记",
      content_type: result.content_type,
      data_path: path.relative(path.dirname(getXhsDownloadDir(date)), taskDir),
      content_files: contentFiles,
    });

    updateTaskInPlatformIndex("xhs", noteInfo.note_id, {
      title: result.title || "小红书笔记",
      author: result.author,
      content_type: result.content_type,
      status: "processed",
      files: {
        metadata: "metadata.json",
        content: "content.txt",
        transcript: contentFiles.transcript,
        translated: null,
        summary: null,
        images_dir: contentFiles.images,
        video_file: contentFiles.video,
      },
    }, date);

    addTimelineEvent({
      action: "processed",
      job_id: jobId,
      details: "笔记内容下载完成",
    }, date);

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.error_hint = error.stack || null;

    if (jobId) {
      updateJobStatus(jobId, "processed", {
        notes: `处理失败: ${result.error}`,
      });
      addTimelineEvent({
        action: "error",
        job_id: jobId,
        details: `处理失败: ${result.error}`,
      }, date);
    }
  }

  return result;
}

function parseArgs(argv) {
  const args = {
    input: null,
    outputDir: null,
    pretty: false,
    writeJson: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.input) {
        args.input = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--output-dir") {
      args.outputDir = nextValue;
    } else if (token === "--write-json") {
      args.writeJson = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node fetch_xhs_note.js <input_text_or_url> " +
        "[--output-dir ./downloads] [--write-json path] [--pretty]\n\n" +
        "Example:\n" +
        "  node scripts/fetch_xhs_note.js \"https://xhslink.com/xxxxx/\" --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchXhsNote(args.input, {
      outputDir: args.outputDir,
    });
    const output = JSON.stringify(data, null, args.pretty ? 2 : 0);
    process.stdout.write(`${output}\n`);

    if (args.writeJson) {
      const outputPath = path.resolve(args.writeJson);
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    }

    process.exitCode = data.error ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractXhsUrl,
  resolveShortUrl,
  extractNoteData,
  extractNoteInfo,
  fetchXhsNote,
  parseArgs,
};
