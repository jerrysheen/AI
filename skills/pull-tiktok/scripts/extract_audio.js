#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { REPO_ROOT } = require("./runtime_shim");

const execFileAsync = promisify(execFile);

/**
 * 检查 ffmpeg 是否可用
 */
async function checkFFmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从视频文件提取音频为 WAV 格式
 * @param {string} videoPath - 视频文件路径
 * @param {object} options - 选项
 * @param {string} [options.outputPath] - 输出音频路径（可选）
 * @param {number} [options.sampleRate=44100] - 采样率
 * @param {number} [options.channels=2] - 声道数（1=单声道, 2=立体声）
 * @param {number} [options.bitDepth=16] - 位深
 */
async function extractWAV(videoPath, options = {}) {
  const ffmpegAvailable = await checkFFmpeg();
  if (!ffmpegAvailable) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg first:\n" +
      "  macOS: brew install ffmpeg\n" +
      "  Ubuntu: sudo apt install ffmpeg\n" +
      "  Windows: choco install ffmpeg"
    );
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const outputPath = options.outputPath || videoPath.replace(/\.(mp4|mov|avi|mkv)$/i, ".wav");
  const sampleRate = options.sampleRate || 44100;
  const channels = options.channels || 2;
  const bitDepth = options.bitDepth || 16;

  // ffmpeg 参数：提取音频，转换为 PCM WAV
  const args = [
    "-i", videoPath,
    "-vn", // 禁用视频
    "-acodec", `pcm_s${bitDepth}le`, // PCM 编码
    "-ar", String(sampleRate), // 采样率
    "-ac", String(channels), // 声道数
    "-y", // 覆盖输出文件
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
    await execFileAsync("ffmpeg", args);

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
 * 从视频文件提取音频为 MP3 格式（更小体积）
 */
async function extractMP3(videoPath, options = {}) {
  const ffmpegAvailable = await checkFFmpeg();
  if (!ffmpegAvailable) {
    throw new Error("ffmpeg not found. Please install ffmpeg first.");
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const outputPath = options.outputPath || videoPath.replace(/\.(mp4|mov|avi|mkv)$/i, ".mp3");
  const bitrate = options.bitrate || "192k";

  const args = [
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-b:a", bitrate,
    "-y",
    outputPath
  ];

  const result = {
    video_path: videoPath,
    audio_path: outputPath,
    audio_exists: false,
    audio_size: null,
    bitrate: bitrate,
    error: null,
  };

  try {
    await execFileAsync("ffmpeg", args);

    if (fs.existsSync(outputPath)) {
      result.audio_exists = true;
      const stats = fs.statSync(outputPath);
      result.audio_size = stats.size;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function parseArgs(argv) {
  const args = {
    videoPath: null,
    format: "wav",
    outputPath: null,
    pretty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.videoPath) {
        args.videoPath = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    if (token === "--wav") {
      args.format = "wav";
      continue;
    }

    if (token === "--mp3") {
      args.format = "mp3";
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--output") {
      args.outputPath = nextValue;
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

  if (!args.videoPath) {
    throw new Error(
      "Usage: node extract_audio.js <video_path> [--wav|--mp3] [--output path] [--pretty]\n\n" +
      "Examples:\n" +
      "  node scripts/extract_audio.js downloads/video.mp4 --wav --pretty\n" +
      "  node scripts/extract_audio.js downloads/video.mp4 --mp3 --bitrate 320k --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    let result;
    if (args.format === "mp3") {
      result = await extractMP3(args.videoPath, {
        outputPath: args.outputPath,
        bitrate: args.bitrate,
      });
    } else {
      result = await extractWAV(args.videoPath, {
        outputPath: args.outputPath,
        sampleRate: args.sampleRate,
        channels: args.channels,
      });
    }

    const output = JSON.stringify(result, null, args.pretty ? 2 : 0);
    process.stdout.write(`${output}\n`);
    process.exitCode = result.error ? 1 : 0;
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
  extractMP3,
};
