#!/usr/bin/env node
/**
 * 为Twitter和xhs运行ASR转写
 */

const { transcribeVideo } = require("./src/shared/video_transcriber");

const videos = [
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
  console.log("开始为Twitter和xhs运行ASR转写...\n");

  for (const video of videos) {
    console.log(`[${video.platform}] 开始转写: ${video.path}`);
    try {
      // 直接调用submit_remote_transcribe.js，避免video_transcriber的重命名问题
      const path = require("node:path");
      const fs = require("node:fs");
      const { spawn } = require("node:child_process");
      const { REPO_ROOT } = require("./src/shared/runtime_config");

      const remoteTranscribeScript = path.join(REPO_ROOT, "skills", "autoTranslate", "scripts", "submit_remote_transcribe.js");
      const outputDir = path.dirname(video.path);

      await new Promise((resolve, reject) => {
        const args = [video.path, "--model-size", "base", "--language", "auto", "--output-dir", outputDir];
        const child = spawn("node", [remoteTranscribeScript, ...args]);

        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);

        child.on("close", (code) => {
          if (code === 0) {
            // 确保transcript.txt存在
            const transcriptPath = path.join(outputDir, "transcript.txt");
            const videoTranscriptPath = path.join(outputDir, "video_transcript.txt");
            if (fs.existsSync(transcriptPath) && !fs.existsSync(videoTranscriptPath)) {
              fs.copyFileSync(transcriptPath, videoTranscriptPath);
            }
            resolve();
          } else {
            reject(new Error(`Exit code ${code}`));
          }
        });
      });

      console.log(`[${video.platform}] ✓ 转写成功`);
    } catch (error) {
      console.log(`[${video.platform}] ✗ 转写失败: ${error.message}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("执行出错:", err);
  process.exit(1);
});
