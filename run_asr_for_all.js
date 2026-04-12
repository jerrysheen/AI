#!/usr/bin/env node
/**
 * 为所有已有视频的平台运行ASR转写
 */

const fs = require("node:fs");
const path = require("node:path");
const { transcribeVideo } = require("./src/shared/video_transcriber");

const videos = [
  {
    platform: "bilibili",
    path: "/Users/jerry/Desktop/AI/downloads/2026-04-12/bilibili/BV1Ca411W7v9-BV1Ca411W7v9/video.mp4",
  },
  {
    platform: "tiktok",
    path: "/Users/jerry/Desktop/AI/downloads/2026-04-12/tiktok/全球美食探索（上集）：世界各国的代表性早餐，哪个国家的最好吃#美食-7614044691718725046/video.mp4",
  },
  {
    platform: "twitter",
    path: "/Users/jerry/Desktop/AI/downloads/2026-04-12/twitter/开源啦🎉🎉🎉 基于 @karpathy 的 llm-wiki 方法论，我将其从抽象设计模式-2042017125678903330/video.mp4",
  },
  {
    platform: "xhs",
    path: "/Users/jerry/Desktop/AI/downloads/2026-04-12/xhs/Ai agent并行化开发-69bf808f000000001a029754/video.mp4",
  },
];

async function main() {
  console.log("开始为所有平台运行ASR转写...\n");

  const results = [];

  for (const video of videos) {
    console.log(`[${video.platform}] 开始转写: ${video.path}`);
    try {
      const result = await transcribeVideo(video.path, {
        modelSize: "base",
        language: "auto",
      });
      console.log(`[${video.platform}] ✓ 转写成功`);
      results.push({ platform: video.platform, success: true, result });
    } catch (error) {
      console.log(`[${video.platform}] ✗ 转写失败: ${error.message}`);
      results.push({ platform: video.platform, success: false, error: error.message });
    }
    console.log();
  }

  console.log("\n=== 汇总结果 ===");
  for (const r of results) {
    console.log(`${r.platform}: ${r.success ? "✓ 成功" : "✗ 失败"}`);
  }

  const allSuccess = results.every((r) => r.success);
  process.exit(allSuccess ? 0 : 1);
}

main().catch((err) => {
  console.error("执行出错:", err);
  process.exit(1);
});
