#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

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
  getDownloadsRootDir,
  getDailyJobsPath,
  loadOrCreateDailyJobs,
  saveDailyJobs,
  addJobToDailyJobs,
  updateJobStatus,
  getJobsByStatus,
  getJobById,
  getDateStr,
  ensureDir,
} = runtimeConfig;

function nowIso() {
  return new Date().toISOString();
}

function normalizeInput(value) {
  return String(value || "").trim();
}

function findExistingJob(source, sourceUrl) {
  const normalizedSourceUrl = normalizeInput(sourceUrl);
  if (!normalizedSourceUrl) {
    return null;
  }

  const sourceType = detectSourceType(source, normalizedSourceUrl);
  const jobsData = loadOrCreateDailyJobs();
  const jobs = [...jobsData.jobs].reverse();

  return jobs.find((job) => {
    if (sourceType && job.source !== sourceType) {
      return false;
    }
    return normalizeInput(job.source_url) === normalizedSourceUrl;
  }) || null;
}

function reconcileJobArtifacts(job) {
  if (!job?.job_id || !job?.data_path) {
    return job;
  }

  const taskDir = resolveJobTaskDir(job);
  if (!taskDir || !fs.existsSync(taskDir)) {
    return job;
  }

  const detectedFiles = {
    text: fs.existsSync(path.join(taskDir, "content.txt")) ? "content.txt" : null,
    transcript: fs.existsSync(path.join(taskDir, "transcript.txt")) ? "transcript.txt" : null,
    images: null,
    video: fs.existsSync(path.join(taskDir, "video.mp4")) ? "video.mp4" : null,
  };
  const hasSummary = fs.existsSync(path.join(taskDir, "summary.json"));

  const currentFiles = job.content_files || {};
  const mergedFiles = {
    text: currentFiles.text || detectedFiles.text,
    transcript: currentFiles.transcript || detectedFiles.transcript,
    images: currentFiles.images || detectedFiles.images,
    video: currentFiles.video || detectedFiles.video,
  };

  const needsFileUpdate = JSON.stringify(currentFiles) !== JSON.stringify(mergedFiles);
  const nextContentType = {
    has_video: Boolean(mergedFiles.video),
    has_images: Boolean(mergedFiles.images),
    has_text: Boolean(mergedFiles.text || mergedFiles.transcript),
  };
  const needsContentTypeUpdate = JSON.stringify(job.content_type || {}) !== JSON.stringify(nextContentType);

  let nextStatus = job.status;
  if ((mergedFiles.transcript || hasSummary) && !["processed", "failed"].includes(job.status)) {
    nextStatus = "processed";
  }
  const needsStatusUpdate = nextStatus !== job.status;

  if (!needsFileUpdate && !needsContentTypeUpdate && !needsStatusUpdate) {
    return job;
  }

  return updateJobStatus(job.job_id, nextStatus, {
    content_files: mergedFiles,
    content_type: nextContentType,
  });
}

function spawnProcess(jobId) {
  const child = spawn(process.execPath, [__filename, "process", jobId], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function getJobStatusSummary(jobId) {
  const job = reconcileJobArtifacts(getJobById(jobId));
  if (!job) {
    return null;
  }

  return {
    job_id: job.job_id,
    source: job.source,
    source_url: job.source_url,
    title: job.title || "",
    status: job.status,
    is_terminal: job.status === "processed" || job.status === "failed",
    progress: job.progress || null,
    notes: job.notes || "",
    content_type: job.content_type || null,
    data_path: job.data_path || null,
    content_files: job.content_files || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(jobId, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10 * 60 * 1000);
  const pollIntervalMs = Number(options.pollIntervalMs || 2000);
  const start = Date.now();
  let lastProgressSignature = "";

  while (Date.now() - start < timeoutMs) {
    const status = getJobStatusSummary(jobId);
    if (!status) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const progress = status.progress || {};
    const signature = [
      status.status,
      progress.stage || "",
      Number.isFinite(progress.percent) ? progress.percent : "",
      progress.message || "",
    ].join("|");

    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature;
      const percent = Number.isFinite(progress.percent) ? `${progress.percent}%` : "?";
      const stage = progress.stage || status.status;
      const message = progress.message || "";
      console.log(`[progress] ${status.job_id} status=${status.status} stage=${stage} percent=${percent} ${message}`.trim());
    }

    if (status.is_terminal) {
      return status;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out while waiting for job: ${jobId}`);
}

function resolveJobTaskDir(job) {
  if (!job?.data_path) {
    return null;
  }
  const jobDate = getDateStr(new Date(job.created_at || Date.now()));
  return path.join(getDownloadsRootDir(), jobDate, job.data_path);
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function buildSummaryArtifacts(job) {
  job = reconcileJobArtifacts(job);
  if (!job) {
    throw new Error("Job not found.");
  }
  if (job.status !== "processed") {
    throw new Error(`Job is not ready for summarization: ${job.job_id} (${job.status})`);
  }

  const taskDir = resolveJobTaskDir(job);
  if (!taskDir || !fs.existsSync(taskDir)) {
    throw new Error(`Task directory not found for job: ${job.job_id}`);
  }

  const title = path.basename(taskDir);
  const transcriptPath = job.content_files?.transcript
    ? path.join(taskDir, job.content_files.transcript)
    : null;
  const contentPath = job.content_files?.text
    ? path.join(taskDir, job.content_files.text)
    : null;
  const metadataPath = fs.existsSync(path.join(taskDir, "metadata.json"))
    ? path.join(taskDir, "metadata.json")
    : null;
  const transcriptText = readTextIfExists(transcriptPath).trim();
  const contentText = readTextIfExists(contentPath).trim();

  const summaryPayload = {
    title,
    source: job.source,
    source_url: job.source_url,
    content: contentText,
    transcript: transcriptText,
  };

  const summaryText = `${JSON.stringify(summaryPayload, null, 2)}\n`;
  const summaryTxtPath = path.join(taskDir, "summary.txt");
  const summaryJsonPath = path.join(taskDir, "summary.json");
  fs.writeFileSync(summaryTxtPath, summaryText, "utf8");
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summaryPayload, null, 2), "utf8");

  return {
    ok: true,
    job_id: job.job_id,
    source: job.source,
    title,
    status: job.status,
    summary: summaryPayload,
    summary_txt_path: summaryTxtPath,
    summary_json_path: summaryJsonPath,
    artifacts: {
      task_dir: taskDir,
      transcript_path: transcriptPath,
      content_path: contentPath,
      metadata_path: metadataPath,
    },
  };
}

function fetchJob(source, sourceUrl, title = "") {
  const existing = findExistingJob(source, sourceUrl);
  if (existing) {
    if (existing.status === "raw" || existing.status === "pending" || existing.status === "failed") {
      spawnProcess(existing.job_id);
    }
    return {
      ok: true,
      reused_existing_job: true,
      job_id: existing.job_id,
      source: existing.source,
      source_url: existing.source_url,
      status: existing.status,
      progress: existing.progress || null,
    };
  }

  const job = addJob(source, sourceUrl, title);
  updateJobStatus(job.job_id, "raw", {
    progress: {
      stage: "queued",
      percent: 0,
      message: "任务已创建，等待处理",
      updated_at: nowIso(),
    },
  });
  spawnProcess(job.job_id);
  return {
    ok: true,
    reused_existing_job: false,
    job_id: job.job_id,
    source: job.source,
    source_url: job.source_url,
    status: "raw",
    progress: {
      stage: "queued",
      percent: 0,
      message: "任务已创建，等待处理",
      updated_at: nowIso(),
    },
  };
}

function summarizeJob(inputOrJobId, source = null) {
  const normalized = normalizeInput(inputOrJobId);
  const job = normalized.startsWith("job_")
    ? getJobById(normalized)
    : findExistingJob(source, normalized);

  if (!job) {
    throw new Error(`No existing job found for: ${inputOrJobId}`);
  }

  return buildSummaryArtifacts(job);
}

async function fetchAndSummarize(source, sourceUrl, options = {}) {
  const started = fetchJob(source, sourceUrl, options.title || "");
  const finalStatus = await waitForJob(started.job_id, options);
  if (finalStatus.status !== "processed") {
    return {
      ok: false,
      job_id: started.job_id,
      status: finalStatus.status,
      progress: finalStatus.progress || null,
      notes: finalStatus.notes || "",
    };
  }
  return buildSummaryArtifacts(getJobById(started.job_id));
}

// ========== 工具函数 ==========

function clearAllDownloads() {
  const downloadsRoot = getDownloadsRootDir();
  if (!fs.existsSync(downloadsRoot)) {
    console.log("Downloads directory doesn't exist, nothing to clear");
    return;
  }

  // 删除整个 downloads 目录
  const rmSync = fs.rmSync || fs.rmdirSync;
  rmSync(downloadsRoot, { recursive: true, force: true });
  console.log(`Cleared all downloads: ${downloadsRoot}`);

  // 重新创建空目录
  ensureDir(downloadsRoot);
}

function clearAllJobs() {
  const jobsData = loadOrCreateDailyJobs();
  jobsData.jobs = [];
  saveDailyJobs(jobsData);
  console.log("Cleared all jobs from daily_jobs.json");
}

function listJobs(status = null) {
  const jobsData = loadOrCreateDailyJobs();

  if (jobsData.jobs.length === 0) {
    console.log("No jobs found");
    return;
  }

  let jobs = jobsData.jobs.map((job) => reconcileJobArtifacts(job));
  if (status) {
    jobs = jobs.filter((j) => j.status === status);
  }

  console.log(`\n=== Jobs (${jobs.length}/${jobsData.jobs.length}) ===\n`);
  for (const job of jobs) {
    console.log(`[${job.status}] ${job.job_id}`);
    console.log(`  Source: ${job.source} - ${job.title || "Untitled"}`);
    console.log(`  URL: ${job.source_url}`);
    console.log(`  Content: video=${job.content_type.has_video} images=${job.content_type.has_images} text=${job.content_type.has_text}`);
    console.log(`  Created: ${job.created_at}`);
    console.log();
  }

  console.log("=== Statistics ===");
  console.log(JSON.stringify(jobsData.statistics, null, 2));
}

function addJob(source, sourceUrl, title = "") {
  // 检测来源类型
  const sourceType = detectSourceType(source, sourceUrl);
  if (!sourceType) {
    throw new Error(`Unable to detect source type for: ${source} - ${sourceUrl}`);
  }

  const job = addJobToDailyJobs({
    source: sourceType,
    source_url: sourceUrl,
    title: title || "",
    content_type: { has_video: false, has_images: false, has_text: false }, // 会在处理时更新
    status: "raw",
  });

  console.log(`Added job: ${job.job_id}`);
  console.log(`  Source: ${job.source}`);
  console.log(`  URL: ${job.source_url}`);
  return job;
}

function detectSourceType(source, sourceUrl) {
  if (source && ["tiktok", "xhs", "twitter", "bilibili", "youtube"].includes(source.toLowerCase())) {
    return source.toLowerCase();
  }

  // 从 URL 检测
  const url = sourceUrl || source;
  if (/douyin\.com|iesdouyin\.com|v\.douyin\.com|tiktok\.com|vm\.tiktok\.com/.test(url)) {
    return "tiktok";
  }
  if (/xiaohongshu\.com|xhslink\.com/.test(url)) {
    return "xhs";
  }
  if (/twitter\.com|x\.com/.test(url)) {
    return "twitter";
  }
  if (/bilibili\.com/.test(url)) {
    return "bilibili";
  }
  if (/youtube\.com|youtu\.be/.test(url)) {
    return "youtube";
  }

  return null;
}

async function processJob(jobId) {
  const job = getJobById(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  console.log(`Processing job: ${job.job_id} (${job.source})`);

  // 更新状态为 pending
  updateJobStatus(jobId, "pending", {
    progress: {
      stage: "dispatching",
      percent: 5,
      message: `正在分发到 ${job.source} 抓取器`,
      updated_at: new Date().toISOString(),
    },
  });

  // 根据 source 调用不同的处理函数
  let result;
  switch (job.source) {
    case "tiktok":
      result = await processTikTokJob(job);
      break;
    case "xhs":
      result = await processXhsJob(job);
      break;
    case "twitter":
      result = await processTwitterJob(job);
      break;
    case "bilibili":
      result = await processBilibiliJob(job);
      break;
    case "youtube":
      result = await processYoutubeJob(job);
      break;
    default:
      throw new Error(`Unsupported source: ${job.source}`);
  }

  return result;
}

async function processTikTokJob(job) {
  // 尝试找到 pull-tiktok skill
  const possibleScriptPaths = [
    path.join(SKILLS_ROOT, "pull-tiktok", "scripts", "fetch_tiktok_video.js"),
    path.join(SKILL_DIR, "..", "pull-tiktok", "scripts", "fetch_tiktok_video.js"),
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    throw new Error("Cannot find pull-tiktok script");
  }

  const { fetchTikTokVideo } = require(scriptPath);
  return await fetchTikTokVideo(job.source_url, {
    job: job,
  });
}

async function processXhsJob(job) {
  // 尝试找到 pull-xhs skill
  const possibleScriptPaths = [
    path.join(SKILLS_ROOT, "pull-xhs", "scripts", "fetch_xhs_note.js"),
    path.join(SKILL_DIR, "..", "pull-xhs", "scripts", "fetch_xhs_note.js"),
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    throw new Error("Cannot find pull-xhs script");
  }

  const { fetchXhsNote } = require(scriptPath);
  return await fetchXhsNote(job.source_url, {
    job: job,
  });
}

async function processTwitterJob(job) {
  // 尝试找到 pull-Twitter skill
  const possibleScriptPaths = [
    path.join(SKILLS_ROOT, "pull-Twitter", "scripts", "fetch_twitter.js"),
    path.join(SKILL_DIR, "..", "pull-Twitter", "scripts", "fetch_twitter.js"),
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    throw new Error("Cannot find pull-Twitter script");
  }

  const { fetchTwitter } = require(scriptPath);
  return await fetchTwitter(job.source_url, {
    job: job,
  });
}

async function processBilibiliJob(job) {
  // 尝试找到 pull-bilibiliInfo skill
  const possibleScriptPaths = [
    path.join(SKILLS_ROOT, "pull-bilibiliInfo", "scripts", "fetch_bilibili.js"),
    path.join(SKILL_DIR, "..", "pull-bilibiliInfo", "scripts", "fetch_bilibili.js"),
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    throw new Error("Cannot find pull-bilibiliInfo script");
  }

  const { fetchBilibili } = require(scriptPath);
  return await fetchBilibili(job.source_url, {
    job: job,
  });
}

async function processYoutubeJob(job) {
  // 尝试找到 pull-youtubeInfo skill
  const possibleScriptPaths = [
    path.join(SKILLS_ROOT, "pull-youtubeInfo", "scripts", "fetch_youtube.js"),
    path.join(SKILL_DIR, "..", "pull-youtubeInfo", "scripts", "fetch_youtube.js"),
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    throw new Error("Cannot find pull-youtubeInfo script");
  }

  const { fetchYoutube } = require(scriptPath);
  return await fetchYoutube(job.source_url, {
    job: job,
  });
}

async function processPendingJobs() {
  const pendingJobs = getJobsByStatus("raw").concat(getJobsByStatus("pending"));

  if (pendingJobs.length === 0) {
    console.log("No pending jobs to process");
    return;
  }

  console.log(`\n=== Processing ${pendingJobs.length} pending jobs ===\n`);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pendingJobs.length; i++) {
    const job = pendingJobs[i];
    const jobIndex = i + 1;

    console.log(`[${jobIndex}/${pendingJobs.length}] Processing: ${job.job_id} (${job.source})`);

    try {
      const result = await processJob(job.job_id);
      results.push({ job_id: job.job_id, success: true, result });
      successCount++;
      console.log(`[${jobIndex}/${pendingJobs.length}] ✓ SUCCESS: ${job.job_id}\n`);
    } catch (error) {
      console.error(`[${jobIndex}/${pendingJobs.length}] ✗ FAILED: ${job.job_id} - ${error.message}\n`);
      results.push({ job_id: job.job_id, success: false, error: error.message });
      failCount++;
    }
  }

  console.log("\n=== Processing Summary ===");
  console.log(`Total: ${pendingJobs.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  return results;
}

// ========== CLI 解析 ==========

function parseArgs(argv) {
  const args = {
    command: null,
    _: [],
    options: {},
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      if (!args.command) {
        args.command = token;
      } else {
        args._.push(token);
      }
      i++;
      continue;
    }

    const nextValue = argv[i + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      args.options[token.slice(2)] = true;
      i++;
      continue;
    }

    args.options[token.slice(2)] = nextValue;
    i += 2;
  }

  return args;
}

function printHelp() {
  console.log(`
Info Grab Manager - 多平台内容抓取管理器

Usage:
  node skills/info-grab-manager/scripts/job_manager.js <command> [options]

Commands:
  clear                    清空所有下载内容
  clear-jobs               清空所有任务（保留下载内容）
  list [status]            列出所有任务（可选状态过滤：raw/pending/processed/translated/summarized/reported）
  add <url> [source]       添加新任务
  fetch <url> [source]     抓取任务，如已有则复用
  summarize <url|jobId> [source]  为已有任务生成总结文件
  fetch-and-summarize <url> [source]  抓取并轮询进度，完成后生成总结
  process [jobId]          处理任务（不指定 jobId 则处理所有 pending）
  process-all              处理所有待处理任务（同 process）
  help                     显示帮助

Examples:
  node skills/info-grab-manager/scripts/job_manager.js clear
  node skills/info-grab-manager/scripts/job_manager.js list
  node skills/info-grab-manager/scripts/job_manager.js list raw
  node skills/info-grab-manager/scripts/job_manager.js add "https://v.douyin.com/xxxx/"
  node skills/info-grab-manager/scripts/job_manager.js add "https://xhslink.com/xxxx/" xhs
  node skills/info-grab-manager/scripts/job_manager.js add "https://www.bilibili.com/video/BV1xx411c7mD" bilibili
  node skills/info-grab-manager/scripts/job_manager.js add "https://www.youtube.com/watch?v=dQw4w9WgXcQ" youtube
  node skills/info-grab-manager/scripts/job_manager.js fetch "https://www.bilibili.com/video/BV1xx411c7mD" bilibili
  node skills/info-grab-manager/scripts/job_manager.js summarize "https://www.bilibili.com/video/BV1xx411c7mD" bilibili
  node skills/info-grab-manager/scripts/job_manager.js fetch-and-summarize "https://www.bilibili.com/video/BV1xx411c7mD" bilibili
  node skills/info-grab-manager/scripts/job_manager.js process
  node skills/info-grab-manager/scripts/job_manager.js process-all
  node skills/info-grab-manager/scripts/job_manager.js process job_20260411_abc123

Supported platforms: tiktok, xhs, twitter, bilibili, youtube
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "clear":
      clearAllDownloads();
      break;

    case "clear-jobs":
      clearAllJobs();
      break;

    case "list":
      listJobs(args._?.[0]);
      break;

    case "add": {
      const inputText = args._?.[0];
      const source = args._?.[1] || args.options.source || null;
      if (!inputText) {
        console.error("Error: URL or input text is required for add command");
        printHelp();
        process.exit(1);
      }
      addJob(source, inputText);
      break;
    }

    case "fetch": {
      const inputText = args._?.[0];
      const source = args._?.[1] || args.options.source || null;
      if (!inputText) {
        console.error("Error: URL or input text is required for fetch command");
        printHelp();
        process.exit(1);
      }
      const result = fetchJob(source, inputText);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "summarize": {
      const inputText = args._?.[0];
      const source = args._?.[1] || args.options.source || null;
      if (!inputText) {
        console.error("Error: URL or jobId is required for summarize command");
        printHelp();
        process.exit(1);
      }
      const result = summarizeJob(inputText, source);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "fetch-and-summarize": {
      const inputText = args._?.[0];
      const source = args._?.[1] || args.options.source || null;
      if (!inputText) {
        console.error("Error: URL or input text is required for fetch-and-summarize command");
        printHelp();
        process.exit(1);
      }
      const result = await fetchAndSummarize(source, inputText, {
        timeoutMs: Number(args.options.timeoutMs || args.options["timeout-ms"] || 10 * 60 * 1000),
        pollIntervalMs: Number(args.options.pollIntervalMs || args.options["poll-interval-ms"] || 2000),
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 1;
      }
      break;
    }

    case "process":
    case "process-all": {
      const jobId = args._?.[0];
      if (jobId) {
        await processJob(jobId);
      } else {
        await processPendingJobs();
      }
      break;
    }

    case "help":
    default:
      printHelp();
      break;
  }
}

module.exports = {
  clearAllDownloads,
  clearAllJobs,
  listJobs,
  addJob,
  detectSourceType,
  processJob,
  processPendingJobs,
  processTikTokJob,
  processXhsJob,
  processTwitterJob,
  processBilibiliJob,
  processYoutubeJob,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
