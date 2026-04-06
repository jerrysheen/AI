#!/usr/bin/env node

const http = require("node:http");
const cp = require("node:child_process");
const path = require("node:path");
const { getChromeDebugPort } = require("./runtime_shim");

function extractMid(input) {
  const value = String(input || "").trim();
  const match = value.match(/space\.bilibili\.com\/(\d+)/i) || value.match(/^(\d{3,})$/);
  if (match) {
    return match[1];
  }
  throw new Error(`Unable to extract Bilibili mid from input: ${input}`);
}

function normalizeSpaceUrl(input) {
  const mid = extractMid(input);
  return {
    mid,
    space_url: `https://space.bilibili.com/${mid}`,
    upload_url: `https://space.bilibili.com/${mid}/upload/video`,
  };
}

function getJsonViaHttp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        payload += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${payload.slice(0, 500)}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
    request.on("error", reject);
  });
}

function requestJsonViaHttp(method, url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        payload += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${payload.slice(0, 500)}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
    request.on("error", reject);
    request.end();
  });
}

function resolveWebSocketConstructor() {
  if (typeof WebSocket === "function") {
    return WebSocket;
  }

  const candidates = [
    path.resolve(__dirname, "..", "..", "ask-sider", "node_modules", "ws"),
    path.resolve(__dirname, "..", "..", "..", ".ai-data", "tmp", "ask-sider-runtime", "node_modules", "ws"),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next location.
    }
  }

  throw new Error("WebSocket runtime is unavailable. Install or reuse the existing ws dependency first.");
}

async function callCdp(wsUrl, actions) {
  const WebSocketImpl = resolveWebSocketConstructor();
  const socket = new WebSocketImpl(wsUrl);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
      return;
    }
    resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(event.error || new Error("CDP socket error")), {
      once: true,
    });
  });

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    return await actions(send);
  } finally {
    for (const { reject } of pending.values()) {
      reject(new Error("CDP socket closed before reply was received."));
    }
    pending.clear();
    socket.close();
  }
}

async function getBilibiliPageTarget(debugPort = getChromeDebugPort()) {
  const targets = await getJsonViaHttp(`http://127.0.0.1:${debugPort}/json/list`);
  const page = targets.find(
    (item) => item.type === "page" && String(item.url || "").startsWith("https://www.bilibili.com/")
  );
  if (page && page.webSocketDebuggerUrl) {
    return {
      page,
      created: false,
    };
  }

  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://www.bilibili.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open a new Bilibili page in Chrome.");
  }
  return {
    page: newPage,
    created: true,
  };
}

async function closePage(debugPort, pageId) {
  if (!pageId) {
    return;
  }
  try {
    await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${pageId}`, 10000);
  } catch {
    // Best effort cleanup only.
  }
}

function ensureBrowser(debugPort) {
  try {
    const scriptPath = path.resolve(__dirname, "ensure_bilibili_browser.js");
    const result = cp.spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        AI_CHROME_DEBUG_PORT: String(debugPort || getChromeDebugPort()),
      },
    });

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      throw new Error(stderr || "Failed to ensure Bilibili browser session.");
    }

    const resolvedPort = Number(String(result.stdout || "").trim());
    return Number.isFinite(resolvedPort) ? resolvedPort : debugPort;
  } catch (error) {
    throw new Error(
      `Could not start or connect to the Bilibili Chrome session: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getVideoInfoByBvid(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com",
    },
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${payload.slice(0, 300)}`);
  }

  const data = JSON.parse(payload);
  if (data.code !== 0) {
    throw new Error(`View API error for ${bvid}: ${data.message || "unknown error"}`);
  }
  return data.data || {};
}

function toIsoOrNull(unixSeconds) {
  const value = Number(unixSeconds);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return Math.floor(parsed / 1000);
}

function normalizeVideoEntry(video) {
  return {
    bvid: video.bvid,
    video_id: video.bvid,
    video_id_type: "bvid",
    title: video.title,
    video_url: video.video_url,
    publish_time: video.publish_time || null,
    publish_timestamp: video.publish_timestamp || null,
  };
}

function filterVideosByPublishTime(videos, after, before) {
  return videos.filter((video) => {
    const publishTimestamp = Number(video.publish_timestamp) || 0;
    if (after && (!publishTimestamp || publishTimestamp < after)) {
      return false;
    }
    if (before && (!publishTimestamp || publishTimestamp > before)) {
      return false;
    }
    return true;
  });
}

async function listUpVideos(urlOrMid, options = {}) {
  const { mid, space_url, upload_url } = normalizeSpaceUrl(urlOrMid);
  const debugPort = ensureBrowser(Number(options.debugPort || getChromeDebugPort()));
  const limit = Math.max(Number(options.limit) || 12, 1);
  const waitMs = Math.max(Number(options.waitMs) || 8000, 1000);
  const publishedAfter = parseDateInput(options.publishedAfter);
  const publishedBefore = parseDateInput(options.publishedBefore);
  const target = await getBilibiliPageTarget(debugPort);
  const { page } = target;

  try {
    const scraped = await callCdp(page.webSocketDebuggerUrl, async (send) => {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.navigate", { url: upload_url });
      await sleep(waitMs);

      const expression = `(limit) => {
        const items = [];
        const seen = new Set();
        const anchors = Array.from(document.querySelectorAll('a[href*="/video/BV"]'));

        for (const anchor of anchors) {
          const href = String(anchor.href || "");
          const text = String(anchor.textContent || "").trim();
          const bvMatch = href.match(/\\/video\\/(BV[0-9A-Za-z]+)/);
          if (!bvMatch || !text) {
            continue;
          }

          const bvid = bvMatch[1];
          if (seen.has(bvid)) {
            continue;
          }

          if (/^[\\d.万亿合作播放收藏弹幕:\\s]+$/u.test(text)) {
            continue;
          }

          seen.add(bvid);
          items.push({
            bvid,
            title: text,
            video_url: href.split("?")[0],
            publish_time: null,
          });

          if (items.length >= limit) {
            break;
          }
        }

        return items;
      }`;

      const result = await send("Runtime.callFunctionOn", {
        functionDeclaration: expression,
        arguments: [{ value: limit }],
        executionContextId: 1,
        returnByValue: true,
      }).catch(async () => {
        const fallback = await send("Runtime.evaluate", {
          expression: `(${expression})(${JSON.stringify(limit)})`,
          returnByValue: true,
        });
        return { result: fallback.result };
      });

      const videos = result.result.value || [];
      return {
        mid,
        space_url,
        upload_url,
        videos,
      };
    });

    const enrichedVideos = [];
    for (const video of scraped.videos) {
      let publishTimestamp = null;
      let publishTime = null;
      try {
        const info = await getVideoInfoByBvid(video.bvid);
        publishTimestamp = Number(info.pubdate) || null;
        publishTime = toIsoOrNull(publishTimestamp);
      } catch {
        publishTimestamp = null;
        publishTime = null;
      }

      enrichedVideos.push({
        ...video,
        publish_time: publishTime,
        publish_timestamp: publishTimestamp,
      });
    }

    const filteredVideos = filterVideosByPublishTime(enrichedVideos, publishedAfter, publishedBefore).map(
      normalizeVideoEntry
    );
    return {
      mid,
      space_url,
      upload_url,
      filters: {
        published_after: publishedAfter ? toIsoOrNull(publishedAfter) : null,
        published_before: publishedBefore ? toIsoOrNull(publishedBefore) : null,
      },
      video_count: filteredVideos.length,
      videos: filteredVideos,
    };
  } finally {
    if (target.created) {
      await closePage(debugPort, page.id);
    }
  }
}

function parseArgs(argv) {
  const args = {
    target: null,
    pretty: false,
    limit: 12,
    waitMs: 8000,
    debugPort: getChromeDebugPort(),
    publishedAfter: null,
    publishedBefore: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.target) {
        args.target = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--limit") {
      args.limit = Number(nextValue);
    } else if (token === "--wait-ms") {
      args.waitMs = Number(nextValue);
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else if (token === "--published-after") {
      args.publishedAfter = nextValue;
    } else if (token === "--published-before") {
      args.publishedBefore = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.target) {
    throw new Error(
      "Usage: node list_bilibili_up_videos.js <space-url-or-mid> [--limit 12] [--wait-ms 8000] [--debug-port 9222] [--published-after 2026-01-01] [--published-before 2026-12-31] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await listUpVideos(args.target, {
      limit: args.limit,
      waitMs: args.waitMs,
      debugPort: args.debugPort,
      publishedAfter: args.publishedAfter,
      publishedBefore: args.publishedBefore,
    });
    process.stdout.write(`${JSON.stringify(data, null, args.pretty ? 2 : 0)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractMid,
  listUpVideos,
  normalizeSpaceUrl,
  parseArgs,
};
