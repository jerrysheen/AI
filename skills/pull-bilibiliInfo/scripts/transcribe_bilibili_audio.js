#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const {
  getBilibiliAsrDir,
  getFfmpegLocation,
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
    throw new Error("AI_WHISPER_PYTHON is empty.");
  }
  return {
    executable: matches[0],
    baseArgs: matches.slice(1),
  };
}

function getAsrOutputDir(explicitOutputDir) {
  return path.resolve(explicitOutputDir || getBilibiliAsrDir());
}

function buildWhisperCommand(audioFile, options = {}) {
  const resolvedAudioFile = path.resolve(audioFile);
  const bvid = extractBvid(resolvedAudioFile);
  const outputDir = getAsrOutputDir(options.outputDir);
  const ffmpegLocation = options.ffmpegLocation || getFfmpegLocation();
  const model = options.model || "small";
  const language = options.language || "Chinese";
  const outputFormat = options.outputFormat || "txt";
  const transcriptFile = path.join(outputDir, `${bvid}.${outputFormat}`);
  const scriptPath = path.resolve(__dirname, "transcribe_bilibili_audio.ps1");

  const args = [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-AudioFile",
    resolvedAudioFile,
    "-Model",
    model,
    "-Language",
    language,
    "-OutputDir",
    outputDir,
  ];

  return {
    bvid,
    executable: "powershell",
    args,
    outputDir,
    transcriptFile,
    ffmpegLocation,
    model,
    language,
    outputFormat,
  };
}

function transcribeBilibiliAudio(audioFile, options = {}) {
  const plan = buildWhisperCommand(audioFile, options);
  ensureDir(plan.outputDir);

  const env = { ...process.env };
  if (plan.ffmpegLocation) {
    env.PATH = `${plan.ffmpegLocation};${env.PATH || ""}`;
  }

  const result = cp.spawnSync(plan.executable, plan.args, {
    cwd: path.resolve(options.cwd || process.cwd()),
    env,
    encoding: "utf8",
    timeout: Number(options.timeoutMs) || 1000 * 60 * 60,
    maxBuffer: 1024 * 1024 * 64,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combinedOutput = `${stdout}${stderr}`.trim();

  if (result.error) {
    throw new Error(result.error.message || String(result.error));
  }

  if (result.status !== 0) {
    throw new Error(combinedOutput || "Whisper transcription failed.");
  }

  const transcriptText = fs.existsSync(plan.transcriptFile)
    ? fs.readFileSync(plan.transcriptFile, "utf8")
    : "";

  return {
    bvid: plan.bvid,
    audio_file: path.resolve(audioFile),
    transcript_file: plan.transcriptFile,
    transcript_text: transcriptText.trim(),
    model: plan.model,
    language: plan.language,
    ffmpeg_location: plan.ffmpegLocation || null,
    whisper_python: "powershell wrapper",
    log: combinedOutput,
  };
}

function parseArgs(argv) {
  const args = {
    audioFile: null,
    outputDir: null,
    model: "small",
    language: "Chinese",
    pretty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.audioFile) {
        args.audioFile = token;
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
    } else if (token === "--model") {
      args.model = nextValue;
    } else if (token === "--language") {
      args.language = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.audioFile) {
    throw new Error(
      "Usage: node transcribe_bilibili_audio.js <audio-file> [--model small] [--language Chinese] [--output-dir .\\.ai-data\\asr\\bilibili] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = transcribeBilibiliAudio(args.audioFile, {
      outputDir: args.outputDir,
      model: args.model,
      language: args.language,
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
  buildWhisperCommand,
  transcribeBilibiliAudio,
};
