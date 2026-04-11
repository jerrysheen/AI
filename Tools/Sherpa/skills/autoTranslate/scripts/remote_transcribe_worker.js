const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function loadEnv() {
  const root = repoRoot();
  const envFile = fs.existsSync(path.join(root, ".env"))
    ? path.join(root, ".env")
    : path.join(root, ".env.example");
  const parsed = {};
  if (fs.existsSync(envFile)) {
    for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }
      const [key, ...rest] = line.split("=");
      parsed[key] = rest.join("=");
    }
  }
  return { ...parsed, ...process.env };
}

const env = loadEnv();
const host = env.AI_AUTO_TRANSLATE_WORKER_HOST || "127.0.0.1";
const port = Number(env.AI_AUTO_TRANSLATE_WORKER_PORT || "8765");
const runsRoot = path.resolve(repoRoot(), env.AI_AUTO_TRANSLATE_OUTPUT_ROOT || ".ai-data/sherpa-onnx/runs");
const supportedBackends = ["sherpa"];
const jobs = new Map();

async function ensureDir(target) {
  await fsp.mkdir(target, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function launchSherpaJob(payload) {
  const jobId = crypto.randomUUID().replace(/-/g, "");
  const outputDir = path.join(runsRoot, jobId);
  await ensureDir(outputDir);

  const job = {
    id: jobId,
    backend: "sherpa",
    mediaPath: payload.mediaPath,
    provider: payload.provider || env.AI_AUTO_TRANSLATE_SHERPA_PROVIDER || "cuda",
    language: payload.language || env.AI_AUTO_TRANSLATE_SHERPA_LANGUAGE || "auto",
    outputDir,
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  jobs.set(jobId, job);

  const venvPython = path.resolve(repoRoot(), env.AI_AUTO_TRANSLATE_SHERPA_VENV || ".ai-data/tools/sherpa-onnx/venv", "Scripts", "python.exe");
  const pythonExe = fs.existsSync(venvPython) ? venvPython : "python";
  const scriptPath = path.join(__dirname, "transcribe_local_media_sherpa.py");
  const args = [scriptPath, "--input", payload.mediaPath, "--output-dir", outputDir, "--job-id", jobId, "--provider", job.provider, "--language", job.language];

  const child = spawn(pythonExe, args, {
    cwd: repoRoot(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  job.status = "running";
  job.pid = child.pid;
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("exit", async (code) => {
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    job.stdout = stdout.slice(-4000);
    job.stderr = stderr.slice(-4000);
    const summaryPath = path.join(outputDir, "run-summary.json");
    if (fs.existsSync(summaryPath)) {
      try {
        job.summary = JSON.parse(await fsp.readFile(summaryPath, "utf8"));
      } catch (error) {
        job.summaryReadError = String(error);
      }
    }
  });

  return job;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        backend: env.AI_AUTO_TRANSLATE_SHERPA_BACKEND || "sherpa",
        supportedBackends,
        provider: env.AI_AUTO_TRANSLATE_SHERPA_PROVIDER || "cuda",
        runsRoot,
      });
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      const body = await readJson(req);
      if (!body.mediaPath) {
        return sendJson(res, 400, { ok: false, error: "mediaPath is required" });
      }
      if (body.backend && body.backend !== "sherpa") {
        return sendJson(res, 400, { ok: false, error: `Unsupported backend: ${body.backend}` });
      }
      const job = await launchSherpaJob(body);
      return sendJson(res, 202, { ok: true, job });
    }

    if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const jobId = url.pathname.split("/").pop();
      if (!jobs.has(jobId)) {
        return sendJson(res, 404, { ok: false, error: "Job not found" });
      }
      return sendJson(res, 200, { ok: true, job: jobs.get(jobId) });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error) });
  }
});

ensureDir(runsRoot).then(() => {
  server.listen(port, host, () => {
    console.log(`[worker] listening on http://${host}:${port}`);
  });
});
