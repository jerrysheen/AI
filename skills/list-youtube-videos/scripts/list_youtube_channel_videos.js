#!/usr/bin/env node

const http = require("node:http");
const path = require("node:path");
const { getChromeDebugPort } = require("./runtime_shim");
const { ensureYouTubeBrowser } = require("./ensure_youtube_browser");

function normalizeChannelInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A YouTube channel URL or handle is required.");
  }

  if (value.startsWith("@")) {
    return {
      channel_ref: value,
      channel_url: `https://www.youtube.com/${value}`,
      videos_url: `https://www.youtube.com/${value}/videos`,
    };
  }

  try {
    const url = new URL(value);
    if (!url.hostname.includes("youtube.com")) {
      throw new Error("Not a YouTube URL.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) {
      throw new Error("Missing channel path.");
    }

    let channelRef = `/${parts.join("/")}`;
    if (parts[0].startsWith("@")) {
      channelRef = parts[0];
    } else if (parts[parts.length - 1] === "videos") {
      channelRef = `/${parts.slice(0, -1).join("/")}`;
    }

    const channelPath = channelRef.startsWith("@") ? channelRef : channelRef.replace(/\/videos$/, "");
    return {
      channel_ref: channelPath,
      channel_url: `https://www.youtube.com/${channelPath.replace(/^\/+/, "")}`,
      videos_url: `https://www.youtube.com/${channelPath.replace(/^\/+/, "")}/videos`,
    };
  } catch {
    throw new Error(`Unable to normalize YouTube channel input: ${input}`);
  }
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
      // Try next candidate.
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

async function getYouTubePageTarget(debugPort = getChromeDebugPort()) {
  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://www.youtube.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open a new YouTube page in Chrome.");
  }
  return {
    page: newPage,
    created: true,
  };
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

function toIsoOrNull(input) {
  const parsed = Date.parse(String(input || ""));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function estimatePublishTimestampFromRelativeText(text, nowMs = Date.now()) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return null;
  }

  const patterns = [
    { regex: /(\d+)\s*秒前/, unitMs: 1000 },
    { regex: /(\d+)\s*分钟前/, unitMs: 60 * 1000 },
    { regex: /(\d+)\s*小?时前/, unitMs: 60 * 60 * 1000 },
    { regex: /(\d+)\s*天前/, unitMs: 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*周前/, unitMs: 7 * 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*个月前/, unitMs: 30 * 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*years?\s*ago/, unitMs: 365 * 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*months?\s*ago/, unitMs: 30 * 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*weeks?\s*ago/, unitMs: 7 * 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*days?\s*ago/, unitMs: 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*hours?\s*ago/, unitMs: 60 * 60 * 1000 },
    { regex: /(\d+)\s*minutes?\s*ago/, unitMs: 60 * 1000 },
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern.regex);
    if (!match) {
      continue;
    }
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }
    return Math.floor((nowMs - amount * pattern.unitMs) / 1000);
  }

  return null;
}

async function collectVideoCards(send, videosUrl, limit, scrollRounds) {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: videosUrl });
  await new Promise((resolve) => setTimeout(resolve, 5000));

  for (let round = 0; round < scrollRounds; round += 1) {
    await send("Runtime.evaluate", {
      expression: `window.scrollTo(0, document.documentElement.scrollHeight);`,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const expression = `(async () => {
    const titleNode = document.querySelector('ytd-channel-name #text, yt-formatted-string#text');
    const cards = [...document.querySelectorAll('ytd-rich-grid-media, ytd-grid-video-renderer')];
    const items = cards.map((card) => {
      const link = card.querySelector('a#video-title-link, a#video-title');
      const title = (link?.textContent || '').trim();
      const href = link?.href || '';
      const videoId = (() => {
        try {
          const url = new URL(href, location.origin);
          return url.searchParams.get('v');
        } catch {
          return null;
        }
      })();
      const metaText = [...card.querySelectorAll('#metadata-line span, #metadata span.inline-metadata-item')]
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      return {
        video_id: videoId,
        title,
        video_url: href || (videoId ? 'https://www.youtube.com/watch?v=' + videoId : ''),
        published_text: metaText[1] || metaText[0] || null,
      };
    }).filter((item) => item.video_id && item.title);

    return {
      channel_title: (titleNode?.textContent || document.title || '').trim(),
      items
    };
  })()`;

  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = result.result.value || {};
  const unique = [];
  const seen = new Set();
  for (const item of value.items || []) {
    if (seen.has(item.video_id)) {
      continue;
    }
    seen.add(item.video_id);
    unique.push(item);
    if (unique.length >= limit) {
      break;
    }
  }

  return {
    channel_title: value.channel_title || null,
    items: unique,
  };
}

async function enrichPublishDates(send, items) {
  const enriched = [];

  for (const item of items) {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.video_id)}`;
    const expression = `(async () => {
      const response = await fetch(${JSON.stringify(watchUrl)}, { credentials: 'include' });
      const html = await response.text();
      const match = html.match(/"publishDate":"(\\\\d{4}-\\\\d{2}-\\\\d{2})"/);
      const ownerMatch = html.match(/"ownerChannelName":"([^"]+)"/);
      return {
        publishDate: match ? match[1] : null,
        ownerChannelName: ownerMatch ? ownerMatch[1] : null
      };
    })()`;
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    const publishDate = result.result.value?.publishDate || null;
    const publishTime = toIsoOrNull(publishDate);
    enriched.push({
      ...item,
      channel_title: result.result.value?.ownerChannelName || null,
      publish_date: publishDate,
      publish_time: publishTime,
      publish_timestamp: publishTime ? Math.floor(Date.parse(publishTime) / 1000) : null,
    });
  }

  return enriched;
}

function filterVideosByPublishTime(videos, after, before) {
  return videos.filter((video) => {
    const publishTimestamp =
      Number(video.publish_timestamp) ||
      estimatePublishTimestampFromRelativeText(video.published_text) ||
      0;
    if (after && (!publishTimestamp || publishTimestamp < after)) {
      return false;
    }
    if (before && (!publishTimestamp || publishTimestamp > before)) {
      return false;
    }
    return true;
  });
}

async function listYouTubeChannelVideos(input, options = {}) {
  const channel = normalizeChannelInput(input);
  const after = parseDateInput(options.publishedAfter);
  const before = parseDateInput(options.publishedBefore);
  const limit = Math.max(1, Number(options.limit) || 24);
  const scrollRounds = Math.max(1, Number(options.scrollRounds) || 6);
  const debugPort = await ensureYouTubeBrowser();
  const target = await getYouTubePageTarget(Number(options.debugPort || debugPort || getChromeDebugPort()));
  const { page } = target;

  try {
    const listing = await callCdp(page.webSocketDebuggerUrl, async (send) => {
      const cards = await collectVideoCards(send, channel.videos_url, limit, scrollRounds);
      const enriched = await enrichPublishDates(send, cards.items);
      return {
        channel_title: cards.channel_title,
        items: enriched,
      };
    });

    const filteredVideos = filterVideosByPublishTime(listing.items, after, before);

    return {
      channel_ref: channel.channel_ref,
      channel_url: channel.channel_url,
      videos_url: channel.videos_url,
      channel_title: listing.channel_title || filteredVideos[0]?.channel_title || null,
      filters: {
        published_after: after ? new Date(after * 1000).toISOString() : null,
        published_before: before ? new Date(before * 1000).toISOString() : null,
      },
      video_count: filteredVideos.length,
      videos: filteredVideos,
    };
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {
        // Best effort cleanup only.
      }
    }
  }
}

function parseArgs(argv) {
  const args = {
    input: null,
    pretty: false,
    limit: 24,
    scrollRounds: 6,
    debugPort: getChromeDebugPort(),
    publishedAfter: null,
    publishedBefore: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.input) {
        args.input = token;
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
    } else if (token === "--scroll-rounds") {
      args.scrollRounds = Number(nextValue);
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

  if (!args.input) {
    throw new Error(
      "Usage: node skills/list-youtube-videos/scripts/list_youtube_channel_videos.js <channel-url-or-handle> [--published-after 2026-03-01] [--published-before 2026-03-31] [--limit 24] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await listYouTubeChannelVideos(args.input, {
      limit: args.limit,
      scrollRounds: args.scrollRounds,
      debugPort: args.debugPort,
      publishedAfter: args.publishedAfter,
      publishedBefore: args.publishedBefore,
    });
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listYouTubeChannelVideos,
  normalizeChannelInput,
  parseArgs,
};
