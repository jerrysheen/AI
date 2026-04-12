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

// 导入现有的 Bilibili 工具
const { extractBvid } = require("./fetch_bilibili_subtitle");
const { fetchBilibiliTranscriptAuto } = require("./fetch_bilibili_transcript_auto");

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

function extractBilibiliUrl(inputText) {
  if (!inputText) {
    throw new Error("Input text is empty");
  }

  const patterns = [
    /(https?:\/\/www\.bilibili\.com\/video\/[^\s<>"'{}|\\^`\[\]]+)/,
    /(https?:\/\/b23\.tv\/[^\s<>"'{}|\\^`\[\]]+)/,
  ];

  for (const pattern of patterns) {
    const match = String(inputText).match(pattern);
    if (match) {
      return match[1];
    }
  }

  const trimmed = String(inputText).trim();
  if (trimmed && !trimmed.includes(" ") && trimmed.startsWith("BV")) {
    return `https://www.bilibili.com/video/${trimmed}`;
  }

  throw new Error(`Unable to extract Bilibili URL from input: ${inputText.slice(0, 100)}`);
}

function buildVideoDownloadCommand(videoUrl, outputDir, options = {}) {
  const { executable, baseArgs } = parseCommand(options.ytDlpCommand || getYtDlpCommand());
  const bvid = extractBvid(videoUrl);
  const ffmpegLocation = options.ffmpegLocation || getFfmpegLocation();

  const args = [...baseArgs];
  // 使用更简单可靠的格式选择
  args.push("-f", "bv*+ba/b");
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
    bvid,
    executable,
    args,
    outputDir,
    ffmpegLocation,
  };
}

function updateJobProgress(jobId, status, progress, extraData = {}) {
  if (!jobId) {
    return;
  }

  updateJobStatus(jobId, status, {
    progress: progress || null,
    ...extraData,
  });
}

function downloadBilibiliVideo(videoUrl, outputDir, options = {}) {
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

  if (result.status !== 0) {
    throw new Error(combinedOutput || "yt-dlp video download failed.");
  }

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

  return {
    bvid: plan.bvid,
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
  };
}

function buildBilibiliContentFiles(result) {
  return {
    text: result.content_exists ? "content.txt" : null,
    transcript: result.transcript_path ? "transcript.txt" : null,
    images: null,
    video: result.video_exists ? "video.mp4" : null,
  };
}

function buildBilibiliIndexFiles(result) {
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

async function fetchBilibili(inputTextOrUrl, options = {}) {
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
    error: null,
    error_hint: null,
  };

  try {
    const sourceUrl = extractBilibiliUrl(inputTextOrUrl);
    result.source_url = sourceUrl;

    const bvid = extractBvid(sourceUrl);
    result.video_id = bvid;

    taskDir = getTaskItemDir("bilibili", bvid, bvid, date);
    ensureDir(taskDir);
    result.task_dir = taskDir;

    if (!job) {
      job = addJobToDailyJobs({
        source: "bilibili",
        source_url: sourceUrl,
        title: `Bilibili ${bvid}`,
        content_type: { has_video: true, has_images: false, has_text: true },
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

    addTaskToPlatformIndex("bilibili", {
      task_id: bvid,
      job_id: jobId,
      title: `Bilibili ${bvid}`,
      author: "",
      content_type: result.content_type,
      status: "downloading",
      dir_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
    }, date);

    const metadataPath = path.join(taskDir, "metadata.json");
    const contentPath = path.join(taskDir, "content.txt");
    const transcriptPath = path.join(taskDir, "transcript.txt");

    let downloadResult = null;
    let subtitleResult = null;

    updateJobProgress(jobId, "processing", {
      stage: "fetching_subtitle",
      percent: 15,
      message: "正在获取 Bilibili 字幕",
      updated_at: new Date().toISOString(),
    });

    // ========== 优先尝试 AI 字幕 ==========
    try {
      console.log(`[bilibili] 优先尝试获取 AI 字幕: ${bvid}`);
      subtitleResult = await fetchBilibiliTranscriptAuto(sourceUrl, {
        preferLang: "ai-zh",
        withSegments: true,
      });

      if (subtitleResult && !subtitleResult.error && subtitleResult.full_text) {
        console.log(`[bilibili] ✅ 获取到 AI 字幕，来源: ${subtitleResult.transcript_source}`);
        result.transcript_source = subtitleResult.transcript_source || "ai_subtitle";
        result.title = subtitleResult.title || `Bilibili ${bvid}`;
        result.author = subtitleResult.owner || "";
        result.content_type = {
          has_video: false,
          has_images: false,
          has_text: true,
        };

        try {
          fs.writeFileSync(transcriptPath, subtitleResult.full_text, "utf8");
          result.transcript_path = transcriptPath;

          if (subtitleResult.segments && Array.isArray(subtitleResult.segments)) {
            const jsonPath = path.join(taskDir, "transcript.json");
            fs.writeFileSync(jsonPath, JSON.stringify(subtitleResult.segments, null, 2), "utf8");
            result.transcript_json_path = jsonPath;
          }
        } catch (e) {
          console.error(`[bilibili] 保存字幕失败: ${e.message}`);
        }

        addTimelineEvent({
          action: "subtitle_fetched",
          job_id: jobId,
          details: "成功获取 AI 字幕",
        }, date);

        const metadata = {
          id: bvid,
          bvid,
          title: subtitleResult.title || null,
          description: subtitleResult.desc || "",
          duration: subtitleResult.duration || 0,
          uploader: subtitleResult.owner || null,
          subtitle_lang: subtitleResult.subtitle_lang || null,
          subtitle_lang_doc: subtitleResult.subtitle_lang_doc || null,
          requested_subtitle_lang: subtitleResult.requested_subtitle_lang || null,
          transcript_source: result.transcript_source,
          url: subtitleResult.url || sourceUrl,
        };

        try {
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
          result.metadata_path = metadataPath;
          result.metadata_exists = true;
        } catch (e) {
          console.error(`[bilibili] 保存 metadata 失败: ${e.message}`);
        }

        try {
          let textContent = "";
          if (metadata.title) {
            textContent += `${metadata.title}\n\n`;
          }
          if (metadata.description) {
            textContent += `${metadata.description}\n`;
          }
          if (textContent.trim()) {
            fs.writeFileSync(contentPath, textContent, "utf8");
            result.content_path = contentPath;
            result.content_exists = true;
          }
        } catch (e) {
          console.error(`[bilibili] 保存 content 失败: ${e.message}`);
        }

        updateJobProgress(jobId, "processed", {
          stage: "completed",
          percent: 100,
          message: "命中字幕，已完成",
          updated_at: new Date().toISOString(),
        }, {
          title: result.title,
          content_type: result.content_type,
          data_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
          content_files: buildBilibiliContentFiles(result),
        });

        updateTaskInPlatformIndex("bilibili", bvid, {
          title: result.title,
          author: result.author,
          content_type: result.content_type,
          status: "processed",
          files: buildBilibiliIndexFiles(result),
        }, date);

        addTimelineEvent({
          action: "processed",
          job_id: jobId,
          details: "Bilibili 处理完成 (命中字幕，跳过视频下载/ASR)",
        }, date);

        return result;
      }
    } catch (subtitleError) {
      console.log(`[bilibili] ⚠️ 获取 AI 字幕失败: ${subtitleError.message}`);
      subtitleResult = null;
    }

    updateJobProgress(jobId, "processing", {
      stage: "downloading_video",
      percent: 45,
      message: "未命中字幕，正在下载视频",
      updated_at: new Date().toISOString(),
    });

    // ========== 下载视频 (始终下载，无论是否有字幕) ==========
    try {
      console.log(`[bilibili] 开始下载视频: ${bvid}`);
      const videoOutputDir = taskDir;
      downloadResult = downloadBilibiliVideo(sourceUrl, videoOutputDir, options);

      result.video_id = downloadResult.bvid;
      result.title = downloadResult.title || `Bilibili ${bvid}`;
      result.author = downloadResult.author;
      result.content_type = {
        has_video: true,
        has_images: false,
        has_text: !!(downloadResult.title || downloadResult.description),
      };
      result.video_path = downloadResult.video_file;
      result.video_exists = !!downloadResult.video_file;
      result.video_size = downloadResult.file_size_bytes;

      if (downloadResult.metadata) {
        try {
          fs.writeFileSync(metadataPath, JSON.stringify(downloadResult.metadata, null, 2), "utf8");
          result.metadata_path = metadataPath;
          result.metadata_exists = true;
        } catch (e) {
          // ignore
        }
      }

      if (downloadResult.title || downloadResult.description) {
        try {
          let textContent = "";
          if (downloadResult.title) {
            textContent += `${downloadResult.title}\n\n`;
          }
          if (downloadResult.description) {
            textContent += `${downloadResult.description}\n`;
          }
          fs.writeFileSync(contentPath, textContent, "utf8");
          result.content_path = contentPath;
          result.content_exists = true;
        } catch (e) {
          // ignore
        }
      }

      addTimelineEvent({
        action: "video_downloaded",
        job_id: jobId,
        details: "视频下载完成",
      }, date);
    } catch (videoError) {
      console.log(`[bilibili] ⚠️ 视频下载失败: ${videoError.message}`);
      if (!subtitleResult || !subtitleResult.full_text) {
        throw videoError;
      }
      console.log(`[bilibili] 继续，因为已有字幕`);
    }

    // ========== 如果没有字幕，使用 ASR 转写 ==========
    if (!result.transcript_path && result.video_exists) {
      updateJobProgress(jobId, "processing", {
        stage: "transcribing",
        percent: 75,
        message: "视频已下载，正在等待转写完成",
        updated_at: new Date().toISOString(),
      });
      console.log(`[bilibili] 无字幕，使用 ASR 转写视频`);
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
        console.error("[bilibili] 转写失败:", transcribeError.message);
        // 清理 upload.wav 如果存在
        const uploadWavPath = path.join(taskDir, "upload.wav");
        if (fs.existsSync(uploadWavPath)) {
          fs.unlinkSync(uploadWavPath);
        }
      }
    }

    const contentFiles = buildBilibiliContentFiles(result);

    updateJobProgress(jobId, "processed", {
      stage: "completed",
      percent: 100,
      message: "Bilibili 处理完成",
      updated_at: new Date().toISOString(),
    }, {
      title: result.title,
      content_type: result.content_type,
      data_path: path.relative(path.join(taskDir, "..", ".."), taskDir),
      content_files: contentFiles,
    });

    updateTaskInPlatformIndex("bilibili", bvid, {
      title: result.title,
      author: result.author,
      content_type: result.content_type,
      status: "processed",
      files: buildBilibiliIndexFiles(result),
    }, date);

    addTimelineEvent({
      action: "processed",
      job_id: jobId,
      details: `Bilibili 处理完成 (字幕来源: ${result.transcript_source || "none"})`,
    }, date);

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.error_hint = error.stack || null;

    if (jobId) {
      updateJobProgress(jobId, "failed", {
        stage: "failed",
        percent: 100,
        message: `处理失败: ${result.error}`,
        updated_at: new Date().toISOString(),
      }, {
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
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node fetch_bilibili.js <input_text_or_url> " +
        "[--output-dir ./downloads] [--cookies-from-browser chrome] [--cookies-file cookies.txt] [--pretty]\n\n" +
        "Example:\n" +
        "  node scripts/fetch_bilibili.js \"BV1xx411c7mD\" --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchBilibili(args.input, {
      outputDir: args.outputDir,
      cookiesFromBrowser: args.cookiesFromBrowser,
      cookiesFile: args.cookiesFile,
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
  extractBilibiliUrl,
  extractBvid,
  downloadBilibiliVideo,
  fetchBilibili,
  parseArgs,
};
