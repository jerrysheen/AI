#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

// 找到 repo root 和 shared 目录
const SKILL_DIR = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.resolve(SKILL_DIR, "..");
const REPO_ROOT = path.resolve(SKILLS_ROOT, "..");

// 尝试从不同位置导入 runtime_config
let runtimeConfig;
const possiblePaths = [
  path.join(REPO_ROOT, "src", "shared", "runtime_config.js"),
  path.join(SKILLS_ROOT, "..", "src", "shared", "runtime_config.js"),
  path.join(__dirname, "..", "..", "..", "src", "shared", "runtime_config.js"),
];

for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    runtimeConfig = require(p);
    break;
  }
}

if (!runtimeConfig) {
  console.error("Error: Cannot find runtime_config.js");
  process.exit(1);
}

const {
  getYtDlpCommand,
  getFfmpegLocation,
  getDateStr,
  ensureDir,
  getTaskItemDir,
  sanitizeDirName,
  addJobToDailyJobs,
  updateJobStatus,
  addTimelineEvent,
  addTaskToPlatformIndex,
  updateTaskInPlatformIndex,
} = runtimeConfig;

// 导入现有的 YouTube 工具
const { fetchYouTubeSubtitle } = require("./fetch_youtube_subtitle");

function parseCommand(commandText) {
  const matches = String(commandText || "")
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    ?.map((token) => token.replace(/^"|"$/g, "")) || [];
  if (!matches.length) {
    throw new Error("AI_YTDLP_COMMAND is empty.");
  }
  return {
    executable: matches[0],
    baseArgs: matches.slice(1),
  };
}

function extractYoutubeVideoId(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = String(inputText).match(pattern);
    if (match) {
      return match[1];
    }
  }

  const trimmed = String(inputText).trim();
  if (trimmed && !trimmed.includes(" ") && trimmed.length === 11) {
    return trimmed;
  }

  throw new Error(`Unable to extract YouTube video ID from input: ${inputText.slice(0, 100)}`);
}

function extractYoutubeUrl(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const patterns = [
    /(https?:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}[^\s<>"'{}|\\^`\[\]]*)/,
    /(https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}[^\s<>"'{}|\\^`\[\]]*)/,
    /(https?:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]{11}[^\s<>"'{}|\\^`\[\]]*)/,
  ];

  for (const pattern of patterns) {
    const match = String(inputText).match(pattern);
    if (match) {
      return match[1];
    }
  }

  const trimmed = String(inputText).trim();
  if (trimmed && !trimmed.includes(" ") && trimmed.length === 11) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }

  throw new Error(`Unable to extract YouTube URL from input: ${inputText.slice(0, 100)}`);
}

function buildVideoDownloadCommand(videoUrl, outputDir, options = {}) {
  const { executable, baseArgs } = parseCommand(options.ytDlpCommand || getYtDlpCommand());
  const videoId = extractYoutubeVideoId(videoUrl);
  const ffmpegLocation = options.ffmpegLocation || getFfmpegLocation();
  const maxHeight = Number.isFinite(Number(options.maxHeight)) && Number(options.maxHeight) > 0
    ? Math.floor(Number(options.maxHeight))
    : 480;

  const args = [...baseArgs];

  // Keep yt-dlp close to its maintained defaults. Forcing tv/ios or web_creator
  // increases failures on some videos because those clients may require extra tokens.
  if (options.extractorArgs) {
    args.push("--extractor-args", options.extractorArgs);
  } else {
    args.push("--extractor-args", "youtube:player-client=default,-web_creator");
  }

  // We only need media good enough for later audio extraction. Prefer a small
  // muxed file to keep bandwidth and YouTube download friction lower.
  args.push(
    "-f",
    [
      `best[height<=${maxHeight}][vcodec!=none][acodec!=none][ext=mp4]`,
      `best[height<=${maxHeight}][vcodec!=none][acodec!=none]`,
      "18",
      "best",
    ].join("/")
  );
  args.push("--merge-output-format", "mp4");
  args.push("--no-playlist");
  args.push("-o", path.join(outputDir, "video.%(ext)s"));
  args.push("--write-description");
  args.push("--write-info-json");
  // 添加用户代理避免被拦截
  args.push("--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  // 忽略小错误，继续下载
  args.push("--no-abort-on-error");
  args.push("--ignore-errors");

  if (ffmpegLocation && String(ffmpegLocation).trim()) {
    args.push("--ffmpeg-location", ffmpegLocation);
  }

  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }

  if (options.cookiesFile) {
    args.push("--cookies", path.resolve(options.cookiesFile));
  }

  args.push(videoUrl);

  return {
    video_id: videoId,
    executable,
    args,
    outputDir,
    ffmpegLocation,
  };
}

function shouldAttemptVideoDownload({ metadata, subtitleResult, options = {} }) {
  if (options.forceVideoDownload) {
    return true;
  }

  if (options.cookiesFromBrowser || options.cookiesFile) {
    return true;
  }

  if (!metadata) {
    return true;
  }

  // Keep video download as an explicit fallback only when the caller provided a
  // stronger signal that download is intended.
  if (!subtitleResult?.full_text) {
    return true;
  }

  return false;
}

function shouldFinalizeAsEmptyResult({ metadata, subtitleResult, options = {} }) {
  if (options.forceVideoDownload || options.cookiesFromBrowser || options.cookiesFile) {
    return false;
  }

  if (subtitleResult?.full_text) {
    return false;
  }

  return Boolean(metadata);
}

function buildYoutubeContentFiles(result) {
  return {
    text: result.content_exists ? "content.txt" : null,
    transcript: result.transcript_path ? "transcript.txt" : null,
    images: null,
    video: result.video_exists ? "video.mp4" : null,
  };
}

function buildYoutubeIndexFiles(result) {
  return {
    metadata: result.metadata_exists ? "metadata.json" : null,
    content: result.content_exists ? "content.txt" : null,
    transcript: result.transcript_path ? "transcript.txt" : null,
    translated: null,
    summary: null,
    images_dir: null,
    video_file: result.video_exists ? "video.mp4" : null,
  };
}

function buildYoutubeJobNotes({ subtitleSkipped, subtitleResult }) {
  const reasons = [];

  if (subtitleSkipped) {
    reasons.push("metadata 显示该视频未暴露字幕轨道");
  } else if (subtitleResult?.error) {
    reasons.push(`字幕抓取失败: ${subtitleResult.error}`);
  } else {
    reasons.push("未抓到字幕");
  }

  reasons.push("当前流程不再对无字幕视频继续尝试下载或 ASR，按空结果收口");
  return reasons.join("；");
}

function metadataIndicatesNoSubtitles(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  const automaticCaptions = metadata.automatic_captions;
  const subtitles = metadata.subtitles;
  const hasAutomaticCaptions =
    automaticCaptions &&
    typeof automaticCaptions === "object" &&
    Object.keys(automaticCaptions).length > 0;
  const hasSubtitles =
    subtitles &&
    typeof subtitles === "object" &&
    Object.keys(subtitles).length > 0;

  return !hasAutomaticCaptions && !hasSubtitles;
}

function fetchYoutubeMetadata(videoUrl, outputDir, options = {}) {
  const { executable, baseArgs } = parseCommand(options.ytDlpCommand || getYtDlpCommand());
  const videoId = extractYoutubeVideoId(videoUrl);
  ensureDir(outputDir);

  const args = [...baseArgs];
  args.push("-J"); // 仅输出JSON metadata
  args.push("--no-playlist");
  args.push("--flat-playlist");

  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }
  if (options.cookiesFile) {
    args.push("--cookies", path.resolve(options.cookiesFile));
  }

  args.push(videoUrl);

  const result = cp.spawnSync(executable, args, {
    cwd: path.resolve(options.cwd || process.cwd()),
    encoding: "utf8",
    timeout: Number(options.timeoutMs) || 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 32,
  });

  const stdout = String(result.stdout || "");

  if (result.status !== 0) {
    return null;
  }

  try {
    const metadata = JSON.parse(stdout);
    const infoJsonPath = path.join(outputDir, "metadata.json");
    fs.writeFileSync(infoJsonPath, JSON.stringify(metadata, null, 2), "utf8");
    return metadata;
  } catch (e) {
    return null;
  }
}

function downloadYoutubeVideo(videoUrl, outputDir, options = {}) {
  const plan = buildVideoDownloadCommand(videoUrl, outputDir, options);
  ensureDir(plan.outputDir);

  const result = cp.spawnSync(plan.executable, plan.args, {
    cwd: path.resolve(options.cwd || process.cwd()),
    encoding: "utf8",
    timeout: Number(options.timeoutMs) || 1000 * 60 * 30,
    maxBuffer: 1024 * 1024 * 32,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combinedOutput = `${stdout}${stderr}`.trim();

  const videoPath = path.join(outputDir, "video.mp4");
  const infoJsonPath = path.join(outputDir, "video.info.json");

  let metadata = null;
  if (fs.existsSync(infoJsonPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(infoJsonPath, "utf8"));
    } catch (e) {
      // ignore
    }
  }

  const outputPath = fs.existsSync(videoPath) ? videoPath : null;
  const stat = outputPath ? fs.statSync(outputPath) : null;

  // 如果视频下载失败但有metadata，仍然返回成功（video_file为null）
  if (result.status !== 0 && !metadata) {
    throw new Error(combinedOutput || "yt-dlp video download failed.");
  }

  return {
    video_id: plan.video_id,
    video_url: videoUrl,
    video_file: outputPath,
    file_size_bytes: stat ? stat.size : null,
    metadata: metadata,
    title: metadata?.title || "",
    author: metadata?.uploader || "",
    description: metadata?.description || "",
    duration: metadata?.duration || 0,
    yt_dlp_command: getYtDlpCommand(),
    output_dir: plan.outputDir,
    log: combinedOutput,
    download_warning: result.status !== 0 ? combinedOutput : null,
  };
}

async function fetchYoutube(inputTextOrUrl, options = {}) {
  const date = options.date || new Date();
  let job = options.job || null;
  let taskDir = null;
  let jobId = null;

  const result = {
    source_url: null,
    video_id: null,
    title: null,
    author: null,
    content_type: { has_video: false, has_images: false, has_text: false },
    video_path: null,
    video_exists: false,
    video_size: null,
    transcript_source: null,
    transcript_path: null,
    transcript_json_path: null,
    transcript_srt_path: null,
    metadata_path: null,
    metadata_exists: false,
    content_path: null,
    content_exists: false,
    task_dir: null,
    job_id: null,
    empty_result: false,
    notes: "",
    error: null,
    error_hint: null,
  };

  let metadata = null;
  let subtitleResult = null;
  let downloadResult = null;

  try {
    const sourceUrl = extractYoutubeUrl(inputTextOrUrl);
    result.source_url = sourceUrl;

    const videoId = extractYoutubeVideoId(sourceUrl);
    result.video_id = videoId;

    taskDir = getTaskItemDir("youtube", videoId, videoId, date);
    ensureDir(taskDir);
    result.task_dir = taskDir;

    if (!job) {
      job = addJobToDailyJobs({
        source: "youtube",
        source_url: sourceUrl,
        title: `YouTube ${videoId}`,
        content_type: result.content_type,
        status: "pending",
      });
      jobId = job.job_id;
      result.job_id = jobId;

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

    addTaskToPlatformIndex("youtube", {
      task_id: videoId,
      job_id: jobId,
      title: `YouTube ${videoId}`,
      author: "",
      content_type: result.content_type,
      status: "downloading",
      dir_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
    }, date);

    const metadataPath = path.join(taskDir, "metadata.json");
    const contentPath = path.join(taskDir, "content.txt");
    const transcriptPath = path.join(taskDir, "transcript.txt");

    // ========== 步骤1: 优先获取 metadata（无需认证） ==========
    console.log(`[youtube] 步骤1: 获取视频 metadata: ${videoId}`);
    try {
      metadata = fetchYoutubeMetadata(sourceUrl, taskDir, options);
      if (metadata) {
        console.log(`[youtube] ✅ 获取到 metadata: ${metadata.title || "无标题"}`);
        result.metadata_path = metadataPath;
        result.metadata_exists = true;
        result.title = metadata.title || `YouTube ${videoId}`;
        result.author = metadata.uploader || "";
        result.content_type.has_text = !!(metadata.title || metadata.description);

        // 保存标题和描述到 content.txt
        if (metadata.title || metadata.description) {
          try {
            let textContent = "";
            if (metadata.title) {
              textContent += `${metadata.title}\n\n`;
            }
            if (metadata.description) {
              textContent += `${metadata.description}\n`;
            }
            fs.writeFileSync(contentPath, textContent, "utf8");
            result.content_path = contentPath;
            result.content_exists = true;
          } catch (e) {
            // ignore
          }
        }

        addTimelineEvent({
          action: "metadata_fetched",
          job_id: jobId,
          details: "成功获取metadata",
        }, date);
      }
    } catch (metaError) {
      console.log(`[youtube] ⚠️ 获取metadata失败: ${metaError.message}`);
    }

    // ========== 步骤2: 尝试获取 AI 字幕（无需认证） ==========
    let subtitleSkipped = false;
    if (metadataIndicatesNoSubtitles(metadata)) {
      console.log(`[youtube] 步骤2: metadata 显示无字幕，跳过字幕抓取`);
      subtitleSkipped = true;
    } else {
      try {
        console.log(`[youtube] 步骤2: 尝试获取 AI 字幕: ${videoId}`);
        subtitleResult = await fetchYouTubeSubtitle(sourceUrl, {
          preferLang: "",
        });

        if (subtitleResult && !subtitleResult.error && subtitleResult.full_text) {
          console.log(`[youtube] ✅ 获取到字幕，来源: ${subtitleResult.transcript_source}`);
          result.transcript_source = subtitleResult.transcript_source || "ai_subtitle";

          try {
            fs.writeFileSync(transcriptPath, subtitleResult.full_text, "utf8");
            result.transcript_path = transcriptPath;

            if (subtitleResult.segments && Array.isArray(subtitleResult.segments)) {
              const jsonPath = path.join(taskDir, "transcript.json");
              fs.writeFileSync(jsonPath, JSON.stringify(subtitleResult.segments, null, 2), "utf8");
              result.transcript_json_path = jsonPath;
            }
          } catch (e) {
            console.error(`[youtube] 保存字幕失败: ${e.message}`);
          }

          addTimelineEvent({
            action: "subtitle_fetched",
            job_id: jobId,
            details: "成功获取字幕",
          }, date);
        }
      } catch (subtitleError) {
        console.log(`[youtube] ⚠️ 获取字幕失败: ${subtitleError.message}`);
        subtitleResult = {
          full_text: "",
          error: subtitleError instanceof Error ? subtitleError.message : String(subtitleError),
        };
      }
    }

    result.content_type.has_text = Boolean(
      result.content_exists || result.transcript_path || metadata?.title || metadata?.description
    );

    if (shouldFinalizeAsEmptyResult({ metadata, subtitleResult, options })) {
      result.empty_result = true;
      result.notes = buildYoutubeJobNotes({ subtitleSkipped, subtitleResult });

      updateJobStatus(jobId, "processed", {
        title: result.title || `YouTube ${videoId}`,
        content_type: result.content_type,
        data_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
        content_files: buildYoutubeContentFiles(result),
        notes: result.notes,
      });

      updateTaskInPlatformIndex("youtube", videoId, {
        title: result.title || `YouTube ${videoId}`,
        author: result.author,
        content_type: result.content_type,
        status: "processed",
        files: buildYoutubeIndexFiles(result),
        error: null,
      }, date);

      addTimelineEvent({
        action: "processed",
        job_id: jobId,
        details: "未抓到字幕，按空结果收口（未继续下载视频/ASR）",
      }, date);

      return result;
    }

    // ========== 步骤3: 尝试下载视频（可选，有cookies时成功率更高）==========
    const shouldDownloadVideo = shouldAttemptVideoDownload({ metadata, subtitleResult, options });
    if (shouldDownloadVideo) {
      try {
        console.log(
          `[youtube] 步骤3: 尝试下载视频: ${videoId} (cookies: ${options.cookiesFromBrowser || options.cookiesFile ? "是" : "否"})`
        );
        const videoOutputDir = taskDir;
        downloadResult = downloadYoutubeVideo(sourceUrl, videoOutputDir, options);

        if (downloadResult.video_file) {
          result.video_path = downloadResult.video_file;
          result.video_exists = true;
          result.video_size = downloadResult.file_size_bytes;
          result.content_type.has_video = true;
          console.log(`[youtube] ✅ 视频下载成功`);

          addTimelineEvent({
            action: "video_downloaded",
            job_id: jobId,
            details: "视频下载完成",
          }, date);
        } else if (downloadResult.metadata && !metadata) {
          // 如果视频没下载成功但获取到了metadata
          metadata = downloadResult.metadata;
          if (!result.metadata_exists && metadata) {
            result.title = metadata.title || `YouTube ${videoId}`;
            result.author = metadata.uploader || "";
            result.content_type.has_text = !!(metadata.title || metadata.description);
            try {
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
              result.metadata_path = metadataPath;
              result.metadata_exists = true;
            } catch (e) {}
          }
        }
      } catch (videoError) {
        console.log(`[youtube] ⚠️ 视频下载失败: ${videoError.message}`);
        // 视频下载失败不阻止任务完成（如果有metadata或字幕）
      }
    } else {
      console.log(`[youtube] 步骤3: 跳过视频下载`);
    }

    // ========== 步骤4: 如果有视频但无字幕，使用 ASR 转写 ==========
    if (!result.transcript_path && result.video_exists) {
      console.log(`[youtube] 步骤4: 无字幕，使用 ASR 转写视频`);
      try {
        const { transcribeVideo } = require("../../../src/shared/video_transcriber");
        const transcriptResult = await transcribeVideo(result.video_path, {
          keepWav: false,
          outputDir: taskDir,
        });

        if (transcriptResult) {
          result.transcript_source = "asr";
          const targetTranscriptPath = path.join(taskDir, "transcript.txt");
          const targetJsonPath = path.join(taskDir, "transcript.json");
          const targetSrtPath = path.join(taskDir, "transcript.srt");

          if (transcriptResult.transcript_path && fs.existsSync(transcriptResult.transcript_path)) {
            if (transcriptResult.transcript_path !== targetTranscriptPath) {
              fs.renameSync(transcriptResult.transcript_path, targetTranscriptPath);
            }
            transcriptResult.transcript_path = targetTranscriptPath;
          }
          if (transcriptResult.transcript_json_path && fs.existsSync(transcriptResult.transcript_json_path)) {
            if (transcriptResult.transcript_json_path !== targetJsonPath) {
              fs.renameSync(transcriptResult.transcript_json_path, targetJsonPath);
            }
            transcriptResult.transcript_json_path = targetJsonPath;
          }
          if (transcriptResult.transcript_srt_path && fs.existsSync(transcriptResult.transcript_srt_path)) {
            if (transcriptResult.transcript_srt_path !== targetSrtPath) {
              fs.renameSync(transcriptResult.transcript_srt_path, targetSrtPath);
            }
            transcriptResult.transcript_srt_path = targetSrtPath;
          }

          result.transcript_path = targetTranscriptPath;
          result.transcript_json_path = targetJsonPath;
          result.transcript_srt_path = targetSrtPath;

          addTimelineEvent({
            action: "asr_completed",
            job_id: jobId,
            details: "ASR 转写完成",
          }, date);
        }
      } catch (transcribeError) {
        console.error("[youtube] 转写失败:", transcribeError.message);
        // 清理 upload.wav 如果存在
        const uploadWavPath = path.join(taskDir, "upload.wav");
        if (fs.existsSync(uploadWavPath)) {
          fs.unlinkSync(uploadWavPath);
        }
      }
    }

    // ========== 验证：至少要有metadata或字幕才算成功 ==========
    if (!metadata && !subtitleResult?.full_text) {
      throw new Error("无法获取视频metadata或字幕，请检查URL是否正确");
    }

    result.content_type.has_text = Boolean(
      result.content_exists || result.transcript_path || metadata?.title || metadata?.description
    );

    const contentFiles = buildYoutubeContentFiles(result);

    updateJobStatus(jobId, "processed", {
      title: result.title,
      content_type: result.content_type,
      data_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
      content_files: contentFiles,
      notes: result.notes || "",
    });

    updateTaskInPlatformIndex("youtube", videoId, {
      title: result.title,
      author: result.author,
      content_type: result.content_type,
      status: "processed",
      files: buildYoutubeIndexFiles(result),
      error: null,
    }, date);

    addTimelineEvent({
      action: "processed",
      job_id: jobId,
      details: `YouTube 处理完成 (字幕来源: ${result.transcript_source || "none"}, 视频: ${result.video_exists ? "有" : "无"})`,
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
    cookiesFromBrowser: null,
    cookiesFile: null,
    maxHeight: 480,
    pretty: false,
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
    } else if (token === "--cookies-from-browser") {
      args.cookiesFromBrowser = nextValue;
    } else if (token === "--cookies-file") {
      args.cookiesFile = nextValue;
    } else if (token === "--max-height") {
      const parsed = Number(nextValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-height value: ${nextValue}`);
      }
      args.maxHeight = Math.floor(parsed);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node fetch_youtube.js <input_text_or_url> " +
        "[--output-dir ./downloads] [--cookies-from-browser chrome] [--cookies-file cookies.txt] [--pretty]\n\n" +
        "  [--max-height 480]\n\n" +
        "Example:\n" +
        "  node scripts/fetch_youtube.js \"dQw4w9WgXcQ\" --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchYoutube(args.input, {
      outputDir: args.outputDir,
      cookiesFromBrowser: args.cookiesFromBrowser,
      cookiesFile: args.cookiesFile,
      maxHeight: args.maxHeight,
    });
    const output = JSON.stringify(data, null, args.pretty ? 2 : 0);
    process.stdout.write(`${output}\n`);

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
  extractYoutubeUrl,
  extractYoutubeVideoId,
  fetchYoutubeMetadata,
  downloadYoutubeVideo,
  metadataIndicatesNoSubtitles,
  shouldAttemptVideoDownload,
  shouldFinalizeAsEmptyResult,
  buildYoutubeContentFiles,
  buildYoutubeIndexFiles,
  buildYoutubeJobNotes,
  fetchYoutube,
  parseArgs,
};
