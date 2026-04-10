#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { spawn } = require("node:child_process");
const {
  findRepoRoot,
  loadRepoEnv,
  resolveRepoPath,
  resolveSharedDataDir,
  resolveCommand,
} = require("./runtime_env");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = findRepoRoot(SKILL_DIR);
loadRepoEnv(REPO_ROOT);

const SHARED_DATA_DIR = resolveSharedDataDir(REPO_ROOT);
const DEFAULT_LOCAL_RUNS_DIR = resolveRepoPath(
  REPO_ROOT,
  process.env.AI_AUTO_TRANSLATE_REMOTE_CLIENT_RUNS_DIR,
  path.join(path.relative(REPO_ROOT, SHARED_DATA_DIR), "auto-translate", "remote-client-runs")
);

function nowIso() {
  return new Date().toISOString();
}

function log(stage, message) {
  process.stdout.write(`[${nowIso()}] [${stage}] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    input: null,
    remoteBaseUrl: process.env.AI_AUTO_TRANSLATE_REMOTE_BASE_URL || "",
    token: process.env.AI_AUTO_TRANSLATE_WORKER_TOKEN || "",
    backend: process.env.AI_AUTO_TRANSLATE_WORKER_BACKEND || "",
    modelSize: process.env.AI_AUTO_TRANSLATE_DEFAULT_MODEL || "base",
    language: process.env.AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE || "auto",
    threads: Number(process.env.AI_AUTO_TRANSLATE_THREADS || 4),
    clipSeconds: 0,
    startSeconds: 0,
    pollSeconds: 5,
    sendWav: true,
    outputDir: null,
    keepWav: false,
    includeText: true,
    computeType: process.env.AI_AUTO_TRANSLATE_GPU_COMPUTE_TYPE || "",
    beamSize: Number(process.env.AI_AUTO_TRANSLATE_GPU_BEAM_SIZE || 5),
    debug: false,
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

    if (token === "--send-original") {
      args.sendWav = false;
      continue;
    }
    if (token === "--keep-wav") {
      args.keepWav = true;
      continue;
    }
    if (token === "--no-include-text") {
      args.includeText = false;
      continue;
    }
    if (token === "--debug") {
      args.debug = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--remote-base-url":
        args.remoteBaseUrl = nextValue;
        break;
      case "--token":
        args.token = nextValue;
        break;
      case "--backend":
        args.backend = nextValue;
        break;
      case "--model-size":
        args.modelSize = nextValue;
        break;
      case "--language":
        args.language = nextValue;
        break;
      case "--threads":
        args.threads = Number(nextValue);
        break;
      case "--clip-seconds":
        args.clipSeconds = Number(nextValue);
        break;
      case "--start-seconds":
        args.startSeconds = Number(nextValue);
        break;
      case "--poll-seconds":
        args.pollSeconds = Number(nextValue);
        break;
      case "--output-dir":
        args.outputDir = nextValue;
        break;
      case "--compute-type":
        args.computeType = nextValue;
        break;
      case "--beam-size":
        args.beamSize = Number(nextValue);
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error("Usage: node skills/autoTranslate/scripts/submit_remote_transcribe.js <media-file> --remote-base-url http://windows-host:8768");
  }
  if (!args.remoteBaseUrl) {
    throw new Error("Remote base URL is required. Set --remote-base-url or AI_AUTO_TRANSLATE_REMOTE_BASE_URL.");
  }

  return args;
}

function makeClientRunDir(inputPath, outputDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stem = path.basename(inputPath).replace(path.extname(inputPath), "").replace(/[^\w.-]+/g, "_");
  const runDir = path.resolve(outputDir || path.join(DEFAULT_LOCAL_RUNS_DIR, `${stem}-${timestamp}`));
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function requestUrl(method, urlString, options = {}) {
  const url = new URL(urlString);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method,
      headers: options.headers || {},
      timeout: options.timeoutMs ?? 30000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error(`Request timeout for ${urlString}`)));

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitCommand(commandText) {
  return String(commandText || "").trim().split(/\s+/).filter(Boolean);
}

function runFfmpegExtract(ffmpegCommand, inputPath, wavPath, startSeconds, clipSeconds) {
  return new Promise((resolve, reject) => {
    const args = [...splitCommand(ffmpegCommand), "-y"];
    if (startSeconds > 0) args.push("-ss", String(startSeconds));
    args.push("-i", inputPath);
    if (clipSeconds > 0) args.push("-t", String(clipSeconds));
    args.push("-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath);

    const [command, ...rest] = args;
    const child = spawn(command, rest, { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.on("data", () => {});
    child.stdout.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const runDir = makeClientRunDir(inputPath, args.outputDir);
  const ffmpegCommand = resolveCommand("ffmpeg", "AI_FFMPEG_COMMAND");

  let uploadPath = inputPath;
  if (args.sendWav) {
    uploadPath = path.join(runDir, "upload.wav");
    log("prepare", `extracting wav before upload: ${uploadPath}`);
    await runFfmpegExtract(ffmpegCommand, inputPath, uploadPath, args.startSeconds, args.clipSeconds);
  }

  const uploadBuffer = fs.readFileSync(uploadPath);
  const createUrl = new URL("/jobs", args.remoteBaseUrl);
  if (args.backend) createUrl.searchParams.set("backend", args.backend);
  createUrl.searchParams.set("modelSize", args.modelSize);
  createUrl.searchParams.set("language", args.language);
  createUrl.searchParams.set("threads", String(args.threads));
  createUrl.searchParams.set("keepWav", args.keepWav ? "true" : "false");
  if (args.computeType) createUrl.searchParams.set("computeType", args.computeType);
  if (Number.isFinite(args.beamSize) && args.beamSize > 0) createUrl.searchParams.set("beamSize", String(args.beamSize));
  if (args.debug) createUrl.searchParams.set("debug", "true");

  log("upload", `sending ${path.basename(uploadPath)} (${Math.round(uploadBuffer.length / 1024 / 1024)}MB) to ${createUrl.origin}`);
  const createResponse = await requestUrl("POST", createUrl.toString(), {
    headers: {
      "content-type": "audio/wav",
      "x-file-name": path.basename(uploadPath),
      ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
    },
    body: uploadBuffer,
    timeoutMs: 0,
  });

  if (createResponse.statusCode < 200 || createResponse.statusCode >= 300) {
    throw new Error(`Remote job creation failed: HTTP ${createResponse.statusCode}\n${createResponse.body.toString("utf8")}`);
  }

  const createPayload = JSON.parse(createResponse.body.toString("utf8"));
  const jobId = createPayload.job_id;
  log("remote", `job created: ${jobId}`);

  let statusPayload = null;
  while (true) {
    await sleep(args.pollSeconds * 1000);
    const statusResponse = await requestUrl("GET", new URL(`/jobs/${jobId}`, args.remoteBaseUrl).toString(), {
      headers: args.token ? { authorization: `Bearer ${args.token}` } : {},
      timeoutMs: 30000,
    });
    if (statusResponse.statusCode !== 200) {
      throw new Error(`Remote status check failed: HTTP ${statusResponse.statusCode}`);
    }

    statusPayload = JSON.parse(statusResponse.body.toString("utf8"));
    const progress = statusPayload.progress;
    const progressText = progress && Number.isFinite(progress.percent)
      ? ` progress=${progress.percent}% stage=${progress.stage}`
      : "";
    log("remote", `status=${statusPayload.status}${progressText}`);

    if (statusPayload.status === "completed") break;
    if (statusPayload.status === "failed") {
      throw new Error(statusPayload.error || "Remote job failed");
    }
  }

  const filesToDownload = ["transcript.txt", "transcript.json", "transcript.srt", "run-summary.json", "worker.log"];
  const downloaded = {};
  for (const fileName of filesToDownload) {
    const response = await requestUrl("GET", new URL(`/jobs/${jobId}/files/${fileName}`, args.remoteBaseUrl).toString(), {
      headers: args.token ? { authorization: `Bearer ${args.token}` } : {},
      timeoutMs: 30000,
    });
    if (response.statusCode === 200) {
      const filePath = path.join(runDir, fileName);
      fs.writeFileSync(filePath, response.body);
      downloaded[fileName] = filePath;
      log("download", `${fileName} -> ${filePath}`);
    }
  }

  let transcriptText = null;
  if (args.includeText) {
    const textResponse = await requestUrl("GET", new URL(`/jobs/${jobId}/text`, args.remoteBaseUrl).toString(), {
      headers: args.token ? { authorization: `Bearer ${args.token}` } : {},
      timeoutMs: 30000,
    });
    if (textResponse.statusCode === 200) {
      transcriptText = textResponse.body.toString("utf8");
    }
  }

  if (!args.keepWav && args.sendWav) {
    fs.rmSync(uploadPath, { force: true });
  }

  const result = {
    ok: true,
    job_id: jobId,
    local_run_dir: runDir,
    remote_status: statusPayload.status,
    remote_progress: statusPayload.progress || null,
    remote_result: statusPayload.result || null,
    downloaded_files: downloaded,
    transcript_text: transcriptText,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
