const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { REPO_ROOT, getFfmpegLocation, ensureDir } = require("./runtime_config");

async function transcribeVideo(videoPath, options = {}) {
  const {
    modelSize = process.env.AI_AUTO_TRANSLATE_DEFAULT_MODEL || "base",
    language = process.env.AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE || "auto",
    keepWav = false,
    outputDir = null,
  } = options;

  const videoDir = outputDir || path.dirname(videoPath);
  const videoBasename = path.basename(videoPath, path.extname(videoPath));

  // 调用远端转译
  const transcribeResult = await callRemoteTranscribe(videoPath, {
    modelSize,
    language,
    outputDir: videoDir,
    keepWav,
  });

  // 重命名输出文件以匹配视频名称，并同时创建transcript.txt供验收使用
  const targetTranscriptPath = path.join(videoDir, `${videoBasename}_transcript.txt`);
  const targetTranscriptJsonPath = path.join(videoDir, `${videoBasename}_transcript.json`);
  const targetTranscriptSrtPath = path.join(videoDir, `${videoBasename}_transcript.srt`);
  const验收TranscriptPath = path.join(videoDir, `transcript.txt`);

  if (transcribeResult.transcript_path && fs.existsSync(transcribeResult.transcript_path)) {
    fs.renameSync(transcribeResult.transcript_path, targetTranscriptPath);
    // 同时复制一份作为transcript.txt供验收使用
    fs.copyFileSync(targetTranscriptPath, 验收TranscriptPath);
  }
  if (transcribeResult.transcript_json_path && fs.existsSync(transcribeResult.transcript_json_path)) {
    fs.renameSync(transcribeResult.transcript_json_path, targetTranscriptJsonPath);
  }
  if (transcribeResult.transcript_srt_path && fs.existsSync(transcribeResult.transcript_srt_path)) {
    fs.renameSync(transcribeResult.transcript_srt_path, targetTranscriptSrtPath);
  }

  // 清理临时文件
  const tempFiles = ["audio-16k-mono.wav", "run-summary.json", "worker.log"];
  for (const tempFile of tempFiles) {
    const tempPath = path.join(videoDir, tempFile);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  return {
    video_path: videoPath,
    wav_path: null,
    transcript_path: targetTranscriptPath,
    transcript_json_path: targetTranscriptJsonPath,
    transcript_srt_path: targetTranscriptSrtPath,
  };
}

async function callRemoteTranscribe(videoPath, options = {}) {
  const { modelSize, language, outputDir, keepWav } = options;

  // 调用远端转译脚本
  const remoteTranscribeScript = path.join(REPO_ROOT, "skills", "autoTranslate", "scripts", "submit_remote_transcribe.js");

  return new Promise((resolve, reject) => {
    const args = [
      videoPath,
      "--model-size", modelSize,
      "--language", language,
      "--output-dir", outputDir,
    ];

    if (keepWav) {
      args.push("--keep-wav");
    }

    const child = spawn("node", [remoteTranscribeScript, ...args]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data);
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Remote transcribe failed: ${stderr}`));
        return;
      }

      // 解析输出获取结果
      try {
        // 从 stdout 中提取 JSON 结果
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          resolve({
            transcript_path: result.downloaded_files?.["transcript.txt"] || null,
            transcript_json_path: result.downloaded_files?.["transcript.json"] || null,
            transcript_srt_path: result.downloaded_files?.["transcript.srt"] || null,
          });
        } else {
          // 如果没有 JSON 输出，尝试直接查找文件
          resolve({
            transcript_path: path.join(outputDir, "transcript.txt"),
            transcript_json_path: path.join(outputDir, "transcript.json"),
            transcript_srt_path: path.join(outputDir, "transcript.srt"),
          });
        }
      } catch (e) {
        reject(e);
      }
    });

    child.on("error", reject);
  });
}

module.exports = {
  transcribeVideo,
};
