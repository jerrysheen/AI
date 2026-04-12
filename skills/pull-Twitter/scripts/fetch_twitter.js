#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");

const {
  getTwitterDownloadDir,
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

// 导入现有的 Twitter 抓取模块
const { fetchTwitterEnhanced } = require("./fetch_twitter_enhanced");
const { downloadTwitterVideo, fetchTweetVideoMetadata } = require("./download_twitter_video");

// 从输入文本中提取 Twitter 信息
function parseTwitterInput(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const trimmed = String(inputText).trim();

  // 模式1: 完整的推文 URL
  const urlMatch = trimmed.match(/(?:twitter|x)\.com\/([^\/]+)\/status\/(\d+)/i);
  if (urlMatch) {
    return {
      type: "tweet",
      handle: urlMatch[1],
      tweet_id: urlMatch[2],
      original: trimmed,
      url: `https://x.com/${urlMatch[1]}/status/${urlMatch[2]}`,
    };
  }

  // 模式2: 纯数字的 tweet ID（6-25 位数字）
  if (/^\d{6,25}$/.test(trimmed)) {
    return {
      type: "tweet",
      handle: null,
      tweet_id: trimmed,
      original: trimmed,
      url: null, // 稍后从 metadata 获取
    };
  }

  // 模式3: 用户名
  const handleMatch = trimmed.match(/^@?(\w{1,15})$/);
  if (handleMatch) {
    return {
      type: "user",
      handle: handleMatch[1],
      tweet_id: null,
      original: trimmed,
      url: null,
    };
  }

  throw new Error(`Unable to parse Twitter input: ${trimmed.slice(0, 100)}`);
}

// 下载媒体文件（支持重定向）
async function downloadMediaFile(mediaUrl, outputPath, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error("Too many redirects");
  }

  // 如果文件已存在，直接返回文件大小
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    return stats.size;
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(mediaUrl);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://twitter.com/",
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
async function fetchTwitter(inputTextOrUrl, options = {}) {
  const date = options.date || new Date();
  let job = options.job || null;
  let taskDir = null;
  let imagesDir = null;
  let jobId = null;

  const result = {
    source_url: null,
    resolved_url: null,
    tweet_id: null,
    title: null,
    content: null,
    author: null,
    author_handle: null,
    author_id: null,
    type: null,
    created_at: null,
    tags: [],
    likes: 0,
    retweets: 0,
    replies: 0,
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
    // 解析输入
    const parsed = parseTwitterInput(inputTextOrUrl);
    result.source_url = parsed.url || parsed.original;

    let tweetInfo = null;
    let videoMetadata = null;
    let hasVideo = false;

    // 首先尝试获取视频元数据（如果是推文）
    if (parsed.type === "tweet") {
      try {
        videoMetadata = await fetchTweetVideoMetadata(parsed.tweet_id);
        hasVideo = true;
        result.content_type.has_video = true;
        tweetInfo = {
          tweet_id: videoMetadata.tweet_id,
          text: videoMetadata.text,
          author_name: videoMetadata.author_name,
          author_handle: videoMetadata.author_handle,
          created_at: videoMetadata.created_at,
        };
        // 构造完整 URL
        if (videoMetadata.screen_name) {
          tweetInfo.tweet_url = `https://x.com/${videoMetadata.screen_name}/status/${videoMetadata.tweet_id}`;
        }
      } catch (e) {
        // 没有视频，继续尝试获取普通推文
        hasVideo = false;
      }
    }

    // 尝试使用增强版获取推文信息（无论是否有视频）
    if (!tweetInfo && parsed.type === "tweet") {
      try {
        // 尝试构造 URL 来获取
        let fetchInput = inputTextOrUrl;
        if (parsed.url) {
          fetchInput = parsed.url;
        } else if (parsed.handle) {
          fetchInput = `https://x.com/${parsed.handle}/status/${parsed.tweet_id}`;
        }

        const enhancedResult = await fetchTwitterEnhanced(fetchInput, { limit: 5 });
        result._enhanced_result = enhancedResult;

        if (enhancedResult.input_type === "tweet" && enhancedResult.found) {
          tweetInfo = enhancedResult.tweet;
        } else if (enhancedResult.latest_tweets && enhancedResult.latest_tweets.length > 0) {
          // 找不到特定推文时，使用该用户的最新推文作为 fallback
          console.warn(`[twitter] 特定推文 ${parsed.tweet_id} 未找到，使用用户最新推文`);
          tweetInfo = enhancedResult.latest_tweets[0];
          // 注意：tweetInfo 已经有 tweet_id，不需要强制使用原始的
        } else if (enhancedResult.input_type === "user" && enhancedResult.tweets && enhancedResult.tweets.length > 0) {
          tweetInfo = enhancedResult.tweets[0];
        }
      } catch (e) {
        console.warn("fetchTwitterEnhanced failed:", e.message);
      }
    }

    if (!tweetInfo && !videoMetadata) {
      throw new Error("Failed to fetch tweet information");
    }

    // 填充结果
    if (tweetInfo) {
      result.tweet_id = tweetInfo.tweet_id || videoMetadata?.tweet_id;
      result.title = tweetInfo.title || "";
      result.content = tweetInfo.text || videoMetadata?.text || "";
      result.author_handle = tweetInfo.author_handle || videoMetadata?.author_handle || "";
      result.author = tweetInfo.author_name || videoMetadata?.author_name || result.author_handle;
      result.created_at = tweetInfo.published_at || tweetInfo.created_at || videoMetadata?.created_at;
      result.source_url = tweetInfo.tweet_url || result.source_url;
      result.resolved_url = tweetInfo.tweet_url || result.source_url;

      // 检测内容类型
      result.content_type.has_text = !!(result.title || result.content);
      result.content_type.has_video = hasVideo || !!(tweetInfo.has_video);

      // Twitter 图片处理（暂不实现，专注于文本和视频）
      result.image_urls = [];
      result.content_type.has_images = result.image_urls.length > 0;
    } else if (videoMetadata) {
      // 只用 video metadata
      result.tweet_id = videoMetadata.tweet_id;
      result.content = videoMetadata.text || "";
      result.author = videoMetadata.author_name;
      result.author_handle = videoMetadata.author_handle;
      result.created_at = videoMetadata.created_at;
      result.content_type.has_text = !!result.content;
      result.content_type.has_video = true;
      // 构造推文 URL
      if (videoMetadata.screen_name) {
        result.source_url = `https://x.com/${videoMetadata.screen_name}/status/${result.tweet_id}`;
        result.resolved_url = result.source_url;
      }
    }

    if (!result.tweet_id) {
      throw new Error("No tweet ID found");
    }

    // 从 video metadata 添加视频 URL
    if (videoMetadata) {
      result.video_urls = [videoMetadata.selected_variant?.url].filter(Boolean);
    }

    // 获取或创建任务目录
    const taskTitle = result.title || result.content?.slice(0, 50) || "tweet";
    taskDir = getTaskItemDir("twitter", taskTitle, result.tweet_id, date);
    imagesDir = getTaskImagesDir("twitter", taskTitle, result.tweet_id, date);
    ensureDir(taskDir);
    ensureDir(imagesDir);
    result.task_dir = taskDir;

    // 添加到 daily_jobs.json（如果没有传入 job）
    if (!job) {
      job = addJobToDailyJobs({
        source: "twitter",
        source_url: result.source_url || result.resolved_url,
        title: taskTitle,
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
    addTaskToPlatformIndex("twitter", {
      task_id: result.tweet_id,
      job_id: jobId,
      title: taskTitle,
      author: result.author || result.author_handle,
      content_type: result.content_type,
      status: "downloading",
      dir_path: path.relative(path.join(getTwitterDownloadDir(date), ".."), taskDir),
    }, date);

    const metadataPath = path.join(taskDir, "metadata.json");
    const contentPath = path.join(taskDir, "content.txt");

    // 保存文字描述到文件
    try {
      let textContent = "";
      if (result.title) {
        textContent += `${result.title}\n\n`;
      }
      if (result.content) {
        textContent += `${result.content}\n`;
      }
      fs.writeFileSync(contentPath, textContent, "utf8");
      result.text_path = contentPath;
      result.text_exists = true;
    } catch (e) {
      result.text_path = contentPath;
      result.text_exists = false;
    }

    // 下载视频并转写
    result.video_transcripts = [];
    let transcriptResult = null;
    if (result.content_type.has_video && result.video_urls.length > 0) {
      const outputPath = path.join(taskDir, "video.mp4");
      try {
        // 使用现有的 downloadTwitterVideo 函数
        const downloadResult = await downloadTwitterVideo(result.tweet_id, {
          output: outputPath,
        });
        result.video_paths.push(outputPath);
        result.video_sizes.push(downloadResult.file_size_bytes || 0);
        result.video_exists.push(true);

        addTimelineEvent({
          action: "video_downloaded",
          job_id: jobId,
          details: "视频下载完成",
        }, date);

        // 视频下载成功后进行转写
        try {
          console.log(`[twitter] 开始转写视频: ${result.tweet_id}`);
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
            if (transcriptResult.transcript_path && fs.existsSync(transcriptResult.transcript_path)) {
              if (transcriptResult.transcript_path !== targetTranscriptPath) {
                fs.renameSync(transcriptResult.transcript_path, targetTranscriptPath);
              }
              transcriptResult.transcript_path = targetTranscriptPath;
            }
            // 重命名 transcript.json
            if (transcriptResult.transcript_json_path && fs.existsSync(transcriptResult.transcript_json_path)) {
              if (transcriptResult.transcript_json_path !== targetJsonPath) {
                fs.renameSync(transcriptResult.transcript_json_path, targetJsonPath);
              }
              transcriptResult.transcript_json_path = targetJsonPath;
            }
            // 重命名 transcript.srt
            if (transcriptResult.transcript_srt_path && fs.existsSync(transcriptResult.transcript_srt_path)) {
              if (transcriptResult.transcript_srt_path !== targetSrtPath) {
                fs.renameSync(transcriptResult.transcript_srt_path, targetSrtPath);
              }
              transcriptResult.transcript_srt_path = targetSrtPath;
            }

            addTimelineEvent({
              action: "asr_completed",
              job_id: jobId,
              details: "ASR 转写完成",
            }, date);
          }
        } catch (transcribeError) {
          console.error("[twitter] 转写失败:", transcribeError.message);
          addTimelineEvent({
            action: "error",
            job_id: jobId,
            details: `转写失败: ${transcribeError.message}`,
          }, date);
          // 清理 upload.wav 如果存在
          const uploadWavPath = path.join(taskDir, "upload.wav");
          if (fs.existsSync(uploadWavPath)) {
            fs.unlinkSync(uploadWavPath);
          }
        }
      } catch (e) {
        result.video_paths.push(outputPath);
        result.video_sizes.push(0);
        result.video_exists.push(false);
        console.error("[twitter] 视频下载失败:", e.message);
      }
      result.video_transcripts.push(transcriptResult);
    }

    // 保存完整元数据到 JSON 文件
    try {
      const metadata = {
        tweet_id: result.tweet_id,
        title: result.title,
        content: result.content,
        author: result.author,
        author_handle: result.author_handle,
        created_at: result.created_at,
        content_type: result.content_type,
        video_metadata: videoMetadata,
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
      result.metadata_path = metadataPath;
      result.metadata_exists = true;
    } catch (e) {
      result.metadata_path = metadataPath;
      result.metadata_exists = false;
    }

    // 构建 content_files 对象
    const hasTranscript = transcriptResult && transcriptResult.transcript_path && fs.existsSync(transcriptResult.transcript_path);
    const contentFiles = {
      text: "content.txt",
      transcript: hasTranscript ? "transcript.txt" : null,
      images: result.content_type.has_images ? "images/" : null,
      video: result.content_type.has_video && result.video_exists[0] ? "video.mp4" : null,
    };

    // 更新状态为 processed
    updateJobStatus(jobId, "processed", {
      title: result.title || result.content?.slice(0, 50),
      content_type: result.content_type,
      data_path: path.relative(path.dirname(getTwitterDownloadDir(date)), taskDir),
      content_files: contentFiles,
    });

    updateTaskInPlatformIndex("twitter", result.tweet_id, {
      title: result.title || result.content?.slice(0, 50),
      author: result.author || result.author_handle,
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
      details: "推文内容下载完成",
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
      "Usage: node fetch_twitter.js <input_text_or_url> " +
        "[--output-dir ./downloads] [--write-json path] [--pretty]\n\n" +
        "Example:\n" +
        "  node scripts/fetch_twitter.js \"https://x.com/user/status/12345\" --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchTwitter(args.input, {
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
  parseTwitterInput,
  fetchTwitter,
  parseArgs,
};
