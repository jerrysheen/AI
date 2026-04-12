// Job Manager API Entrypoint
const path = require("node:path");

const jobManager = require("../scripts/job_manager");

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
};
