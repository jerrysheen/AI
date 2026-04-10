#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { REPO_ROOT, getSharedDataDir } = require("./runtime_shim");
const { fetchTikTokVideo } = require("./fetch_tiktok_video");

const execFileAsync = promisify(execFile);

// 直接获取 ffmpeg 命令，不依赖 runtime_shim 的导出
function getFfmpegCommand() {
  return process.env.AI_FFMPEG_COMMAND || "ffmpeg";
}

/**
 * 检查 ffmpeg 是否可用
 */
async function checkFFmpeg() {
  const ffmpegCmd = getFfmpegCommand();
  try {
    await execFileAsync(ffmpegCmd, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从视频文件提取音频为 WAV 格式
 */
async function extractWAV(videoPath, options = {}) {
  const ffmpegAvailable = await checkFFmpeg();
  if (!ffmpegAvailable) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg first:\n" +
      "  macOS: brew install ffmpeg\n" +
      "  Ubuntu: sudo apt install ffmpeg\n" +
      "  Windows: choco install ffmpeg\n" +
      "\nOr configure AI_FFMPEG_COMMAND in .env"
    );
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const outputPath = options.outputPath || videoPath.replace(/\.(mp4|mov|avi|mkv)$/i, ".wav");
  const sampleRate = options.sampleRate || 44100;
  const channels = options.channels || 2;
  const bitDepth = options.bitDepth || 16;

  const ffmpegCmd = getFfmpegCommand();
  const args = [
    "-i", videoPath,
    "-vn",
    "-acodec", `pcm_s${bitDepth}le`,
    "-ar", String(sampleRate),
    "-ac", String(channels),
    "-y",
    outputPath
  ];

  const result = {
    video_path: videoPath,
    audio_path: outputPath,
    audio_exists: false,
    audio_size: null,
    sample_rate: sampleRate,
    channels: channels,
    bit_depth: bitDepth,
    error: null,
  };

  try {
    await execFileAsync(ffmpegCmd, args);

    if (fs.existsSync(outputPath)) {
      result.audio_exists = true;
      const stats = fs.statSync(outputPath);
      result.audio_size = stats.size;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    if (error.stdout) result.error += `\nSTDOUT: ${error.stdout}`;
    if (error.stderr) result.error += `\nSTDERR: ${error.stderr}`;
  }

  return result;
}

/**
 * 下载抖音视频并提取音频（一步完成）
 * @param {string} inputTextOrUrl - 抖音分享链接或文本
 * @param {object} options - 选项
 * @param {string} [options.videoDir] - 视频保存目录
 * @param {string} [options.audioDir] - 音频保存目录
 * @param {boolean} [options.keepVideo=false] - 是否保留视频文件
 * @param {string} [options.audioFormat='wav'] - 音频格式 (wav/mp3)
 * @param {number} [options.sampleRate=44100] - WAV 采样率
 * @param {number} [options.channels=2] - WAV 声道数
 * @param {number} [options.bitDepth=16] - WAV 位深
 * @param {string} [options.bitrate='192k'] - MP3 比特率
 */
async function fetchTikTokAudio(inputTextOrUrl, options = {}) {
  const videoDir = options.videoDir || path.join(getSharedDataDir(), "video", "tiktok");
  const audioDir = options.audioDir || path.join(getSharedDataDir(), "audio", "tiktok");
  const keepVideo = options.keepVideo !== false;

  // 确保目录存在
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  const result = {
    source_url: null,
    video_id: null,
    title: null,
    author: null,
    video_path: null,
    video_exists: false,
    video_size: null,
    audio_path: null,
    audio_exists: false,
    audio_size: null,
    audio_format: options.audioFormat || "wav",
    error: null,
    video_error: null,
    audio_error: null,
  };

  try {
    // 第一步：下载视频
    const videoResult = await fetchTikTokVideo(inputTextOrUrl, {
      outputDir: videoDir,
    });

    result.source_url = videoResult.source_url;
    result.video_id = videoResult.video_id;
    result.title = videoResult.title;
    result.author = videoResult.author;
    result.video_path = videoResult.file_path;
    result.video_exists = videoResult.file_exists;
    result.video_size = videoResult.file_size;
    result.video_error = videoResult.download_error || videoResult.error;

    if (!videoResult.file_exists || result.video_error) {
      result.error = result.video_error || "Video download failed";
      return result;
    }

    // 第二步：提取音频
    const audioOutputPath = path.join(audioDir, `${videoResult.video_id}.${result.audio_format}`);

    let audioResult;
    if (result.audio_format === "mp3") {
      // MP3 提取（TODO: 实现 MP3 支持）
      audioResult = await extractWAV(videoResult.file_path, {
        outputPath: audioOutputPath.replace(".mp3", ".wav"),
        sampleRate: options.sampleRate,
        channels: options.channels,
        bitDepth: options.bitDepth,
      });
      // 简单起见，先用 WAV
      result.audio_format = "wav";
    } else {
      audioResult = await extractWAV(videoResult.file_path, {
        outputPath: audioOutputPath,
        sampleRate: options.sampleRate,
        channels: options.channels,
        bitDepth: options.bitDepth,
      });
    }

    result.audio_path = audioResult.audio_path;
    result.audio_exists = audioResult.audio_exists;
    result.audio_size = audioResult.audio_size;
    result.audio_error = audioResult.error;

    if (audioResult.error) {
      result.error = audioResult.error;
    }

    // 如果不保留视频，删除视频文件
    if (!keepVideo && videoResult.file_path) {
      try {
        fs.unlinkSync(videoResult.file_path);
        result.video_exists = false;
        result.video_path = null;
      } catch {
        // 忽略删除错误
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function parseArgs(argv) {
  const args = {
    input: null,
    videoDir: null,
    audioDir: null,
    keepVideo: true,
    audioFormat: "wav",
    sampleRate: null,
    channels: null,
    bitrate: null,
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

    if (token === "--wav") {
      args.audioFormat = "wav";
      continue;
    }

    if (token === "--mp3") {
      args.audioFormat = "mp3";
      continue;
    }

    if (token === "--no-keep-video") {
      args.keepVideo = false;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--video-dir") {
      args.videoDir = nextValue;
    } else if (token === "--audio-dir") {
      args.audioDir = nextValue;
    } else if (token === "--sample-rate") {
      args.sampleRate = parseInt(nextValue, 10);
    } else if (token === "--channels") {
      args.channels = parseInt(nextValue, 10);
    } else if (token === "--bitrate") {
      args.bitrate = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node fetch_tiktok_audio.js <input_text_or_url> [--wav|--mp3] [--video-dir path] [--audio-dir path] [--no-keep-video] [--pretty]\n\n" +
      "Examples:\n" +
      "  node scripts/fetch_tiktok_audio.js \"https://v.douyin.com/xxxxx/\" --wav --pretty\n" +
      "  node scripts/fetch_tiktok_audio.js \"分享文本...\" --mp3 --no-keep-video --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchTikTokAudio(args.input, {
      videoDir: args.videoDir,
      audioDir: args.audioDir,
      keepVideo: args.keepVideo,
      audioFormat: args.audioFormat,
      sampleRate: args.sampleRate,
      channels: args.channels,
      bitrate: args.bitrate,
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
  checkFFmpeg,
  extractWAV,
  fetchTikTokAudio,
  parseArgs,
};
