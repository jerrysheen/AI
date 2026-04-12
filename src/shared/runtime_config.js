const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv();

function resolveEnvPath(name, fallbackRelativePath) {
  const value = process.env[name];
  if (value && String(value).trim()) {
    const normalized = String(value).trim();
    return path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(REPO_ROOT, normalized);
  }
  if (!fallbackRelativePath) {
    return "";
  }
  return path.resolve(REPO_ROOT, fallbackRelativePath);
}

function resolveEnvInteger(name, fallbackValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallbackValue;
}

function resolveEnvString(name, fallbackValue = "") {
  const value = process.env[name];
  if (value && String(value).trim()) {
    return String(value).trim();
  }
  return fallbackValue;
}

function getSharedDataDir() {
  return resolveEnvPath("AI_SHARED_DATA_DIR", ".ai-data");
}

function getChromeProfileDir() {
  return resolveEnvPath("AI_CHROME_PROFILE_DIR", path.join(".ai-data", "chrome-profile"));
}

function getChromeDebugPort() {
  return resolveEnvInteger("AI_CHROME_DEBUG_PORT", 9222);
}

function getChromeStartupDelayMs() {
  return resolveEnvInteger("AI_CHROME_STARTUP_DELAY_MS", 4000);
}

function getChromePath() {
  const explicit = process.env.AI_CHROME_PATH;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }

  const platform = os.platform();
  if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "google-chrome";
}

function getBilibiliRunsDir() {
  return path.join(getSharedDataDir(), "bilibili", "runs");
}

function getBilibiliCacheDir() {
  return path.join(getSharedDataDir(), "cache", "bilibili");
}

function getBilibiliAudioDir() {
  return path.join(getSharedDataDir(), "audio", "bilibili");
}

function getBilibiliAsrDir() {
  return path.join(getSharedDataDir(), "asr", "bilibili");
}

function getYtDlpCommand() {
  return resolveEnvString("AI_YTDLP_COMMAND", "python -m yt_dlp");
}

function getFfmpegLocation() {
  return resolveEnvPath("AI_FFMPEG_LOCATION", "");
}

function getWhisperPythonCommand() {
  return resolveEnvString("AI_WHISPER_PYTHON", "python");
}

function getDownloadsRootDir() {
  return resolveEnvPath("AI_DOWNLOADS_ROOT", "downloads");
}

function getDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDir(dirPath) {
  const fs = require("node:fs");
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getSourceDownloadDir(source, date = new Date()) {
  const dateStr = typeof date === "string" ? date : getDateStr(date);
  const dir = require("node:path").join(getDownloadsRootDir(), dateStr, source);
  return ensureDir(dir);
}

function getXhsDownloadDir(date = new Date()) {
  return getSourceDownloadDir("xhs", date);
}

function getTikTokDownloadDir(date = new Date()) {
  return getSourceDownloadDir("tiktok", date);
}

function getTwitterDownloadDir(date = new Date()) {
  return getSourceDownloadDir("twitter", date);
}

// ========== 全局任务清单 (daily_jobs.json) ==========

function getDailyJobsPath() {
  return path.join(getDownloadsRootDir(), "daily_jobs.json");
}

function loadOrCreateDailyJobs() {
  const jobsPath = getDailyJobsPath();
  ensureDir(getDownloadsRootDir());

  if (fs.existsSync(jobsPath)) {
    try {
      return JSON.parse(fs.readFileSync(jobsPath, "utf8"));
    } catch (e) {
      // 文件损坏，重建
    }
  }

  const today = getDateStr();
  return {
    current_date: today,
    jobs: [],
    statistics: {
      total: 0,
      by_content_type: {
        video_only: 0,
        images_only: 0,
        text_only: 0,
        mixed: 0,
      },
      by_status: {
        raw: 0,
        pending: 0,
        processed: 0,
        translated: 0,
        summarized: 0,
        reported: 0,
      },
    },
  };
}

function saveDailyJobs(jobsData) {
  const jobsPath = getDailyJobsPath();
  ensureDir(getDownloadsRootDir());
  fs.writeFileSync(jobsPath, JSON.stringify(jobsData, null, 2), "utf8");
  return jobsData;
}

function generateJobId() {
  const today = getDateStr().replace(/-/g, "");
  const random = Math.random().toString(36).substr(2, 6);
  return `job_${today}_${random}`;
}

function addJobToDailyJobs(jobInput) {
  const jobsData = loadOrCreateDailyJobs();
  const jobId = jobInput.job_id || generateJobId();
  const now = new Date().toISOString();

  const job = {
    job_id: jobId,
    source: jobInput.source,
    source_url: jobInput.source_url,
    title: jobInput.title || "",
    content_type: jobInput.content_type || {
      has_video: false,
      has_images: false,
      has_text: false,
    },
    status: jobInput.status || "pending",
    priority: jobInput.priority || "normal",
    created_at: now,
    updated_at: now,
    data_path: jobInput.data_path || null,
    index_ref: jobInput.index_ref || null,
    content_files: jobInput.content_files || {
      text: null,
      transcript: null,
      images: null,
      video: null,
    },
    tags: jobInput.tags || [],
    notes: jobInput.notes || "",
  };

  jobsData.jobs.push(job);
  jobsData.statistics.total = jobsData.jobs.length;
  _updateJobStatistics(jobsData);

  saveDailyJobs(jobsData);
  return job;
}

function updateJobStatus(jobId, status, extraData = {}) {
  const jobsData = loadOrCreateDailyJobs();
  const jobIndex = jobsData.jobs.findIndex((j) => j.job_id === jobId);

  if (jobIndex === -1) {
    return null;
  }

  const job = jobsData.jobs[jobIndex];
  const oldStatus = job.status;

  job.status = status;
  job.updated_at = new Date().toISOString();

  Object.assign(job, extraData);

  _updateJobStatistics(jobsData);
  saveDailyJobs(jobsData);
  return job;
}

function getJobsByStatus(status) {
  const jobsData = loadOrCreateDailyJobs();
  return jobsData.jobs.filter((j) => j.status === status);
}

function getJobById(jobId) {
  const jobsData = loadOrCreateDailyJobs();
  return jobsData.jobs.find((j) => j.job_id === jobId) || null;
}

function _updateJobStatistics(jobsData) {
  const stats = jobsData.statistics;

  // Reset counts
  stats.by_content_type = { video_only: 0, images_only: 0, text_only: 0, mixed: 0 };
  stats.by_status = { raw: 0, pending: 0, processed: 0, translated: 0, summarized: 0, reported: 0 };

  for (const job of jobsData.jobs) {
    // Count by status
    if (stats.by_status.hasOwnProperty(job.status)) {
      stats.by_status[job.status]++;
    }

    // Count by content type
    const ct = job.content_type;
    const typeCount = (ct.has_video ? 1 : 0) + (ct.has_images ? 1 : 0) + (ct.has_text ? 1 : 0);

    if (typeCount > 1) {
      stats.by_content_type.mixed++;
    } else if (ct.has_video) {
      stats.by_content_type.video_only++;
    } else if (ct.has_images) {
      stats.by_content_type.images_only++;
    } else if (ct.has_text) {
      stats.by_content_type.text_only++;
    }
  }
}

// ========== 任务时间线 (job_timeline.json) ==========

function getJobTimelinePath(date = new Date()) {
  const dateStr = typeof date === "string" ? date : getDateStr(date);
  return path.join(getDownloadsRootDir(), dateStr, "job_timeline.json");
}

function loadOrCreateJobTimeline(date = new Date()) {
  const timelinePath = getJobTimelinePath(date);
  const dateDir = path.dirname(timelinePath);
  ensureDir(dateDir);

  if (fs.existsSync(timelinePath)) {
    try {
      return JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    } catch (e) {
      // 文件损坏，重建
    }
  }

  const dateStr = typeof date === "string" ? date : getDateStr(date);
  return {
    date: dateStr,
    timeline: [],
    daily_summary_generated: false,
    daily_summary_path: null,
  };
}

function saveJobTimeline(timelineData, date = new Date()) {
  const timelinePath = getJobTimelinePath(date);
  const dateDir = path.dirname(timelinePath);
  ensureDir(dateDir);
  fs.writeFileSync(timelinePath, JSON.stringify(timelineData, null, 2), "utf8");
  return timelineData;
}

function addTimelineEvent(eventInput, date = new Date()) {
  const timelineData = loadOrCreateJobTimeline(date);

  const event = {
    timestamp: eventInput.timestamp || new Date().toISOString(),
    action: eventInput.action,
    job_id: eventInput.job_id || null,
    content_type: eventInput.content_type || null,
    details: eventInput.details || "",
  };

  timelineData.timeline.push(event);
  saveJobTimeline(timelineData, date);
  return event;
}

// ========== 平台索引 (index.json) ==========

function getPlatformIndexPath(source, date = new Date()) {
  const dateStr = typeof date === "string" ? date : getDateStr(date);
  return path.join(getDownloadsRootDir(), dateStr, source, "index.json");
}

function loadOrCreatePlatformIndex(source, date = new Date()) {
  const indexPath = getPlatformIndexPath(source, date);
  const indexDir = path.dirname(indexPath);
  ensureDir(indexDir);

  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch (e) {
      // 文件损坏，重建
    }
  }

  const dateStr = typeof date === "string" ? date : getDateStr(date);
  return {
    date: dateStr,
    platform: source,
    tasks: [],
    summary: {
      total_tasks: 0,
      by_content_type: { video: 0, images: 0, text: 0 },
      completed: 0,
      failed: 0,
    },
  };
}

function savePlatformIndex(source, indexData, date = new Date()) {
  const indexPath = getPlatformIndexPath(source, date);
  const indexDir = path.dirname(indexPath);
  ensureDir(indexDir);
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf8");
  return indexData;
}

function addTaskToPlatformIndex(source, taskInput, date = new Date()) {
  const indexData = loadOrCreatePlatformIndex(source, date);

  const task = {
    task_id: taskInput.task_id,
    job_id: taskInput.job_id || null,
    title: taskInput.title || "",
    author: taskInput.author || "",
    content_type: taskInput.content_type || {
      has_video: false,
      has_images: false,
      has_text: false,
    },
    status: taskInput.status || "pending",
    dir_path: taskInput.dir_path || "",
    created_at: taskInput.created_at || new Date().toISOString(),
    updated_at: taskInput.updated_at || new Date().toISOString(),
    files: taskInput.files || {
      metadata: null,
      content: null,
      transcript: null,
      translated: null,
      summary: null,
      images_dir: null,
      video_file: null,
    },
    media_kept: taskInput.media_kept || false,
    error: null,
  };

  indexData.tasks.push(task);
  indexData.summary.total_tasks = indexData.tasks.length;
  _updatePlatformIndexSummary(indexData);

  savePlatformIndex(source, indexData, date);
  return task;
}

function updateTaskInPlatformIndex(source, taskId, updates, date = new Date()) {
  const indexData = loadOrCreatePlatformIndex(source, date);
  const taskIndex = indexData.tasks.findIndex((t) => t.task_id === taskId);

  if (taskIndex === -1) {
    return null;
  }

  const task = indexData.tasks[taskIndex];
  Object.assign(task, updates);
  task.updated_at = new Date().toISOString();

  _updatePlatformIndexSummary(indexData);
  savePlatformIndex(source, indexData, date);
  return task;
}

function _updatePlatformIndexSummary(indexData) {
  const summary = indexData.summary;
  summary.by_content_type = { video: 0, images: 0, text: 0 };
  summary.completed = 0;
  summary.failed = 0;

  for (const task of indexData.tasks) {
    const ct = task.content_type;
    if (ct.has_video) summary.by_content_type.video++;
    if (ct.has_images) summary.by_content_type.images++;
    if (ct.has_text) summary.by_content_type.text++;

    if (task.status === "processed" || task.status === "summarized" || task.status === "reported") {
      summary.completed++;
    }
    if (task.error) {
      summary.failed++;
    }
  }
}

// ========== 内容类型帮助函数 ==========

function detectContentTypeFromData(data) {
  return {
    has_video: !!(data.video_urls && data.video_urls.length > 0),
    has_images: !!(data.image_urls && data.image_urls.length > 0),
    has_text: !!(data.content || data.title),
  };
}

// ========== 目录/路径工具 ==========

function sanitizeDirName(title, id) {
  // 移除或替换文件名非法字符
  let cleanTitle = (title || "untitled")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80); // 限制长度

  // 如果清理后为空，使用 id
  if (!cleanTitle) {
    cleanTitle = "untitled";
  }

  return `${cleanTitle}-${id}`;
}

function getTaskItemDir(source, title, id, date = new Date()) {
  const sourceDir = getSourceDownloadDir(source, date);
  const dirName = sanitizeDirName(title, id);
  return path.join(sourceDir, dirName);
}

function getTaskImagesDir(source, title, id, date = new Date()) {
  const taskDir = getTaskItemDir(source, title, id, date);
  return path.join(taskDir, "images");
}

function getDailyReportPath(date = new Date()) {
  const dateStr = typeof date === "string" ? date : getDateStr(date);
  return path.join(getDownloadsRootDir(), dateStr, "daily_report.md");
}

function ensureTaskDirs(source, title, id, date = new Date()) {
  const taskDir = getTaskItemDir(source, title, id, date);
  const imagesDir = getTaskImagesDir(source, title, id, date);

  ensureDir(taskDir);
  ensureDir(imagesDir);

  return {
    task_dir: taskDir,
    images_dir: imagesDir,
  };
}

module.exports = {
  REPO_ROOT,
  getBilibiliAudioDir,
  getBilibiliAsrDir,
  getBilibiliCacheDir,
  getBilibiliRunsDir,
  getChromeDebugPort,
  getChromePath,
  getChromeProfileDir,
  getChromeStartupDelayMs,
  getFfmpegLocation,
  getSharedDataDir,
  getWhisperPythonCommand,
  getYtDlpCommand,
  // 新增统一下载目录
  getDownloadsRootDir,
  getDateStr,
  ensureDir,
  getSourceDownloadDir,
  getXhsDownloadDir,
  getTikTokDownloadDir,
  getTwitterDownloadDir,
  // ========== 新增：任务管理 ==========
  // daily_jobs.json
  getDailyJobsPath,
  loadOrCreateDailyJobs,
  saveDailyJobs,
  generateJobId,
  addJobToDailyJobs,
  updateJobStatus,
  getJobsByStatus,
  getJobById,
  // job_timeline.json
  getJobTimelinePath,
  loadOrCreateJobTimeline,
  saveJobTimeline,
  addTimelineEvent,
  // platform index.json
  getPlatformIndexPath,
  loadOrCreatePlatformIndex,
  savePlatformIndex,
  addTaskToPlatformIndex,
  updateTaskInPlatformIndex,
  // 内容类型
  detectContentTypeFromData,
  // 目录工具
  sanitizeDirName,
  getTaskItemDir,
  getTaskImagesDir,
  getDailyReportPath,
  ensureTaskDirs,
};
