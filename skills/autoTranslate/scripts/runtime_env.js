#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "AGENTS.md")) && fs.existsSync(path.join(current, "skills"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir, "..", "..");
    }
    current = parent;
  }
}

function parseEnvText(text) {
  const result = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadRepoEnv(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return { envPath, loaded: false };
  }

  const parsed = parseEnvText(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return { envPath, loaded: true };
}

function resolveSharedDataDir(repoRoot) {
  return path.resolve(repoRoot, process.env.AI_SHARED_DATA_DIR || ".ai-data");
}

function resolveRepoPath(repoRoot, targetPath, fallbackPath) {
  const value = String(targetPath || fallbackPath || "").trim();
  return path.resolve(repoRoot, value);
}

function resolveCommand(defaultCommand, envKey) {
  return String(process.env[envKey] || defaultCommand).trim();
}

module.exports = {
  findRepoRoot,
  loadRepoEnv,
  resolveRepoPath,
  resolveSharedDataDir,
  resolveCommand,
};
