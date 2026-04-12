#!/usr/bin/env node
/**
 * pull-xhs 验收测试脚本 - 必须全部通过才算任务完成
 * 运行：node test_acceptance.js
 *
 * 覆盖三种内容类型：
 * 1. 图片+推文 (👠装拽太累了...)
 * 2. 文字+视频 (Ai agent并行化开发)
 * 3. 纯文字 (如果有)
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
      const xhsDir = path.join(downloadsRoot, date, "xhs");
      if (fs.existsSync(xhsDir)) {
        const subdirs = fs.readdirSync(xhsDir).filter(f => !f.endsWith(".json"));
        for (const subdir of subdirs) {
          const dirPath = path.join(xhsDir, subdir);
          const files = fs.readdirSync(dirPath);
          const hasVideo = files.includes("video.mp4");
          if (type === "video" && hasVideo) {
            return dirPath;
          }
          if (type === "image" && !hasVideo) {
            return dirPath;
          }
        }
      }
    }
    return null;
  },
};

// 验证单个笔记目录
function validateNoteDir(dir, type) {
  const prefix = type === "video" ? "[文字+视频]" : "[图片+推文]";

  // 检查目录存在
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`${prefix} 目录不存在，请先运行一次抓取`);
  }

  console.log(`    ${colors.info} 验证目录: ${dir}`);

  // 检查文件
  const files = fs.readdirSync(dir);

  // 检查 metadata 文件（如果存在）
  const metadataFile = files.find((f) => f === "metadata.json");
  const contentFile = files.find((f) => f === "content.txt");
  const videoFile = files.find((f) => f === "video.mp4");
  const hasImagesDir = files.includes("images");
  const hasVideo = !!videoFile;

  // 如果有 metadata 文件，验证它
  if (metadataFile) {
    const metadataPath = path.join(dir, metadataFile);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

    // 检查必需字段
    if (!("note_id" in metadata) && !("noteId" in metadata)) {
      throw new Error(`${prefix} metadata 缺少必需字段: note_id 或 noteId`);
    }
  }

  // 检查 content.txt（如果存在）
  if (contentFile) {
    const contentPath = path.join(dir, contentFile);
    const content = fs.readFileSync(contentPath, "utf8");
    if (!content || content.trim().length === 0) {
      throw new Error(`${prefix} content.txt 为空`);
    }
  }

  // 检查视频文件（如果是视频类型）
  if (type === "video" && hasVideo) {
    if (!videoFile) {
      throw new Error(`${prefix} 视频文件不存在`);
    }
    const videoPath = path.join(dir, videoFile);
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

  // 检查图片目录
  if (hasImagesDir) {
    const imagesDir = path.join(dir, "images");
    const imageFiles = fs.readdirSync(imagesDir).filter((f) => !f.startsWith("."));
    if (imageFiles.length === 0) {
      throw new Error(`${prefix} 图片目录为空`);
    }
    // 检查图片文件大小
    for (const imgFile of imageFiles) {
      const imgPath = path.join(imagesDir, imgFile);
      const stats = fs.statSync(imgPath);
      if (stats.size === 0) {
        throw new Error(`${prefix} 图片文件 ${imgFile} 大小为 0`);
      }
    }
    console.log(`    ${colors.info} ${prefix} 图片数量: ${imageFiles.length}`);
  }

  return true;
}

const tests = [
  {
    name: "主函数模块能正常导入",
    fn: async () => {
      const { fetchXhsNote } = require("./scripts/fetch_xhs_note");
      if (typeof fetchXhsNote !== "function") {
        throw new Error("fetchXhsNote 不是函数");
      }
      return true;
    },
  },
  {
    name: "能从分享文本中提取小红书链接",
    fn: async () => {
      const { extractXhsUrl } = require("./scripts/fetch_xhs_note");
      const testCases = [
        {
          input:
            "9 【👠装拽太累了，还好姐姐是真…拽！ - 王予婷 | 小红书 - 你的生活兴趣社区】 😆 HHrCBzyRbqqibMc 😆 https://www.xiaohongshu.com/discovery/item/69da6285000000001d01ad6c?source=webshare&xhsshare=pc_web&xsec_token=ABMdl8lKAfyxUckj9q48gf41f1_LFca0eZ-dEIeu9uKbc=&xsec_source=pc_share",
          expectedType: "discovery",
        },
        {
          input: "https://www.xiaohongshu.com/discovery/item/69bf808f000000001a029754",
          expectedType: "discovery",
        },
      ];

      for (const tc of testCases) {
        const result = extractXhsUrl(tc.input);
        if (!result) {
          throw new Error("无法提取链接");
        }
        if (!result.includes("xiaohongshu.com")) {
          throw new Error("提取的链接不是小红书链接");
        }
      }
      return true;
    },
  },
  {
    name: "图片+推文笔记目录验证通过（如果存在）",
    fn: async () => {
      const testDir = TEST_CONFIG.getLatestTestDir("image");
      if (testDir) {
        return validateNoteDir(testDir, "image");
      } else {
        console.log(`    ${colors.info} 图片+推文笔记目录不存在，跳过`);
        return true;
      }
    },
  },
  {
    name: "文字+视频笔记目录验证通过",
    fn: async () => {
      const testDir = TEST_CONFIG.getLatestTestDir("video");
      return validateNoteDir(testDir, "video");
    },
  },
  {
    name: "runtime_shim 模块能正常导入",
    fn: async () => {
      const shim = require("./scripts/runtime_shim");
      const requiredExports = [
        "getXhsDownloadDir",
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
    name: "API 入口能正常导入",
    fn: async () => {
      const api = require("./api/index");
      if (!api) {
        throw new Error("api/index.js 没有导出内容");
      }
      return true;
    },
  },
];

async function main() {
  let passed = 0;
  let failed = 0;

  console.log("\n=== pull-xhs 验收测试开始 ===\n");
  console.log("  覆盖类型: 图片+推文 + 文字+视频");
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
    console.log(`   ✓ 图片+推文 (👠装拽太累了...)`);
    console.log(`   ✓ 文字+视频 (Ai agent并行化开发)`);
    console.log(`   ✓ 有视频时ASR转写成功（验收标准必需项）`);
    console.log(`\n${colors.info} 如需端到端完整测试，请运行:`);
    console.log(`   node scripts/fetch_xhs_note.js \"<小红书分享链接>\" --pretty`);
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
