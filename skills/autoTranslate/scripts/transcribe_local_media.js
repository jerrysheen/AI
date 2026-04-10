#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { spawn } = require("node:child_process");
const {
  findRepoRoot,
  loadRepoEnv,
  resolveSharedDataDir,
  resolveCommand,
} = require("./runtime_env");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = findRepoRoot(SKILL_DIR);
loadRepoEnv(REPO_ROOT);

const SHARED_DATA_DIR = resolveSharedDataDir(REPO_ROOT);
const DEFAULT_RUNS_DIR = path.join(
  REPO_ROOT,
  process.env.AI_AUTO_TRANSLATE_RUNS_DIR || path.join(path.relative(REPO_ROOT, SHARED_DATA_DIR), "auto-translate", "runs")
);
const DEFAULT_MODELS_DIR = path.join(
  REPO_ROOT,
  process.env.AI_AUTO_TRANSLATE_MODELS_DIR || path.join(path.relative(REPO_ROOT, SHARED_DATA_DIR), "cache", "whisper", "models")
);

const MODEL_REGISTRY = {
  tiny: {
    filename: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin?download=1",
    note: "Fastest multilingual option. Good for speed tests, weaker accuracy.",
  },
  base: {
    filename: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=1",
    note: "Balanced multilingual option. Better accuracy, moderate speed.",
  },
  small: {
    filename: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=1",
    note: "Higher accuracy but heavier on Intel 8GB machines.",
  },
};

function nowIso() {
  return new Date().toISOString();
}

function stageLog(stage, message) {
  process.stdout.write(`[${nowIso()}] [${stage}] ${message}\n`);
}

function parseArgs(argv) {
  const defaultThreads = Number(process.env.AI_AUTO_TRANSLATE_THREADS || Math.max(2, Math.min(os.cpus().length || 4, 4)));
  const args = {
    input: null,
    modelSize: String(process.env.AI_AUTO_TRANSLATE_DEFAULT_MODEL || "base").trim(),
    language: String(process.env.AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE || "auto").trim(),
    threads: defaultThreads,
    outputDir: null,
    startSeconds: 0,
    clipSeconds: 0,
    keepWav: false,
    prompt: "",
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

    if (token === "--keep-wav") {
      args.keepWav = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--model-size":
        args.modelSize = String(nextValue).trim();
        break;
      case "--language":
        args.language = String(nextValue).trim();
        break;
      case "--threads":
        args.threads = Number(nextValue);
        break;
      case "--output-dir":
        args.outputDir = nextValue;
        break;
      case "--start-seconds":
        args.startSeconds = Number(nextValue);
        break;
      case "--clip-seconds":
        args.clipSeconds = Number(nextValue);
        break;
      case "--prompt":
        args.prompt = String(nextValue);
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/autoTranslate/scripts/transcribe_local_media.js <media-file> [options]\n" +
      "\n" +
      "Options:\n" +
      "  --model-size tiny|base|small   Whisper model size (default from .env or base)\n" +
      "  --language auto|zh|en          Whisper language (default from .env or auto)\n" +
      "  --threads N                    CPU threads for whisper-cli\n" +
      "  --output-dir PATH              Run output directory\n" +
      "  --start-seconds N              Clip start offset in seconds\n" +
      "  --clip-seconds N               Only transcribe the first N seconds from start offset\n" +
      "  --prompt TEXT                  Initial prompt for whisper\n" +
      "  --keep-wav                     Keep extracted wav file\n"
    );
  }

  if (!MODEL_REGISTRY[args.modelSize]) {
    throw new Error(`Unsupported model size: ${args.modelSize}`);
  }
  if (!Number.isFinite(args.threads) || args.threads < 1) {
    throw new Error(`Invalid thread count: ${args.threads}`);
  }
  if (!Number.isFinite(args.startSeconds) || args.startSeconds < 0) {
    throw new Error(`Invalid start seconds: ${args.startSeconds}`);
  }
  if (!Number.isFinite(args.clipSeconds) || args.clipSeconds < 0) {
    throw new Error(`Invalid clip seconds: ${args.clipSeconds}`);
  }

  return args;
}

function splitCommand(commandText) {
  return String(commandText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function safeStem(inputPath) {
  return path.basename(inputPath).replace(path.extname(inputPath), "").replace(/[^\w.-]+/g, "_");
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "n/a";
  return `${seconds.toFixed(2)}s`;
}

function makeRunDir(inputPath, outputDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve(outputDir || path.join(DEFAULT_RUNS_DIR, `${safeStem(inputPath)}-${timestamp}`));
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function downloadFileWithProgress(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destinationPath}.part`;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadFileWithProgress(response.headers.location, destinationPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Model download failed with HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers["content-length"] || 0);
      let downloadedBytes = 0;
      let lastLoggedPercent = -1;

      const fileStream = fs.createWriteStream(tempPath);
      response.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastLoggedPercent + 10 || percent === 100) {
            lastLoggedPercent = percent;
            stageLog("model", `download ${percent}% (${Math.round(downloadedBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`);
          }
        }
      });

      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(() => {
          fs.renameSync(tempPath, destinationPath);
          resolve(destinationPath);
        });
      });
      fileStream.on("error", (error) => {
        fs.rmSync(tempPath, { force: true });
        reject(error);
      });
    });

    request.on("error", (error) => {
      fs.rmSync(`${destinationPath}.part`, { force: true });
      reject(error);
    });
  });
}

async function ensureModel(modelSize) {
  const model = MODEL_REGISTRY[modelSize];
  const modelPath = path.join(DEFAULT_MODELS_DIR, model.filename);
  if (fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1024 * 1024) {
    stageLog("model", `using cached model ${model.filename}`);
    return { modelPath, downloaded: false, note: model.note };
  }

  stageLog("model", `downloading ${model.filename}`);
  await downloadFileWithProgress(model.url, modelPath);
  return { modelPath, downloaded: true, note: model.note };
}

function runCommandWithStreaming(commandParts, options = {}) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = commandParts;
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const consumeStream = (stream, onLine, assign) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        assign(chunk.toString());
        buffer += chunk.toString();
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trimEnd();
          buffer = buffer.slice(newlineIndex + 1);
          if (onLine) onLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        const tail = buffer.trim();
        if (tail && onLine) onLine(tail);
      });
    };

    consumeStream(child.stdout, options.onStdoutLine, (chunk) => {
      stdout += chunk;
    });
    consumeStream(child.stderr, options.onStderrLine, (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function probeDuration(ffprobeCommand, inputPath) {
  const { stdout } = await runCommandWithStreaming([
    ...splitCommand(ffprobeCommand),
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration)) {
    throw new Error("Could not determine media duration.");
  }
  return duration;
}

async function extractAudio(ffmpegCommand, inputPath, wavPath, startSeconds, clipSeconds, totalDuration) {
  const commandParts = [...splitCommand(ffmpegCommand), "-y"];
  if (startSeconds > 0) {
    commandParts.push("-ss", String(startSeconds));
  }
  commandParts.push("-i", inputPath);
  if (clipSeconds > 0) {
    commandParts.push("-t", String(clipSeconds));
  }
  commandParts.push(
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    "-progress", "pipe:1",
    "-nostats",
    wavPath
  );

  let lastPercentBucket = -1;
  await runCommandWithStreaming(commandParts, {
    onStdoutLine(line) {
      if (!line.startsWith("out_time_ms=")) return;
      const outTimeMs = Number(line.split("=")[1] || 0);
      const stageDuration = clipSeconds > 0 ? clipSeconds : Math.max(totalDuration - startSeconds, 1);
      const percent = Math.min(100, Math.floor((outTimeMs / 1000000 / stageDuration) * 100));
      const bucket = Math.floor(percent / 10);
      if (bucket > lastPercentBucket) {
        lastPercentBucket = bucket;
        stageLog("extract", `audio extraction ${percent}%`);
      }
    },
  });
}

async function transcribeAudio(whisperCommand, modelPath, wavPath, transcriptBasePath, args) {
  const whisperArgs = [
    ...splitCommand(whisperCommand),
    "-m", modelPath,
    "-f", wavPath,
    "-t", String(args.threads),
    "-l", args.language,
    "-pp",
    "-oj",
    "-ojf",
    "-otxt",
    "-osrt",
    "-of", transcriptBasePath,
    "-ng",
  ];

  if (args.prompt) {
    whisperArgs.push("--prompt", args.prompt);
  }

  await runCommandWithStreaming(whisperArgs, {
    onStdoutLine(line) {
      if (line) stageLog("whisper", line);
    },
    onStderrLine(line) {
      if (line) stageLog("whisper", line);
    },
  });
}

function writeRunSummary(runDir, summary) {
  const summaryPath = path.join(runDir, "run-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summaryPath;
}

async function transcribeLocalMedia(inputPath, options = {}) {
  const args = parseArgs([
    inputPath,
    ...(options.modelSize ? ["--model-size", options.modelSize] : []),
    ...(options.language ? ["--language", options.language] : []),
    ...(options.threads ? ["--threads", String(options.threads)] : []),
    ...(options.outputDir ? ["--output-dir", options.outputDir] : []),
    ...(options.startSeconds ? ["--start-seconds", String(options.startSeconds)] : []),
    ...(options.clipSeconds ? ["--clip-seconds", String(options.clipSeconds)] : []),
    ...(options.prompt ? ["--prompt", options.prompt] : []),
    ...(options.keepWav ? ["--keep-wav"] : []),
  ]);

  const resolvedInputPath = path.resolve(args.input);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file does not exist: ${resolvedInputPath}`);
  }

  const ffmpegCommand = resolveCommand("ffmpeg", "AI_FFMPEG_COMMAND");
  const ffprobeCommand = resolveCommand("ffprobe", "AI_FFPROBE_COMMAND");
  const whisperCommand = resolveCommand("whisper-cli", "AI_WHISPER_CLI_COMMAND");

  const runDir = makeRunDir(resolvedInputPath, args.outputDir);
  const stageDurations = {};

  stageLog("setup", `repo root: ${REPO_ROOT}`);
  stageLog("setup", `input: ${resolvedInputPath}`);
  stageLog("setup", `run dir: ${runDir}`);
  stageLog("setup", `threads: ${args.threads}`);
  stageLog("setup", `model size: ${args.modelSize}`);
  stageLog("setup", `language: ${args.language}`);

  const modelStart = Date.now();
  const modelInfo = await ensureModel(args.modelSize);
  stageDurations.model_prepare_ms = Date.now() - modelStart;
  stageLog("model", modelInfo.note);
  stageLog("model", `model path: ${modelInfo.modelPath}`);

  const probeStart = Date.now();
  const mediaDurationSeconds = await probeDuration(ffprobeCommand, resolvedInputPath);
  stageDurations.media_probe_ms = Date.now() - probeStart;
  stageLog("probe", `media duration: ${formatSeconds(mediaDurationSeconds)}`);

  const effectiveDurationSeconds = args.clipSeconds > 0
    ? Math.min(args.clipSeconds, Math.max(mediaDurationSeconds - args.startSeconds, 0))
    : Math.max(mediaDurationSeconds - args.startSeconds, 0);

  const wavPath = path.join(runDir, "audio-16k-mono.wav");
  const transcriptBasePath = path.join(runDir, "transcript");

  const extractStart = Date.now();
  await extractAudio(
    ffmpegCommand,
    resolvedInputPath,
    wavPath,
    args.startSeconds,
    args.clipSeconds,
    mediaDurationSeconds
  );
  stageDurations.audio_extract_ms = Date.now() - extractStart;
  stageLog("extract", `audio ready: ${wavPath}`);

  const transcribeStart = Date.now();
  await transcribeAudio(whisperCommand, modelInfo.modelPath, wavPath, transcriptBasePath, args);
  stageDurations.transcribe_ms = Date.now() - transcribeStart;

  if (!args.keepWav) {
    fs.rmSync(wavPath, { force: true });
  }

  const transcriptTxtPath = `${transcriptBasePath}.txt`;
  const transcriptJsonPath = `${transcriptBasePath}.json`;
  const transcriptSrtPath = `${transcriptBasePath}.srt`;
  const speedMultiplier = effectiveDurationSeconds > 0
    ? effectiveDurationSeconds / (stageDurations.transcribe_ms / 1000)
    : null;

  const summary = {
    status: "completed",
    input_path: resolvedInputPath,
    run_dir: runDir,
    model_size: args.modelSize,
    model_path: modelInfo.modelPath,
    language: args.language,
    threads: args.threads,
    start_seconds: args.startSeconds,
    clip_seconds: args.clipSeconds,
    media_duration_seconds: mediaDurationSeconds,
    effective_audio_seconds: effectiveDurationSeconds,
    timings_ms: stageDurations,
    transcribe_speed_multiplier: speedMultiplier,
    outputs: {
      transcript_txt: fs.existsSync(transcriptTxtPath) ? transcriptTxtPath : null,
      transcript_json: fs.existsSync(transcriptJsonPath) ? transcriptJsonPath : null,
      transcript_srt: fs.existsSync(transcriptSrtPath) ? transcriptSrtPath : null,
      extracted_wav: args.keepWav && fs.existsSync(wavPath) ? wavPath : null,
    },
  };

  const summaryPath = writeRunSummary(runDir, summary);
  stageLog("done", `txt: ${summary.outputs.transcript_txt || "missing"}`);
  stageLog("done", `json: ${summary.outputs.transcript_json || "missing"}`);
  stageLog("done", `srt: ${summary.outputs.transcript_srt || "missing"}`);
  stageLog("done", `summary: ${summaryPath}`);
  if (speedMultiplier) {
    stageLog("done", `transcription speed: ${speedMultiplier.toFixed(2)}x realtime`);
  }

  return summary;
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const summary = await transcribeLocalMedia(cliArgs.input, cliArgs);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  transcribeLocalMedia,
};
