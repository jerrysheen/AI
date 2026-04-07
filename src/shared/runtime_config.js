const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    return;
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
}

loadDotEnv();

function resolveEnvPath(name, fallbackRelativePath) {
  const value = process.env[name];
  if (value && String(value).trim()) {
    const normalized = String(value).trim();
    return path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(REPO_ROOT, normalized);
  }
  if (!fallbackRelativePath) {
    return "";
  }
  return path.resolve(REPO_ROOT, fallbackRelativePath);
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
  return resolveEnvPath("AI_CHROME_PROFILE_DIR", path.join(".ai-data", "chrome-profile"));
}

function getChromeDebugPort() {
  return resolveEnvInteger("AI_CHROME_DEBUG_PORT", 9222);
}

function getChromeStartupDelayMs() {
  return resolveEnvInteger("AI_CHROME_STARTUP_DELAY_MS", 4000);
}

function getChromePath() {
  const explicit = process.env.AI_CHROME_PATH;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }

  const platform = os.platform();
  if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "google-chrome";
}

function getBilibiliRunsDir() {
  return path.join(getSharedDataDir(), "bilibili", "runs");
}

function getBilibiliCacheDir() {
  return path.join(getSharedDataDir(), "cache", "bilibili");
}

function getBilibiliAudioDir() {
  return path.join(getSharedDataDir(), "audio", "bilibili");
}

function getBilibiliAsrDir() {
  return path.join(getSharedDataDir(), "asr", "bilibili");
}

function getYtDlpCommand() {
  return resolveEnvString("AI_YTDLP_COMMAND", "python -m yt_dlp");
}

function getFfmpegLocation() {
  return resolveEnvPath("AI_FFMPEG_LOCATION", "");
}

function getWhisperPythonCommand() {
  return resolveEnvString("AI_WHISPER_PYTHON", "python");
}

module.exports = {
  REPO_ROOT,
  getBilibiliAudioDir,
  getBilibiliAsrDir,
  getBilibiliCacheDir,
  getBilibiliRunsDir,
  getChromeDebugPort,
  getChromePath,
  getChromeProfileDir,
  getChromeStartupDelayMs,
  getFfmpegLocation,
  getSharedDataDir,
  getWhisperPythonCommand,
  getYtDlpCommand,
};
