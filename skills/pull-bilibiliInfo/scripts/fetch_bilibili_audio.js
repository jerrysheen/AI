#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const {
  getBilibiliAudioDir,
  getFfmpegLocation,
  getYtDlpCommand,
} = require("./runtime_shim");
const { extractBvid } = require("./fetch_bilibili_subtitle");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

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

function getAudioOutputDir(explicitOutputDir) {
  return path.resolve(explicitOutputDir || getBilibiliAudioDir());
}

function buildDownloadCommand(videoUrl, options = {}) {
  const { executable, baseArgs } = parseCommand(options.ytDlpCommand || getYtDlpCommand());
  const bvid = extractBvid(videoUrl);
  const outputDir = getAudioOutputDir(options.outputDir);
  const ffmpegLocation = options.ffmpegLocation || getFfmpegLocation();
  const audioFormat = options.audioFormat || "m4a";
  const finalPath = path.join(outputDir, `${bvid}.${audioFormat}`);

  const args = [...baseArgs];
  args.push("-x");
  args.push("--audio-format", audioFormat);
  args.push("--no-playlist");
  args.push("-o", path.join(outputDir, "%(id)s.%(ext)s"));

  if (ffmpegLocation) {
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
    finalPath,
    ffmpegLocation,
    audioFormat,
  };
}

function downloadBilibiliAudio(videoUrl, options = {}) {
  const plan = buildDownloadCommand(videoUrl, options);
  ensureDir(plan.outputDir);

  const result = cp.spawnSync(plan.executable, plan.args, {
    cwd: path.resolve(options.cwd || process.cwd()),
    encoding: "utf8",
    timeout: Number(options.timeoutMs) || 1000 * 60 * 20,
    maxBuffer: 1024 * 1024 * 32,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combinedOutput = `${stdout}${stderr}`.trim();

  if (result.status !== 0) {
    throw new Error(combinedOutput || "yt-dlp audio download failed.");
  }

  const outputPath = fs.existsSync(plan.finalPath) ? plan.finalPath : null;
  const stat = outputPath ? fs.statSync(outputPath) : null;

  return {
    bvid: plan.bvid,
    video_url: videoUrl,
    audio_format: plan.audioFormat,
    audio_file: outputPath,
    file_size_bytes: stat ? stat.size : null,
    ffmpeg_location: plan.ffmpegLocation || null,
    yt_dlp_command: getYtDlpCommand(),
    output_dir: plan.outputDir,
    log: combinedOutput,
  };
}

function parseArgs(argv) {
  const args = {
    video: null,
    outputDir: null,
    audioFormat: "m4a",
    cookiesFromBrowser: null,
    cookiesFile: null,
    pretty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.video) {
        args.video = token;
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
    } else if (token === "--audio-format") {
      args.audioFormat = nextValue;
    } else if (token === "--cookies-from-browser") {
      args.cookiesFromBrowser = nextValue;
    } else if (token === "--cookies-file") {
      args.cookiesFile = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.video) {
    throw new Error(
      "Usage: node fetch_bilibili_audio.js <video-url-or-bvid> [--audio-format m4a] [--output-dir .\\.ai-data\\audio\\bilibili] [--cookies-from-browser chrome] [--cookies-file cookies.txt] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const bvid = extractBvid(args.video);
    const videoUrl = `https://www.bilibili.com/video/${bvid}`;
    const result = downloadBilibiliAudio(videoUrl, {
      outputDir: args.outputDir,
      audioFormat: args.audioFormat,
      cookiesFromBrowser: args.cookiesFromBrowser,
      cookiesFile: args.cookiesFile,
    });
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
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
  buildDownloadCommand,
  downloadBilibiliAudio,
  parseArgs,
};
