const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const jobManager = require("../scripts/job_manager");
const runtimeConfig = require("../../../src/shared/runtime_config");

function spawnProcess(jobId) {
  const scriptPath = path.resolve(__dirname, "..", "scripts", "job_manager.js");
  const child = spawn(process.execPath, [scriptPath, "process", jobId], {
    cwd: path.resolve(__dirname, "..", "..", ".."),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function startJob(input, source = null, title = "") {
  const job = jobManager.addJob(source, input, title);
  spawnProcess(job.job_id);
  return {
    ok: true,
    job_id: job.job_id,
    source: job.source,
    source_url: job.source_url,
    status: job.status,
    progress: job.progress || {
      stage: "queued",
      percent: 0,
      message: "任务已创建，等待处理",
      updated_at: new Date().toISOString(),
    },
  };
}

function normalizeInput(value) {
  return String(value || "").trim();
}

function findExistingJob(input, source = null) {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput) {
    return null;
  }

  const jobsData = runtimeConfig.loadOrCreateDailyJobs();
  const sourceType = source ? jobManager.detectSourceType(source, normalizedInput) : jobManager.detectSourceType(normalizedInput, normalizedInput);
  const jobs = [...jobsData.jobs].reverse();

  return jobs.find((job) => {
    if (sourceType && job.source !== sourceType) {
      return false;
    }
    return normalizeInput(job.source_url) === normalizedInput;
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
  const hasMetadata = fs.existsSync(path.join(taskDir, "metadata.json"));
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

  return runtimeConfig.updateJobStatus(job.job_id, nextStatus, {
    content_files: mergedFiles,
    content_type: nextContentType,
    notes: hasMetadata || hasSummary ? job.notes || "" : job.notes || "",
  });
}

function getJobStatus(jobId) {
  const job = reconcileJobArtifacts(runtimeConfig.getJobById(jobId));
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

function ensureJobProcessing(job) {
  if (!job) {
    throw new Error("Job is required.");
  }

  if (job.status === "raw" || job.status === "pending") {
    spawnProcess(job.job_id);
  }

  return getJobStatus(job.job_id);
}

function waitForJob(jobId, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10 * 60 * 1000);
  const pollIntervalMs = Number(options.pollIntervalMs || 2000);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const status = getJobStatus(jobId);
      if (!status) {
        clearInterval(timer);
        reject(new Error(`Job not found: ${jobId}`));
        return;
      }
      if (status.is_terminal) {
        clearInterval(timer);
        resolve(status);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out while waiting for job: ${jobId}`));
      }
    }, pollIntervalMs);
  });
}

function resolveJobTaskDir(job) {
  if (!job?.data_path) {
    return null;
  }
  const jobDate = runtimeConfig.getDateStr(new Date(job.created_at || Date.now()));
  return path.join(runtimeConfig.getDownloadsRootDir(), jobDate, job.data_path);
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
    status: job.status,
    title,
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

function summarizeJob(inputOrJobId, source = null) {
  let job = null;
  const normalized = normalizeInput(inputOrJobId);
  if (normalized.startsWith("job_")) {
    job = runtimeConfig.getJobById(normalized);
  } else {
    job = findExistingJob(normalized, source);
  }

  if (!job) {
    throw new Error(`No existing job found for: ${inputOrJobId}`);
  }

  return buildSummaryArtifacts(job);
}

async function fetchJob(input, source = null, options = {}) {
  const existing = findExistingJob(input, source);
  if (!existing) {
    return startJob(input, source, options.title || "");
  }

  const status = ensureJobProcessing(existing);
  return {
    ok: true,
    job_id: existing.job_id,
    source: existing.source,
    source_url: existing.source_url,
    reused_existing_job: true,
    status: status?.status || existing.status,
    progress: status?.progress || existing.progress || null,
  };
}

async function fetchAndSummarize(input, source = null, options = {}) {
  const started = await fetchJob(input, source, options);
  const finalStatus = started.status === "processed" || started.status === "failed"
    ? getJobStatus(started.job_id)
    : await waitForJob(started.job_id, options);

  if (finalStatus.status !== "processed") {
    return {
      ok: false,
      job_id: started.job_id,
      status: finalStatus.status,
      progress: finalStatus.progress || null,
      notes: finalStatus.notes || "",
    };
  }

  return buildSummaryArtifacts(runtimeConfig.getJobById(started.job_id));
}

module.exports = {
  // 导出所有功能
  ...jobManager,

  // 便捷方法
  addJob: jobManager.addJob,
  listJobs: jobManager.listJobs,
  processJob: jobManager.processJob,
  processPendingJobs: jobManager.processPendingJobs,
  clearAllDownloads: jobManager.clearAllDownloads,
  clearAllJobs: jobManager.clearAllJobs,
  startJob,
  fetchJob,
  getJobStatus,
  waitForJob,
  summarizeJob,
  fetchAndSummarize,
};
