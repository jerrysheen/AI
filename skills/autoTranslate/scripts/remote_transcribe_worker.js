#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  findRepoRoot,
  loadRepoEnv,
  resolveRepoPath,
  resolveSharedDataDir,
} = require("./runtime_env");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = findRepoRoot(SKILL_DIR);
loadRepoEnv(REPO_ROOT);

const SHARED_DATA_DIR = resolveSharedDataDir(REPO_ROOT);
const WORKER_HOST = process.env.AI_AUTO_TRANSLATE_WORKER_HOST || "0.0.0.0";
const WORKER_PORT = Number(process.env.AI_AUTO_TRANSLATE_WORKER_PORT || 8768);
const WORKER_TOKEN = process.env.AI_AUTO_TRANSLATE_WORKER_TOKEN || "";
const DEFAULT_WORKER_BACKEND = String(process.env.AI_AUTO_TRANSLATE_WORKER_BACKEND || "cpu").trim().toLowerCase();
const MAX_UPLOAD_MB = Number(process.env.AI_AUTO_TRANSLATE_WORKER_MAX_UPLOAD_MB || 2048);
const MAX_UPLOAD_BYTES = Math.max(64, MAX_UPLOAD_MB) * 1024 * 1024;
const JOBS_ROOT = resolveRepoPath(
  REPO_ROOT,
  process.env.AI_AUTO_TRANSLATE_WORKER_JOBS_DIR,
  path.join(path.relative(REPO_ROOT, SHARED_DATA_DIR), "auto-translate", "remote-jobs")
);

const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sanitizeFileName(name) {
  return String(name || "input.wav").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function ensureAuthorized(request, response) {
  if (!WORKER_TOKEN) return true;
  const header = request.headers.authorization || "";
  if (header === `Bearer ${WORKER_TOKEN}`) return true;
  sendJson(response, 401, { ok: false, error: "Unauthorized" });
  return false;
}

function buildJobInfo(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  const info = {
    ok: job.status === "completed",
    job_id: jobId,
    status: job.status,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    input_file: job.inputFile,
    run_dir: job.runDir,
    backend: getJobBackend(job),
    options: job.options,
    log_file: job.logPath,
    progress: job.progress || null,
    transcript_txt_ready: fs.existsSync(path.join(job.runDir, "transcript.txt")),
    result: job.result || null,
    error: job.error || null,
  };

  return info;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: nowIso() });
  jobs.set(jobId, job);
}

function appendLog(logPath, line) {
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

function setJobProgress(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return;
  const current = job.progress || { stage: "queued", percent: 0, message: "" };
  updateJob(jobId, {
    progress: {
      ...current,
      ...patch,
      updated_at: nowIso(),
    },
  });
}

function parseBoolean(value) {
  return value === "1" || value === "true" || value === "yes";
}

function splitCommand(commandText) {
  return String(commandText || "").trim().split(/\s+/).filter(Boolean);
}

function getSupportedBackends() {
  const supported = ["cpu"];
  const gpuScriptPath = path.join(SKILL_DIR, "scripts", "transcribe_local_media_gpu.py");
  if (fs.existsSync(gpuScriptPath) && String(process.env.AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND || "").trim()) {
    supported.push("gpu");
  }
  return supported;
}

function isBackendSupported(backend) {
  return getSupportedBackends().includes(backend);
}

function getJobBackend(job) {
  return String(job?.options?.backend || DEFAULT_WORKER_BACKEND || "cpu").trim().toLowerCase();
}

function maybeUpdateProgressFromLine(jobId, text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const stageMatch = line.match(/^\[[^\]]+\] \[([^\]]+)\] (.+)$/);
    if (stageMatch) {
      const stage = stageMatch[1];
      const message = stageMatch[2];
      const stageBaseline = { setup: 1, model: 5, probe: 20, extract: 25, whisper: 30, done: 100 };
      const patch = { stage, message };
      if (stage in stageBaseline) {
        patch.percent = stageBaseline[stage];
      }
      const modelDownloadMatch = message.match(/^download (\d+)%/);
      if (stage === "model" && modelDownloadMatch) {
        patch.percent = Math.min(25, Math.max(5, Math.floor(Number(modelDownloadMatch[1]) * 0.2)));
      }
      const extractMatch = message.match(/^audio extraction (\d+)%/);
      if (stage === "extract" && extractMatch) {
        patch.percent = 25 + Math.floor(Number(extractMatch[1]) * 0.05);
      }
      const segmentProgressMatch = message.match(/^segment progress (\d+)%/);
      if (stage === "whisper" && segmentProgressMatch) {
        patch.percent = 30 + Math.floor(Number(segmentProgressMatch[1]) * 0.69);
      }
      setJobProgress(jobId, patch);
    }

    const whisperProgressMatch = line.match(/whisper_print_progress_callback: progress =\s*(\d+)%/);
    if (whisperProgressMatch) {
      const rawPercent = Number(whisperProgressMatch[1]);
      setJobProgress(jobId, {
        stage: "whisper",
        percent: 30 + Math.floor(rawPercent * 0.69),
        message: `whisper progress ${rawPercent}%`,
      });
    }
  }
}

function startTranscription(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const backend = getJobBackend(job);
  let command = "node";
  let args = [];

  if (!isBackendSupported(backend)) {
    updateJob(jobId, { status: "failed", error: `Backend not supported: ${backend}` });
    setJobProgress(jobId, { stage: "failed", percent: 100, message: `backend not supported: ${backend}` });
    appendLog(job.logPath, `[${nowIso()}] [worker] backend not supported: ${backend}`);
    return;
  }

  if (backend === "gpu") {
    const pythonCommand = process.env.AI_AUTO_TRANSLATE_GPU_PYTHON_COMMAND || "python";
    const pythonParts = splitCommand(pythonCommand);
    command = pythonParts[0] || "python";
    const commandPrefix = pythonParts.slice(1);
    const scriptPath = path.join(SKILL_DIR, "scripts", "transcribe_local_media_gpu.py");
    args = [
      ...commandPrefix,
      scriptPath,
      job.inputPath,
      "--output-dir", job.runDir,
    ];
    if (job.options.modelSize) args.push("--model-size", job.options.modelSize);
    if (job.options.language) args.push("--language", job.options.language);
    if (job.options.startSeconds) args.push("--start-seconds", String(job.options.startSeconds));
    if (job.options.clipSeconds) args.push("--clip-seconds", String(job.options.clipSeconds));
    if (job.options.prompt) args.push("--prompt", job.options.prompt);
    if (job.options.keepWav) args.push("--keep-wav");
    if (job.options.computeType) args.push("--compute-type", job.options.computeType);
    if (job.options.beamSize) args.push("--beam-size", String(job.options.beamSize));
    if (job.options.debug) args.push("--debug");
  } else {
    const scriptPath = path.join(SKILL_DIR, "scripts", "transcribe_local_media.js");
    args = [
      scriptPath,
      job.inputPath,
      "--output-dir", job.runDir,
    ];
    if (job.options.modelSize) args.push("--model-size", job.options.modelSize);
    if (job.options.language) args.push("--language", job.options.language);
    if (job.options.threads) args.push("--threads", String(job.options.threads));
    if (job.options.startSeconds) args.push("--start-seconds", String(job.options.startSeconds));
    if (job.options.clipSeconds) args.push("--clip-seconds", String(job.options.clipSeconds));
    if (job.options.prompt) args.push("--prompt", job.options.prompt);
    if (job.options.keepWav) args.push("--keep-wav");
  }

  updateJob(jobId, { status: "running" });
  setJobProgress(jobId, { stage: "queued", percent: 0, message: `job accepted (${backend})` });
  appendLog(job.logPath, `[${nowIso()}] [worker] starting transcription backend=${backend}`);

  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handleData = (prefix) => (chunk) => {
    const text = chunk.toString();
    appendLog(job.logPath, text.trimEnd());
    maybeUpdateProgressFromLine(jobId, text);
    process.stdout.write(`[worker:${jobId}] ${prefix}${text}`);
  };

  child.stdout.on("data", handleData(""));
  child.stderr.on("data", handleData("[stderr] "));

  child.on("close", (code) => {
    if (code === 0) {
      let result = null;
      const summaryPath = path.join(job.runDir, "run-summary.json");
      if (fs.existsSync(summaryPath)) {
        try {
          result = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        } catch {}
      }
      updateJob(jobId, { status: "completed", result });
      setJobProgress(jobId, { stage: "done", percent: 100, message: "completed" });
      appendLog(job.logPath, `[${nowIso()}] [worker] completed`);
      return;
    }

    updateJob(jobId, { status: "failed", error: `Transcription process exited with code ${code}` });
    setJobProgress(jobId, { stage: "failed", percent: 100, message: `failed with code ${code}` });
    appendLog(job.logPath, `[${nowIso()}] [worker] failed with code ${code}`);
  });

  child.on("error", (error) => {
    updateJob(jobId, { status: "failed", error: error.message });
    setJobProgress(jobId, { stage: "failed", percent: 100, message: error.message });
    appendLog(job.logPath, `[${nowIso()}] [worker] spawn error: ${error.message}`);
  });
}

function handleCreateJob(request, response, url) {
  if (!ensureAuthorized(request, response)) return;

  const fileName = sanitizeFileName(request.headers["x-file-name"] || "input.wav");
  const contentType = String(request.headers["content-type"] || "application/octet-stream");
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    sendJson(response, 413, { ok: false, error: `Upload too large. Limit is ${MAX_UPLOAD_MB} MB.` });
    return;
  }
  const allowedTypes = ["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"];
  if (!allowedTypes.some((item) => contentType.includes(item))) {
    sendJson(response, 415, {
      ok: false,
      error: `Unsupported content-type: ${contentType}. Send WAV or application/octet-stream.`,
    });
    return;
  }
  const jobId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const runDir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(runDir, { recursive: true });

  const ext = path.extname(fileName) || (contentType.includes("wav") ? ".wav" : ".bin");
  const inputFile = `${path.basename(fileName, path.extname(fileName)) || "input"}${ext}`;
  const inputPath = path.join(runDir, inputFile);
  const logPath = path.join(runDir, "worker.log");
  const options = {
    backend: String(url.searchParams.get("backend") || DEFAULT_WORKER_BACKEND || "cpu").trim().toLowerCase(),
    modelSize: url.searchParams.get("modelSize") || process.env.AI_AUTO_TRANSLATE_DEFAULT_MODEL || "base",
    language: url.searchParams.get("language") || process.env.AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE || "auto",
    threads: Number(url.searchParams.get("threads") || process.env.AI_AUTO_TRANSLATE_THREADS || 4),
    startSeconds: Number(url.searchParams.get("startSeconds") || 0),
    clipSeconds: Number(url.searchParams.get("clipSeconds") || 0),
    prompt: url.searchParams.get("prompt") || "",
    keepWav: parseBoolean(url.searchParams.get("keepWav") || "false"),
    computeType: url.searchParams.get("computeType") || process.env.AI_AUTO_TRANSLATE_GPU_COMPUTE_TYPE || "",
    beamSize: Number(url.searchParams.get("beamSize") || process.env.AI_AUTO_TRANSLATE_GPU_BEAM_SIZE || 5),
    debug: parseBoolean(url.searchParams.get("debug") || process.env.AI_AUTO_TRANSLATE_GPU_DEBUG || "false"),
  };
  if (!["cpu", "gpu"].includes(options.backend)) {
    sendJson(response, 400, { ok: false, error: `Unsupported backend: ${options.backend}` });
    return;
  }
  if (!isBackendSupported(options.backend)) {
    sendJson(response, 400, {
      ok: false,
      error: `Backend not available: ${options.backend}`,
      supported_backends: getSupportedBackends(),
    });
    return;
  }

  let receivedBytes = 0;
  const writeStream = fs.createWriteStream(inputPath);
  request.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_UPLOAD_BYTES) {
      request.destroy(new Error(`Upload exceeded ${MAX_UPLOAD_MB} MB limit.`));
      writeStream.destroy(new Error(`Upload exceeded ${MAX_UPLOAD_MB} MB limit.`));
    }
  });
  request.pipe(writeStream);

  writeStream.on("finish", () => {
    jobs.set(jobId, {
      status: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      inputFile,
      inputPath,
      runDir,
      logPath,
      options,
      progress: { stage: "queued", percent: 0, message: "upload received", updated_at: nowIso() },
      result: null,
      error: null,
    });
    appendLog(logPath, `[${nowIso()}] [worker] received ${inputFile}`);
    startTranscription(jobId);
    sendJson(response, 202, {
      ok: true,
      job_id: jobId,
      status: "queued",
      run_dir: runDir,
    });
  });

  writeStream.on("error", (error) => {
    fs.rmSync(inputPath, { force: true });
    sendJson(response, 500, { ok: false, error: error.message });
  });
}

function handleGetJob(response, jobId) {
  const info = buildJobInfo(jobId);
  if (!info) {
    sendJson(response, 404, { ok: false, error: "Job not found" });
    return;
  }
  sendJson(response, 200, info);
}

function handleGetJobFile(response, jobId, fileName) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Job not found" });
    return;
  }

  const allowed = new Map([
    ["transcript.txt", path.join(job.runDir, "transcript.txt")],
    ["transcript.json", path.join(job.runDir, "transcript.json")],
    ["transcript.srt", path.join(job.runDir, "transcript.srt")],
    ["run-summary.json", path.join(job.runDir, "run-summary.json")],
    ["worker.log", job.logPath],
  ]);

  const filePath = allowed.get(fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    sendJson(response, 404, { ok: false, error: "File not found" });
    return;
  }

  response.writeHead(200, { "content-type": "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function handleGetJobText(response, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Job not found" });
    return;
  }
  const filePath = path.join(job.runDir, "transcript.txt");
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { ok: false, error: "Transcript text not ready" });
    return;
  }
  sendText(response, 200, fs.readFileSync(filePath, "utf8"));
}

function createServer() {
  fs.mkdirSync(JOBS_ROOT, { recursive: true });

  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "autoTranslate-worker",
        repo_root: REPO_ROOT,
        jobs_root: JOBS_ROOT,
        port: WORKER_PORT,
        default_backend: DEFAULT_WORKER_BACKEND,
        supported_backends: getSupportedBackends(),
        gpu_available: isBackendSupported("gpu"),
        max_upload_mb: MAX_UPLOAD_MB,
        token_required: Boolean(WORKER_TOKEN),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/jobs") {
      handleCreateJob(request, response, url);
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      if (!ensureAuthorized(request, response)) return;
      handleGetJob(response, jobMatch[1]);
      return;
    }

    const textMatch = url.pathname.match(/^\/jobs\/([^/]+)\/text$/);
    if (request.method === "GET" && textMatch) {
      if (!ensureAuthorized(request, response)) return;
      handleGetJobText(response, textMatch[1]);
      return;
    }

    const fileMatch = url.pathname.match(/^\/jobs\/([^/]+)\/files\/([^/]+)$/);
    if (request.method === "GET" && fileMatch) {
      if (!ensureAuthorized(request, response)) return;
      handleGetJobFile(response, fileMatch[1], fileMatch[2]);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });
}

const server = createServer();
server.listen(WORKER_PORT, WORKER_HOST, () => {
  if (!WORKER_TOKEN) {
    process.stdout.write(`[${nowIso()}] [worker] warning: AI_AUTO_TRANSLATE_WORKER_TOKEN is empty; anyone who can reach this port can submit jobs\n`);
  }
  process.stdout.write(
    `[${nowIso()}] [worker] listening on http://${WORKER_HOST}:${WORKER_PORT} default_backend=${DEFAULT_WORKER_BACKEND} supported_backends=${getSupportedBackends().join(",")} jobs_root=${JOBS_ROOT} max_upload_mb=${MAX_UPLOAD_MB}\n`
  );
});
