const fs = require("node:fs");
const path = require("node:path");

function tryRequireShared() {
  try {
    return require("../../../src/shared/runtime_config");
  } catch {
    return null;
  }
}

const shared = tryRequireShared();

if (shared) {
  module.exports = shared;
  return;
}

const SKILL_ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const candidates = [
    path.join(SKILL_ROOT, ".env"),
    path.join(SKILL_ROOT, "..", ".env"),
    path.join(SKILL_ROOT, "..", "..", ".env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
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
    break;
  }
}

loadDotEnv();

function resolveEnvPath(name, fallbackRelativePath) {
  const value = process.env[name];
  if (value && String(value).trim()) {
    const normalized = String(value).trim();
    return path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(SKILL_ROOT, normalized);
  }
  if (!fallbackRelativePath) {
    return "";
  }
  return path.resolve(SKILL_ROOT, fallbackRelativePath);
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
  return resolveEnvPath("AI_CHROME_PROFILE_DIR", ".chrome-sider-profile");
}

function getChromeDebugPort() {
  return resolveEnvInteger("AI_CHROME_DEBUG_PORT", 9222);
}

function getChromeStartupDelayMs() {
  return resolveEnvInteger("AI_CHROME_STARTUP_DELAY_MS", 4000);
}

function getChromePath() {
  return resolveEnvString("AI_CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
}

function getYtDlpCommand() {
  return resolveEnvString("AI_YTDLP_COMMAND", "python -m yt_dlp");
}

function getFfmpegLocation() {
  return resolveEnvPath("AI_FFMPEG_LOCATION", ".ai-data/tools/ffmpeg");
}

function getFfmpegCommand() {
  return resolveEnvString("AI_FFMPEG_COMMAND", "ffmpeg");
}

function getFfprobeCommand() {
  return resolveEnvString("AI_FFPROBE_COMMAND", "ffprobe");
}

function getXhsImageDir() {
  return path.join(getSharedDataDir(), "image", "xhs");
}

function getXhsVideoDir() {
  return path.join(getSharedDataDir(), "video", "xhs");
}

module.exports = {
  REPO_ROOT: SKILL_ROOT,
  getChromeDebugPort,
  getChromePath,
  getChromeProfileDir,
  getChromeStartupDelayMs,
  getFfmpegLocation,
  getFfmpegCommand,
  getFfprobeCommand,
  getSharedDataDir,
  getXhsImageDir,
  getXhsVideoDir,
  getYtDlpCommand,
};
