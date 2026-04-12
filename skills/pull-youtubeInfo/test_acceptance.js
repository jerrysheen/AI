#!/usr/bin/env node
/**
 * pull-youtubeInfo 验收测试脚本 - 必须全部通过才算任务完成
 * 运行：node test_acceptance.js
 *
 * 验收标准（来自Task.md）:
 * - 测试用例: 有字幕视频，验证字幕获取
 * - 验收: Metadata获取成功；有字幕则保存字幕；无字幕则按空结果正常完成
 */

const fs = require("node:fs");
const path = require("node:path");

const colors = {
  pass: "\x1b[32m✓\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
};

// 测试配置 - 使用已有的下载文件进行验证
const TEST_CONFIG = {
  // 默认使用最新的下载目录
  getLatestTestDir: () => {
    const downloadsRoot = path.join("/Users/jerry/Desktop/AI/downloads");
    const dates = fs.readdirSync(downloadsRoot).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
    dates.sort().reverse();
    for (const date of dates) {
      const youtubeDir = path.join(downloadsRoot, date, "youtube");
      if (fs.existsSync(youtubeDir)) {
        const subdirs = fs.readdirSync(youtubeDir).filter(f => !f.endsWith(".json"));
        if (subdirs.length > 0) {
          return path.join(youtubeDir, subdirs[0]);
        }
      }
    }
    return null;
  },
};

// 验证单个YouTube视频目录
function validateYoutubeDir(dir) {
  const prefix = "[YouTube视频]";

  // 检查目录存在
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`${prefix} 目录不存在，请先运行一次抓取: node scripts/fetch_youtube.js <YouTube链接>`);
  }

  console.log(`    ${colors.info} 验证目录: ${dir}`);

  // 检查文件
  const files = fs.readdirSync(dir);

  // 检查 metadata 文件
  const metadataFile = files.find((f) => f === "metadata.json");
  if (!metadataFile) {
    throw new Error(`${prefix} metadata 文件不存在 (metadata.json)`);
  }
  const metadataPath = path.join(dir, metadataFile);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (!metadata.id || !metadata.title) {
    throw new Error(`${prefix} metadata 缺少必需字段: id 或 title`);
  }
  console.log(`    ${colors.info} 视频标题: ${metadata.title}`);

  // 检查 content.txt
  const contentFile = files.find((f) => f === "content.txt");
  if (!contentFile) {
    throw new Error(`${prefix} content.txt 不存在`);
  }
  const contentPath = path.join(dir, contentFile);
  const content = fs.readFileSync(contentPath, "utf8");
  if (!content || content.trim().length === 0) {
    throw new Error(`${prefix} content.txt 为空`);
  }

  const transcriptFile = files.find((f) => f === "transcript.txt");
  if (transcriptFile) {
    const transcriptPath = path.join(dir, transcriptFile);
    const transcript = fs.readFileSync(transcriptPath, "utf8");
    if (!transcript || transcript.trim().length === 0) {
      throw new Error(`${prefix} transcript.txt 为空`);
    }
    console.log(`    ${colors.info} 字幕已保存 (${transcript.trim().length} 字符)`);
  } else {
    console.log(`    ${colors.info} 无字幕文件，按空结果正常完成`);
  }

  return true;
}

const tests = [
  {
    name: "主函数模块能正常导入",
    fn: async () => {
      const scriptPath = path.join(__dirname, "scripts/fetch_youtube.js");
      if (!fs.existsSync(scriptPath)) {
        throw new Error("fetch_youtube.js 不存在");
      }
      // 尝试导入，不要求导出特定函数，只要不崩溃即可
      require(scriptPath);
      return true;
    },
  },
  {
    name: "能从输入中提取 YouTube 视频ID",
    fn: async () => {
      const { extractYoutubeVideoId } = require("./scripts/fetch_youtube");
      const testCases = [
        {
          input: "https://www.youtube.com/watch?v=AXrmMo3GzT0",
          expected: "AXrmMo3GzT0",
        },
        {
          input: "https://youtu.be/AXrmMo3GzT0",
          expected: "AXrmMo3GzT0",
        },
      ];

      for (const tc of testCases) {
        const result = extractYoutubeVideoId(tc.input);
        if (result !== tc.expected) {
          throw new Error(`视频ID提取错误: 期望 ${tc.expected}, 实际 ${result}`);
        }
      }
      return true;
    },
  },
  {
    name: "fetch_youtube_subtitle 模块能正常导入",
    fn: async () => {
      const { fetchYouTubeSubtitle } = require("./scripts/fetch_youtube_subtitle");
      if (typeof fetchYouTubeSubtitle !== "function") {
        throw new Error("fetchYouTubeSubtitle 不是函数");
      }
      return true;
    },
  },
  {
    name: "runtime_shim 模块能正常导入",
    fn: async () => {
      const shim = require("./scripts/runtime_shim");
      const requiredExports = [
        "ensureDir",
        "getTaskItemDir",
        "addJobToDailyJobs",
        "updateJobStatus",
      ];
      for (const name of requiredExports) {
        if (!(name in shim)) {
          throw new Error(`runtime_shim 缺少必需导出: ${name}`);
        }
      }
      return true;
    },
  },
  {
    name: "YouTube视频目录验证通过（允许无字幕空结果）",
    fn: async () => {
      const testDir = TEST_CONFIG.getLatestTestDir();
      return validateYoutubeDir(testDir);
    },
  },
];

async function main() {
  let passed = 0;
  let failed = 0;

  console.log("\n=== pull-youtubeInfo 验收测试开始 ===\n");
  console.log("  验收标准: Metadata获取成功；有字幕则保存字幕；无字幕则按空结果正常完成\n");

  for (const test of tests) {
    try {
      process.stdout.write(`  ${test.name} ... `);
      await test.fn();
      console.log(`${colors.pass} 通过`);
      passed++;
    } catch (error) {
      console.log(`${colors.fail} 失败`);
      console.log(`    错误: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n=== 结果: ${passed}/${tests.length} 通过 ===\n`);

  if (failed > 0) {
    console.log("❌ 验收未通过，请修复后重试");
    process.exit(1);
  } else {
    console.log("✅ 验收全部通过！");
    console.log(`\n${colors.info} 验收项全部通过:`);
    console.log(`   ✓ Metadata 获取成功`);
    console.log(`   ✓ 字幕检测逻辑正常`);
    console.log(`   ✓ 无字幕时按空结果正常收口`);
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("验收脚本执行出错:", err);
    process.exit(1);
  });
}

module.exports = { tests };
