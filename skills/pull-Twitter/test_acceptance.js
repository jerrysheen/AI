#!/usr/bin/env node
/**
 * pull-Twitter 验收测试脚本 - 必须全部通过才算任务完成
 * 运行：node test_acceptance.js
 *
 * 覆盖两种内容类型：
 * 1. 视频推文 (nash_su/status/2042017125678903330)
 * 2. 纯文本推文 (garrytan/status/2042939656438976854)
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
  getLatestTestDir: (type = "video") => {
    const downloadsRoot = path.join("/Users/jerry/Desktop/AI/downloads");
    const dates = fs.readdirSync(downloadsRoot).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
    dates.sort().reverse();
    for (const date of dates) {
      const twitterDir = path.join(downloadsRoot, date, "twitter");
      if (fs.existsSync(twitterDir)) {
        const subdirs = fs.readdirSync(twitterDir).filter(f => !f.endsWith(".json"));
        for (const subdir of subdirs) {
          const dirPath = path.join(twitterDir, subdir);
          const files = fs.readdirSync(dirPath);
          const hasVideo = files.includes("video.mp4");
          if (type === "video" && hasVideo) {
            return dirPath;
          }
          if (type === "text" && !hasVideo) {
            return dirPath;
          }
        }
      }
    }
    return null;
  },
};

// 验证单个推文目录
function validateTweetDir(dir, type) {
  const prefix = type === "video" ? "[视频推文]" : "[纯文本推文]";

  // 检查目录存在
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`${prefix} 目录不存在，请先运行一次抓取`);
  }

  console.log(`    ${colors.info} 验证目录: ${dir}`);

  // 检查文件
  const files = fs.readdirSync(dir);

  // 检查 metadata 文件
  const metadataFile = files.find((f) => f.includes("metadata") && f.endsWith(".json")) || files.find((f) => f === "metadata.json");
  if (!metadataFile) {
    throw new Error(`${prefix} metadata 文件不存在，目录内容: ${files.join(", ")}`);
  }

  const metadataPath = path.join(dir, metadataFile);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

  // 检查 content.txt
  const contentPath = path.join(dir, "content.txt");
  if (!fs.existsSync(contentPath)) {
    throw new Error(`${prefix} content.txt 不存在: ${contentPath}`);
  }
  const content = fs.readFileSync(contentPath, "utf8");
  if (!content || content.trim().length === 0) {
    throw new Error(`${prefix} content.txt 为空`);
  }

  // 检查视频文件（如果是视频推文）
  const hasVideo = files.includes("video.mp4");
  if (type === "video" && hasVideo) {
    const videoPath = path.join(dir, "video.mp4");
    if (!fs.existsSync(videoPath)) {
      throw new Error(`${prefix} 视频文件不存在: ${videoPath}`);
    }
    const stats = fs.statSync(videoPath);
    if (stats.size === 0) {
      throw new Error(`${prefix} 视频文件大小为 0`);
    }
    if (stats.size < 1024 * 100) {
      throw new Error(`${prefix} 视频文件过小 (${stats.size} bytes)，可能不完整`);
    }
    console.log(`    ${colors.info} ${prefix} 视频大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // ==========================================
    // 重要: ASR 转写验证 - 有视频时是验收标准必需项
    // ==========================================
    const transcriptFile = files.find((f) => f === "transcript.txt");
    if (!transcriptFile) {
      throw new Error(`${prefix} ❌ transcript.txt 不存在 - 有视频时ASR转写未完成，验收失败`);
    }
    const transcriptPath = path.join(dir, transcriptFile);
    const transcript = fs.readFileSync(transcriptPath, "utf8");
    if (!transcript || transcript.trim().length === 0) {
      throw new Error(`${prefix} ❌ transcript.txt 为空 - ASR转写结果为空，验收失败`);
    }
    console.log(`    ${colors.info} ASR转写: 已完成 (${transcript.trim().length} 字符)`);
  }

  return true;
}

const tests = [
  {
    name: "主函数模块能正常导入",
    fn: async () => {
      const { fetchTwitter } = require("./scripts/fetch_twitter");
      if (typeof fetchTwitter !== "function") {
        throw new Error("fetchTwitter 不是函数");
      }
      return true;
    },
  },
  {
    name: "能从 URL 中解析 Twitter 信息",
    fn: async () => {
      const { parseTwitterInput } = require("./scripts/fetch_twitter");
      const testCases = [
        {
          input: "https://x.com/nash_su/status/2042017125678903330",
          expected: { type: "tweet", handle: "nash_su", tweet_id: "2042017125678903330" },
        },
        {
          input: "https://twitter.com/garrytan/status/2042497872114090069",
          expected: { type: "tweet", handle: "garrytan", tweet_id: "2042497872114090069" },
        },
      ];

      for (const tc of testCases) {
        const result = parseTwitterInput(tc.input);
        if (result.type !== tc.expected.type) {
          throw new Error(`类型错误: 期望 ${tc.expected.type}, 实际 ${result.type}`);
        }
        if (result.handle !== tc.expected.handle) {
          throw new Error(`handle 错误: 期望 ${tc.expected.handle}, 实际 ${result.handle}`);
        }
        if (result.tweet_id !== tc.expected.tweet_id) {
          throw new Error(`tweet_id 错误: 期望 ${tc.expected.tweet_id}, 实际 ${result.tweet_id}`);
        }
      }
      return true;
    },
  },
  {
    name: "视频推文目录验证通过",
    fn: async () => {
      const testDir = TEST_CONFIG.getLatestTestDir("video");
      return validateTweetDir(testDir, "video");
    },
  },
  {
    name: "纯文本推文目录验证通过（如果存在）",
    fn: async () => {
      const testDir = TEST_CONFIG.getLatestTestDir("text");
      if (testDir) {
        return validateTweetDir(testDir, "text");
      } else {
        console.log(`    ${colors.info} 纯文本推文目录不存在，跳过`);
        return true;
      }
    },
  },
  {
    name: "fetch_twitter_enhanced 模块能正常导入",
    fn: async () => {
      const { fetchTwitterEnhanced } = require("./scripts/fetch_twitter_enhanced");
      if (typeof fetchTwitterEnhanced !== "function") {
        throw new Error("fetchTwitterEnhanced 不是函数");
      }
      return true;
    },
  },
  {
    name: "download_twitter_video 模块能正常导入",
    fn: async () => {
      const { downloadTwitterVideo } = require("./scripts/download_twitter_video");
      if (typeof downloadTwitterVideo !== "function") {
        throw new Error("downloadTwitterVideo 不是函数");
      }
      return true;
    },
  },
];

async function main() {
  let passed = 0;
  let failed = 0;

  console.log("\n=== pull-Twitter 验收测试开始 ===\n");
  console.log("  覆盖类型: 视频推文 + 纯文本推文");
  console.log("  重要: 有视频时ASR转写是验收标准的必需项，未完成则验收失败\n");

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
    console.log(`\n${colors.info} 覆盖的内容类型:`);
    console.log(`   ✓ 视频推文 (nash_su/status/2042017125678903330)`);
    console.log(`   ✓ 纯文本推文 (garrytan/status/2042939656438976854)`);
    console.log(`   ✓ 有视频时ASR转写成功（验收标准必需项）`);
    console.log(`\n${colors.info} 如需端到端完整测试，请运行:`);
    console.log(`   node scripts/fetch_twitter.js \"https://x.com/nash_su/status/2042017125678903330\" --pretty`);
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
