const fs = require("node:fs");
const path = require("node:path");
const { getSharedDataDir } = require("./runtime_config");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function readJson(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sanitizeKey(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function toDateBucket(value) {
  if (!value) {
    return "unknown-date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown-date";
  }
  return date.toISOString().slice(0, 10);
}

function getCacheRoot() {
  return path.join(getSharedDataDir(), "cache");
}

function getSourceCacheRoot(source) {
  return path.join(getCacheRoot(), sanitizeKey(source));
}

function getSourceDailyRoot(source, dateBucket) {
  return path.join(getSourceCacheRoot(source), sanitizeKey(dateBucket));
}

function getSourceDailyIndexPath(source, dateBucket) {
  return path.join(getSourceDailyRoot(source, dateBucket), "index.json");
}

function getSourceStatsPath(source) {
  return path.join(getSourceCacheRoot(source), "stats.json");
}

function getEntryFilePath({ source, dateBucket, category, contentId }) {
  return path.join(
    getSourceDailyRoot(source, dateBucket),
    sanitizeKey(category),
    `${sanitizeKey(contentId)}.json`
  );
}

function updateSourceStats(source) {
  const sourceRoot = getSourceCacheRoot(source);
  ensureDir(sourceRoot);

  const dayEntries = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const stats = {
    source,
    updated_at: new Date().toISOString(),
    total_days: dayEntries.length,
    days: [],
  };

  for (const dateBucket of dayEntries) {
    const indexPath = getSourceDailyIndexPath(source, dateBucket);
    const index = readJson(indexPath, null);
    if (!index) {
      continue;
    }

    stats.days.push({
      date: dateBucket,
      item_count: Number(index.item_count) || 0,
      categories: index.categories || {},
    });
  }

  writeJson(getSourceStatsPath(source), stats);
}

function upsertContentCache({ source, category, contentId, publishedAt, record }) {
  const dateBucket = toDateBucket(publishedAt || record.publish_time || record.generated_at);
  const entryPath = getEntryFilePath({
    source,
    dateBucket,
    category,
    contentId,
  });

  const cacheRecord = {
    source,
    category,
    content_id: contentId,
    date_bucket: dateBucket,
    cached_at: new Date().toISOString(),
    ...record,
  };

  writeJson(entryPath, cacheRecord);

  const indexPath = getSourceDailyIndexPath(source, dateBucket);
  const index = readJson(indexPath, {
    source,
    date: dateBucket,
    updated_at: null,
    item_count: 0,
    categories: {},
    items: [],
  });

  const relativeEntryPath = path.relative(getCacheRoot(), entryPath);
  const item = {
    content_id: contentId,
    category,
    title: record.title || null,
    publish_time: record.publish_time || publishedAt || null,
    source_ref: record.source_ref || null,
    file_path: entryPath,
    relative_file_path: relativeEntryPath,
    updated_at: cacheRecord.cached_at,
  };

  const existingIndex = index.items.findIndex(
    (existing) => existing.content_id === contentId && existing.category === category
  );

  if (existingIndex >= 0) {
    index.items[existingIndex] = item;
  } else {
    index.items.push(item);
  }

  index.items.sort((left, right) => {
    const leftTime = Date.parse(left.publish_time || "") || 0;
    const rightTime = Date.parse(right.publish_time || "") || 0;
    return rightTime - leftTime;
  });
  index.item_count = index.items.length;
  index.updated_at = cacheRecord.cached_at;
  index.categories[category] = index.items.filter((entry) => entry.category === category).length;

  writeJson(indexPath, index);
  updateSourceStats(source);

  return {
    date_bucket: dateBucket,
    file_path: entryPath,
    index_path: indexPath,
  };
}

module.exports = {
  getCacheRoot,
  getSourceCacheRoot,
  getSourceDailyIndexPath,
  getSourceStatsPath,
  toDateBucket,
  upsertContentCache,
};
