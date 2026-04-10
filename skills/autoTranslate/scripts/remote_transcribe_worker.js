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
    options: job.options,
    log_file: job.logPath,
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

function parseBoolean(value) {
  return value === "1" || value === "true" || value === "yes";
}

function startTranscription(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const scriptPath = path.join(SKILL_DIR, "scripts", "transcribe_local_media.js");
  const args = [
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

  updateJob(jobId, { status: "running" });
  appendLog(job.logPath, `[${nowIso()}] [worker] starting transcription`);

  const child = spawn("node", args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handleData = (prefix) => (chunk) => {
    const text = chunk.toString();
    appendLog(job.logPath, text.trimEnd());
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
      appendLog(job.logPath, `[${nowIso()}] [worker] completed`);
      return;
    }

    updateJob(jobId, { status: "failed", error: `Transcription process exited with code ${code}` });
    appendLog(job.logPath, `[${nowIso()}] [worker] failed with code ${code}`);
  });

  child.on("error", (error) => {
    updateJob(jobId, { status: "failed", error: error.message });
    appendLog(job.logPath, `[${nowIso()}] [worker] spawn error: ${error.message}`);
  });
}

function handleCreateJob(request, response, url) {
  if (!ensureAuthorized(request, response)) return;

  const fileName = sanitizeFileName(request.headers["x-file-name"] || "input.wav");
  const contentType = String(request.headers["content-type"] || "application/octet-stream");
  const jobId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const runDir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(runDir, { recursive: true });

  const ext = path.extname(fileName) || (contentType.includes("wav") ? ".wav" : ".bin");
  const inputFile = `${path.basename(fileName, path.extname(fileName)) || "input"}${ext}`;
  const inputPath = path.join(runDir, inputFile);
  const logPath = path.join(runDir, "worker.log");
  const options = {
    modelSize: url.searchParams.get("modelSize") || process.env.AI_AUTO_TRANSLATE_DEFAULT_MODEL || "base",
    language: url.searchParams.get("language") || process.env.AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE || "auto",
    threads: Number(url.searchParams.get("threads") || process.env.AI_AUTO_TRANSLATE_THREADS || 4),
    startSeconds: Number(url.searchParams.get("startSeconds") || 0),
    clipSeconds: Number(url.searchParams.get("clipSeconds") || 0),
    prompt: url.searchParams.get("prompt") || "",
    keepWav: parseBoolean(url.searchParams.get("keepWav") || "false"),
  };

  const writeStream = fs.createWriteStream(inputPath);
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
  process.stdout.write(
    `[${nowIso()}] [worker] listening on http://${WORKER_HOST}:${WORKER_PORT} jobs_root=${JOBS_ROOT}\n`
  );
});
