#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const cp = require("node:child_process");
const {
  getChromeDebugPort,
  getChromePath,
  getChromeProfileDir,
  getChromeStartupDelayMs,
} = require("./runtime_shim");

function isWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function resolveMacChromeApp(chromePath) {
  const value = String(chromePath || "").trim();
  if (value.endsWith("/Contents/MacOS/Google Chrome")) {
    return value.replace(/\/Contents\/MacOS\/Google Chrome$/, ".app");
  }
  if (value.endsWith(".app")) {
    return value;
  }

  const candidates = [
    "/Applications/Google Chrome.app",
    path.join(process.env.HOME || "", "Applications", "Google Chrome.app"),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function resolveConfigPath(value, fallbackValue, repoRoot) {
  const candidate = value && String(value).trim() ? String(value).trim() : fallbackValue;
  if (!candidate) {
    return "";
  }

  if (process.platform !== "win32" && isWindowsPath(candidate)) {
    return fallbackValue;
  }

  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(repoRoot, candidate);
}

function loadConfig(configPath) {
  const configText = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(configText);
}

function checkDebugPort(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => resolve(false));
  });
}

async function waitForDebugPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkDebugPort(port, 1000)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function launchChrome({ chromePath, profileDir, port, startupUrl, extraArgs }) {
  const chromeArgs = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--new-window",
    ...extraArgs,
    startupUrl,
  ];

  if (process.platform === "darwin") {
    const appBundlePath = resolveMacChromeApp(chromePath);
    const openArgs = appBundlePath
      ? ["-na", appBundlePath, "--args", ...chromeArgs]
      : ["-na", "Google Chrome", "--args", ...chromeArgs];
    const result = cp.spawnSync("open", openArgs, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
    });
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || "Failed to launch Google Chrome.").trim());
    }
    return;
  }

  const child = cp.spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function ensureYouTubeBrowser(configPath) {
  const scriptDir = __dirname;
  const skillDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(skillDir, "..", "..");
  const resolvedConfigPath = path.resolve(configPath || path.join(skillDir, "config", "youtube-browser.json"));
  const config = loadConfig(resolvedConfigPath);

  const defaultProfileDir = getChromeProfileDir();
  const profileDir = process.env.AI_CHROME_PROFILE_DIR
    ? resolveConfigPath(process.env.AI_CHROME_PROFILE_DIR, defaultProfileDir, repoRoot)
    : resolveConfigPath(config?.chrome?.user_data_dir, defaultProfileDir, repoRoot);

  const port = Number(process.env.AI_CHROME_DEBUG_PORT || config?.chrome?.remote_debug_port || getChromeDebugPort());
  const chromePath = process.env.AI_CHROME_PATH || config?.chrome?.path || getChromePath();
  const startupDelayMs = Number(
    process.env.AI_CHROME_STARTUP_DELAY_MS || config?.chrome?.startup_delay_ms || getChromeStartupDelayMs()
  );
  const startupUrl = String(config?.site?.startup_url || config?.site?.url || "https://www.youtube.com");
  const extraArgs = Array.isArray(config?.chrome?.extra_args)
    ? config.chrome.extra_args.map((value) => String(value))
    : ["--no-first-run", "--no-default-browser-check"];

  if (!(await checkDebugPort(port))) {
    fs.mkdirSync(profileDir, { recursive: true });
    launchChrome({
      chromePath,
      profileDir,
      port,
      startupUrl,
      extraArgs,
    });

    await new Promise((resolve) => setTimeout(resolve, startupDelayMs));
    const reachable = await waitForDebugPort(port, 15000);
    if (!reachable) {
      throw new Error(`Chrome remote debugging port ${port} is not reachable.`);
    }
  }

  return port;
}

async function main() {
  try {
    const port = await ensureYouTubeBrowser(process.argv[2]);
    process.stdout.write(`${port}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureYouTubeBrowser,
};
