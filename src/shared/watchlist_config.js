const fs = require("node:fs");
const path = require("node:path");
const { getSharedDataDir } = require("./runtime_config");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getConfigRoot() {
  return path.join(getSharedDataDir(), "config");
}

function getWatchlistsDir() {
  return path.join(getConfigRoot(), "watchlists");
}

function getWatchlistPath(name) {
  return path.join(getWatchlistsDir(), `${name}.json`);
}

function loadWatchlist(name) {
  const filePath = getWatchlistPath(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Watchlist not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveWindow(windowConfig = {}, now = new Date()) {
  const publishedAfter = windowConfig.published_after || null;
  const publishedBefore = windowConfig.published_before || null;
  const lookbackDays = Number(windowConfig.lookback_days) || null;

  if (publishedAfter || publishedBefore) {
    return {
      published_after: publishedAfter,
      published_before: publishedBefore,
      lookback_days: lookbackDays,
    };
  }

  if (lookbackDays && lookbackDays > 0) {
    const before = new Date(now);
    const after = new Date(now);
    after.setUTCDate(after.getUTCDate() - lookbackDays);
    return {
      published_after: after.toISOString(),
      published_before: before.toISOString(),
      lookback_days: lookbackDays,
    };
  }

  return {
    published_after: null,
    published_before: null,
    lookback_days: null,
  };
}

function ensureWatchlistFile(name, data) {
  const filePath = getWatchlistPath(name);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

module.exports = {
  ensureWatchlistFile,
  getConfigRoot,
  getWatchlistPath,
  getWatchlistsDir,
  loadWatchlist,
  resolveWindow,
};
