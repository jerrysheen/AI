const {
  loadOrCreateDailyJobs,
  addJobToDailyJobs,
  updateJobStatus,
  addTimelineEvent,
  loadOrCreatePlatformIndex,
  addTaskToPlatformIndex,
  getTaskItemDir,
  ensureTaskDirs,
} = require("../src/shared/runtime_config");

console.log("=== 测试任务管理系统 ===\n");

// 测试 1: 创建 daily_jobs.json
console.log("1. 测试 daily_jobs.json...");
const jobsData = loadOrCreateDailyJobs();
console.log("   ✓ 加载/创建成功");
console.log("   当前任务数:", jobsData.jobs.length);

// 测试 2: 添加一个任务
console.log("\n2. 添加测试任务...");
const testJob = addJobToDailyJobs({
  source: "test",
  source_url: "https://example.com/test",
  title: "测试任务",
  content_type: { has_video: true, has_images: false, has_text: true },
  status: "pending",
});
console.log("   ✓ 任务添加成功, job_id:", testJob.job_id);

// 测试 3: 更新任务状态
console.log("\n3. 更新任务状态...");
const updatedJob = updateJobStatus(testJob.job_id, "processed", {
  data_path: "./test/test-task-123",
});
console.log("   ✓ 状态更新为:", updatedJob.status);

// 测试 4: 添加时间线事件
console.log("\n4. 添加时间线事件...");
addTimelineEvent({
  action: "processed",
  job_id: testJob.job_id,
  details: "测试任务完成",
});
console.log("   ✓ 时间线事件添加成功");

// 测试 5: 平台索引
console.log("\n5. 测试平台索引...");
const platformIndex = loadOrCreatePlatformIndex("test");
console.log("   ✓ 平台索引加载/创建成功");

addTaskToPlatformIndex("test", {
  task_id: "test-123",
  job_id: testJob.job_id,
  title: "测试平台任务",
  content_type: { has_video: true, has_images: false, has_text: true },
  status: "processed",
  dir_path: "./test-task-123",
});
console.log("   ✓ 平台任务添加成功");

// 测试 6: 目录创建
console.log("\n6. 测试目录创建...");
const dirs = ensureTaskDirs("test", "测试目录", "test-123");
console.log("   ✓ 目录创建成功:");
console.log("     task_dir:", dirs.task_dir);
console.log("     images_dir:", dirs.images_dir);

console.log("\n=== 测试完成！===");
