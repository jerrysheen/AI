#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const {
  REPO_ROOT,
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
} = require("./runtime_config");

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

function listJobs(status = null) {
  const jobsData = loadOrCreateDailyJobs();

  if (jobsData.jobs.length === 0) {
    console.log("No jobs found");
    return;
  }

  let jobs = jobsData.jobs;
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
  updateJobStatus(jobId, "pending");

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
    default:
      throw new Error(`Unsupported source: ${job.source}`);
  }

  return result;
}

async function processTikTokJob(job) {
  const { fetchTikTokVideo } = require("../../skills/pull-tiktok/scripts/fetch_tiktok_video");
  return await fetchTikTokVideo(job.source_url, {
    job: job,
  });
}

async function processXhsJob(job) {
  const { fetchXhsNote } = require("../../skills/pull-xhs/scripts/fetch_xhs_note");
  return await fetchXhsNote(job.source_url, {
    job: job,
  });
}

async function processTwitterJob(job) {
  // TODO: 实现 Twitter 处理
  throw new Error("Twitter processing not implemented yet");
}

async function processPendingJobs() {
  const pendingJobs = getJobsByStatus("raw").concat(getJobsByStatus("pending"));

  if (pendingJobs.length === 0) {
    console.log("No pending jobs to process");
    return;
  }

  console.log(`Found ${pendingJobs.length} pending jobs`);

  const results = [];
  for (const job of pendingJobs) {
    try {
      const result = await processJob(job.job_id);
      results.push({ job_id: job.job_id, success: true, result });
    } catch (error) {
      console.error(`Failed to process job ${job.job_id}:`, error.message);
      results.push({ job_id: job.job_id, success: false, error: error.message });
    }
  }

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
        // 收集额外参数 - 对于 add 命令，把剩余所有参数都当作 URL
        args._.push(argv.slice(i).join(" "));
        break;
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
Job Manager - 任务管理总控脚本

Usage:
  node src/shared/job_manager.js <command> [options]

Commands:
  clear                    清空所有下载内容
  list [status]            列出所有任务（可选状态过滤：raw/pending/processed/translated/summarized/reported）
  add <url> [source]       添加新任务
  process [jobId]          处理任务（不指定 jobId 则处理所有 pending）
  help                     显示帮助

Examples:
  node src/shared/job_manager.js clear
  node src/shared/job_manager.js list
  node src/shared/job_manager.js list pending
  node src/shared/job_manager.js add "https://v.douyin.com/xxxx/"
  node src/shared/job_manager.js add "https://xhslink.com/xxxx/" xhs
  node src/shared/job_manager.js process
  node src/shared/job_manager.js process job_20260411_abc123
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "clear":
      clearAllDownloads();
      break;

    case "list":
      listJobs(args._?.[0]);
      break;

    case "add": {
      const inputText = args._?.[0];
      const source = args.options.source || null;
      if (!inputText) {
        console.error("Error: URL or input text is required for add command");
        printHelp();
        process.exit(1);
      }
      addJob(source, inputText);
      break;
    }

    case "process": {
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
  listJobs,
  addJob,
  detectSourceType,
  processJob,
  processPendingJobs,
  processTikTokJob,
  processXhsJob,
  processTwitterJob,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
