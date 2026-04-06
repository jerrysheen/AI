const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function tryRequireShared() {
  try {
    return require("../../../src/shared/runtime_config");
  } catch {
    return null;
  }
}

const shared = tryRequireShared();
const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = shared?.REPO_ROOT || path.resolve(SKILL_ROOT, "..", "..");

function loadDotEnv() {
  const candidates = [
    path.join(REPO_ROOT, ".env"),
    path.join(SKILL_ROOT, ".env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key]) continue;
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

function isWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function resolveConfigPath(value, fallbackValue) {
  const candidate = value && String(value).trim() ? String(value).trim() : fallbackValue;
  if (!candidate) return "";
  if (process.platform !== "win32" && isWindowsPath(candidate)) {
    return fallbackValue;
  }
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(REPO_ROOT, candidate);
}

function getSharedDataDir() {
  return shared?.getSharedDataDir?.() || resolveEnvPath("AI_SHARED_DATA_DIR", ".ai-data");
}

function getChromeProfileDir() {
  return (
    shared?.getChromeProfileDir?.() ||
    resolveEnvPath("AI_CHROME_PROFILE_DIR", ".chrome-sider-profile")
  );
}

function getChromeDebugPort() {
  return shared?.getChromeDebugPort?.() || resolveEnvInteger("AI_CHROME_DEBUG_PORT", 9222);
}

function getChromeStartupDelayMs() {
  return shared?.getChromeStartupDelayMs?.() || resolveEnvInteger("AI_CHROME_STARTUP_DELAY_MS", 4000);
}

function getChromePath() {
  const explicit = shared?.getChromePath?.() || resolveEnvString("AI_CHROME_PATH", "");
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }

  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return "google-chrome";
}

function resolveSiderConfig(configPath) {
  const configFullPath = path.resolve(configPath);
  const configText = fs.readFileSync(configFullPath, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(configText);

  const fallbackUserDataDir = getChromeProfileDir();
  const userDataDir = resolveConfigPath(config?.chrome?.user_data_dir, fallbackUserDataDir);
  const defaultPortFile = path.join(userDataDir, "DevToolsActivePort");

  return {
    site: {
      url: config?.site?.url || "https://sider.ai/zh-CN/chat",
      response_idle_timeout_ms: Number(config?.site?.response_idle_timeout_ms || 50000),
      response_max_timeout_ms: Number(config?.site?.response_max_timeout_ms || 180000),
      response_poll_interval_ms: Number(config?.site?.response_poll_interval_ms || 2000),
      response_stable_checks: Number(config?.site?.response_stable_checks || 4),
    },
    chrome: {
      path: resolveConfigPath(config?.chrome?.path, getChromePath()) || getChromePath(),
      user_data_dir: userDataDir,
      startup_url: config?.chrome?.startup_url || config?.site?.url || "https://sider.ai/zh-CN/chat",
      startup_delay_ms: Number(config?.chrome?.startup_delay_ms || getChromeStartupDelayMs()),
      remote_debug_port: Number(config?.chrome?.remote_debug_port || getChromeDebugPort()),
      devtools_active_port_path:
        resolveConfigPath(config?.chrome?.devtools_active_port_path, defaultPortFile) || defaultPortFile,
      extra_args: Array.isArray(config?.chrome?.extra_args) ? config.chrome.extra_args.map(String) : [],
    },
    browser_cleanup: {
      enabled: Boolean(config?.browser_cleanup?.enabled) && process.platform === "win32",
      process_names: Array.isArray(config?.browser_cleanup?.process_names)
        ? config.browser_cleanup.process_names.map(String)
        : [],
      wait_after_kill_ms: Number(config?.browser_cleanup?.wait_after_kill_ms || 2000),
    },
  };
}

module.exports = {
  REPO_ROOT,
  SKILL_ROOT,
  getChromeDebugPort,
  getChromePath,
  getChromeProfileDir,
  getChromeStartupDelayMs,
  getSharedDataDir,
  resolveSiderConfig,
};
