#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const {
  getTikTokDownloadDir,
  ensureDir,
  getTaskItemDir,
  sanitizeDirName,
  addJobToDailyJobs,
  updateJobStatus,
  addTimelineEvent,
  addTaskToPlatformIndex,
  updateTaskInPlatformIndex,
  detectContentTypeFromData,
} = require("./runtime_shim");

// 从输入文本中提取抖音链接
function extractDouyinUrl(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const patterns = [
    /(https?:\/\/www\.douyin\.com\/video\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/www\.iesdouyin\.com\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/v\.douyin\.com\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/m\.douyin\.com\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/(?:www\.)?tiktok\.com\/@[^\/]+\/video\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/vm\.tiktok\.com\/[^\s<>"'{}|\\^`\[\]]+)/,
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
      return `https://www.douyin.com/video/${trimmed}`;
    }
  }

  throw new Error(`Unable to extract Douyin/TikTok URL from input: ${inputText.slice(0, 100)}`);
}

// 解析短链接
async function resolveShortUrl(shortUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(shortUrl);
    const client = url.protocol === "https:" ? https : http;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
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

// 从页面中提取 _ROUTER_DATA
function extractRouterData(html) {
  // 查找 window._ROUTER_DATA = ...
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      // 尝试修复一些常见的 JSON 问题
      let fixed = match[1];
      // 移除尾随逗号
      fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
      try {
        return JSON.parse(fixed);
      } catch (e2) {
        throw new Error("Failed to parse _ROUTER_DATA");
      }
    }
  }

  // 尝试查找 _ROUTER_DATA 的其他格式
  const match2 = html.match(/_ROUTER_DATA\s*[:=]\s*(\{[\s\S]*?\})\s*(?:,|;|$)/);
  if (match2) {
    try {
      return JSON.parse(match2[1]);
    } catch (e) {
      // 继续尝试
    }
  }

  throw new Error("_ROUTER_DATA not found in page");
}

// 从 _ROUTER_DATA 中提取视频信息
function extractVideoInfo(routerData) {
  const loaderData = routerData?.loaderData;
  if (!loaderData) {
    throw new Error("loaderData not found in _ROUTER_DATA");
  }

  // 查找视频信息
  let videoInfoRes = null;

  // 尝试几种常见的路径
  for (const key of Object.keys(loaderData)) {
    if (key.includes("video_") || key.includes("video/")) {
      const data = loaderData[key];
      if (data?.videoInfoRes?.item_list?.length > 0) {
        videoInfoRes = data.videoInfoRes;
        break;
      }
      if (data?.item_list?.length > 0) {
        videoInfoRes = data;
        break;
      }
    }
  }

  if (!videoInfoRes?.item_list?.length) {
    throw new Error("Video item_list not found");
  }

  const item = videoInfoRes.item_list[0];
  const video = item.video;

  if (!video?.play_addr?.url_list?.length) {
    throw new Error("Video play address not found");
  }

  return {
    video_id: item.aweme_id,
    title: item.desc || "",
    author: item.author?.nickname || item.author?.unique_id || "",
    author_id: item.author?.sec_uid || item.author?.short_id || "",
    play_url: video.play_addr.url_list[0],
    cover_url: video.cover?.url_list?.[0] || "",
    duration: video.duration || 0,
    width: video.width || 0,
    height: video.height || 0,
    create_time: item.create_time || 0,
    statistics: {
      comment_count: item.statistics?.comment_count || 0,
      digg_count: item.statistics?.digg_count || 0,
      share_count: item.statistics?.share_count || 0,
      collect_count: item.statistics?.collect_count || 0,
    },
  };
}

// 获取页面内容
async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.douyin.com/",
      },
    };

    let data = "";
    const req = client.request(options, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
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

// 下载视频文件（支持重定向）
async function downloadVideoFile(videoUrl, outputPath, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error("Too many redirects");
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(videoUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.douyin.com/",
        "Accept": "video/webm,video/ogg,video/*;q=0.9,*/*;q=0.8",
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
        downloadVideoFile(res.headers.location, outputPath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        if (fileStream) {
          fileStream.close();
          fs.rmSync(outputPath, { force: true });
        }
        reject(new Error(`HTTP ${res.statusCode} while downloading video`));
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
async function fetchTikTokVideo(inputTextOrUrl, options = {}) {
  const date = options.date || new Date();
  let job = options.job || null;
  let taskDir = null;
  let jobId = null;

  const result = {
    source_url: null,
    resolved_url: null,
    video_id: null,
    file_path: null,
    file_exists: false,
    file_size: null,
    title: null,
    author: null,
    transcript: null,
    content_type: { has_video: false, has_images: false, has_text: false },
    task_dir: null,
    job_id: null,
    error: null,
    error_hint: null,
  };

  try {
    const sourceUrl = extractDouyinUrl(inputTextOrUrl);
    result.source_url = sourceUrl;

    let resolvedUrl = sourceUrl;
    if (sourceUrl.includes("v.douyin.com") || sourceUrl.includes("vm.tiktok.com")) {
      resolvedUrl = await resolveShortUrl(sourceUrl);
    }
    result.resolved_url = resolvedUrl;

    const html = await fetchPage(resolvedUrl);
    const routerData = extractRouterData(html);
    const videoInfo = extractVideoInfo(routerData);

    result.video_id = videoInfo.video_id;
    result.title = videoInfo.title;
    result.author = videoInfo.author;
    result.content_type = {
      has_video: true,
      has_images: false,
      has_text: !!(videoInfo.title || videoInfo.desc),
    };
    result._play_url = videoInfo.play_url;

    // 获取或创建任务目录
    taskDir = getTaskItemDir("tiktok", videoInfo.title, videoInfo.video_id, date);
    ensureDir(taskDir);
    result.task_dir = taskDir;

    // 添加到 daily_jobs.json（如果没有传入 job）
    if (!job) {
      job = addJobToDailyJobs({
        source: "tiktok",
        source_url: sourceUrl,
        title: videoInfo.title || "抖音视频",
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
    addTaskToPlatformIndex("tiktok", {
      task_id: videoInfo.video_id,
      job_id: jobId,
      title: videoInfo.title,
      author: videoInfo.author,
      content_type: result.content_type,
      status: "downloading",
      dir_path: path.relative(path.join(getTikTokDownloadDir(date), ".."), taskDir),
    }, date);

    const outputPath = path.join(taskDir, "video.mp4");
    const metadataPath = path.join(taskDir, "metadata.json");
    const contentPath = path.join(taskDir, "content.txt");

    // 保存文字内容
    if (videoInfo.title) {
      try {
        fs.writeFileSync(contentPath, videoInfo.title, "utf8");
      } catch (e) {
        // 忽略
      }
    }

    try {
      const downloadedBytes = await downloadVideoFile(videoInfo.play_url, outputPath);
      result.file_path = outputPath;
      result.file_size = downloadedBytes;

      if (fs.existsSync(outputPath)) {
        result.file_exists = true;
        const stats = fs.statSync(outputPath);
        if (!result.file_size) {
          result.file_size = stats.size;
        }
      }

      // 保存元数据
      try {
        fs.writeFileSync(metadataPath, JSON.stringify(videoInfo, null, 2), "utf8");
      } catch (e) {
        // 忽略
      }

      // 更新状态为 processed
      updateJobStatus(jobId, "processed", {
        title: result.title || "抖音视频",
        content_type: result.content_type,
        data_path: path.relative(path.dirname(getTikTokDownloadDir(date)), taskDir),
        content_files: {
          text: "content.txt",
          transcript: null,
          images: null,
          video: "video.mp4",
        },
      });

      updateTaskInPlatformIndex("tiktok", videoInfo.video_id, {
        title: result.title || "抖音视频",
        author: result.author,
        content_type: result.content_type,
        status: "processed",
        files: {
          metadata: "metadata.json",
          content: "content.txt",
          transcript: null,
          translated: null,
          summary: null,
          images_dir: null,
          video_file: "video.mp4",
        },
      }, date);

      addTimelineEvent({
        action: "processed",
        job_id: jobId,
        details: "视频下载完成",
      }, date);

      // 视频下载成功后进行转写
      try {
        const { transcribeVideo } = require("../../../src/shared/video_transcriber");
        result.transcript = await transcribeVideo(outputPath, {
          keepWav: false,
          outputDir: taskDir,
        });

        // 重命名转录文件为统一名称
        if (result.transcript) {
          const targetTranscriptPath = path.join(taskDir, "transcript.txt");
          const targetJsonPath = path.join(taskDir, "transcript.json");
          const targetSrtPath = path.join(taskDir, "transcript.srt");

          // 重命名 transcript.txt
          if (result.transcript.transcript_path && fs.existsSync(result.transcript.transcript_path) && result.transcript.transcript_path !== targetTranscriptPath) {
            fs.renameSync(result.transcript.transcript_path, targetTranscriptPath);
          }
          // 重命名 transcript.json
          if (result.transcript.transcript_json_path && fs.existsSync(result.transcript.transcript_json_path) && result.transcript.transcript_json_path !== targetJsonPath) {
            fs.renameSync(result.transcript.transcript_json_path, targetJsonPath);
          }
          // 重命名 transcript.srt
          if (result.transcript.transcript_srt_path && fs.existsSync(result.transcript.transcript_srt_path) && result.transcript.transcript_srt_path !== targetSrtPath) {
            fs.renameSync(result.transcript.transcript_srt_path, targetSrtPath);
          }
          // 更新 content_files
          updateJobStatus(jobId, "processed", {
            title: result.title || "抖音视频",
            content_type: result.content_type,
            content_files: {
              text: "content.txt",
              transcript: "transcript.txt",
              images: null,
              video: "video.mp4",
            },
          });
          updateTaskInPlatformIndex("tiktok", videoInfo.video_id, {
            title: result.title || "抖音视频",
            author: result.author,
            content_type: result.content_type,
            files: {
              metadata: "metadata.json",
              content: "content.txt",
              transcript: "transcript.txt",
              translated: null,
              summary: null,
              images_dir: null,
              video_file: "video.mp4",
            },
          }, date);
        }
      } catch (transcribeError) {
        console.error("Transcribe error:", transcribeError.message);
      }
    } catch (downloadError) {
      // 即使下载失败，我们也已经获取了视频信息，这已经很有用了
      result.download_error = downloadError instanceof Error ? downloadError.message : String(downloadError);
      result.file_path = outputPath;

      updateJobStatus(jobId, "processed", {
        notes: "下载失败，但元数据已获取",
      });
      updateTaskInPlatformIndex("tiktok", videoInfo.video_id, {
        status: "processed",
        error: result.download_error,
      }, date);
    }
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
      "Usage: node fetch_tiktok_video.js <input_text_or_url> " +
        "[--output-dir ./downloads] [--write-json path] [--pretty]\n\n" +
        "Example:\n" +
        "  node scripts/fetch_tiktok_video.js \"https://v.douyin.com/xxxxx/\" --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchTikTokVideo(args.input, {
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
  extractDouyinUrl,
  resolveShortUrl,
  extractRouterData,
  extractVideoInfo,
  fetchTikTokVideo,
  parseArgs,
};
