#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const http = require("node:http");
const { getChromeDebugPort } = require("./runtime_shim");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com",
};

function extractBvid(urlOrBvid) {
  const match = String(urlOrBvid).match(/(BV[0-9A-Za-z]+)/);
  if (match) {
    return match[1];
  }
  throw new Error(`Unable to extract BV id from input: ${urlOrBvid}`);
}

function buildHeaders(cookie) {
  return cookie ? { ...DEFAULT_HEADERS, Cookie: cookie } : { ...DEFAULT_HEADERS };
}

function buildCookieResolveScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
[pscustomobject]@{
  ok = $false
  error = 'cookie resolver not initialized'
} | ConvertTo-Json -Compress
`;
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
      // Reuse the existing ws dependency from ask-sider instead of adding a second copy here.
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

function ensureBrowser(debugPort) {
  try {
    const scriptPath = path.resolve(__dirname, "ensure_bilibili_browser.js");
    const result = cp.spawnSync(
      process.execPath,
      [scriptPath],
      {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 8,
        env: {
          ...process.env,
          AI_CHROME_DEBUG_PORT: String(debugPort || getChromeDebugPort()),
        },
      }
    );

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

async function getSubtitleListFromBrowser(bvid, cid, debugPort = getChromeDebugPort()) {
  const resolvedPort = ensureBrowser(debugPort);
  const target = await getBilibiliPageTarget(resolvedPort);
  const { page } = target;

  try {
    return await callCdp(page.webSocketDebuggerUrl, async (send) => {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.navigate", { url: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}` });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const expression = `(async () => {
        const response = await fetch(
          "https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}",
          { credentials: "include" }
        );
        return await response.text();
      })()`;
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const payload = JSON.parse(result.result.value);
      if (payload.code !== 0) {
        throw new Error(`Player API error from browser session: ${payload.message || "unknown error"}`);
      }
      return (((payload || {}).data || {}).subtitle || {}).subtitles || [];
    });
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${resolvedPort}/json/close/${page.id}`, 10000);
      } catch {
        // Best effort cleanup only.
      }
    }
  }
}

function resolveCookieFromBrowser() {
  try {
    const result = cp.spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", buildCookieResolveScript()],
      {
        encoding: "utf8",
        timeout: 20000,
        maxBuffer: 1024 * 1024 * 8,
      }
    );

    if (result.status !== 0 || !result.stdout) {
      return { cookie: "", source: "none", meta: null };
    }

    const parsed = JSON.parse(result.stdout.trim());
    if (!parsed || parsed.ok === false || !parsed.cookie) {
      return { cookie: "", source: "none", meta: parsed || null };
    }

    return {
      cookie: parsed.cookie,
      source: "browser",
      meta: {
        browser: parsed.browser || null,
        profile: parsed.profile || null,
      },
    };
  } catch {
    return { cookie: "", source: "none", meta: null };
  }
}

function resolveCookie(explicitCookie) {
  if (explicitCookie) {
    return { cookie: explicitCookie, source: "explicit", meta: null };
  }

  if (process.env.BILIBILI_COOKIE) {
    return { cookie: process.env.BILIBILI_COOKIE, source: "env", meta: null };
  }

  return resolveCookieFromBrowser();
}

async function getJson(url, headers, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    const payload = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}: ${payload.slice(0, 500)}`);
    }

    try {
      return JSON.parse(payload);
    } catch {
      throw new Error(`Invalid JSON from ${url}: ${payload.slice(0, 500)}`);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getVideoInfo(bvid, headers) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const data = await getJson(url, headers);
  if (data.code !== 0) {
    throw new Error(`View API error: ${data.message || "unknown error"}`);
  }
  return data.data;
}

async function getSubtitleList(bvid, cid, headers) {
  const url =
    "https://api.bilibili.com/x/player/wbi/v2" +
    `?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
  const data = await getJson(url, headers);
  if (data.code !== 0) {
    throw new Error(`Player API error: ${data.message || "unknown error"}`);
  }

  const subtitleData = (data.data || {}).subtitle || {};
  return subtitleData.subtitles || [];
}

async function downloadSubtitle(subtitleUrl, headers) {
  const url = subtitleUrl.startsWith("//") ? `https:${subtitleUrl}` : subtitleUrl;
  const data = await getJson(url, headers);
  return data.body || [];
}

function fmtTime(seconds) {
  const total = Math.max(Math.floor(Number(seconds) || 0), 0);
  const sec = total % 60;
  const totalMinutes = Math.floor(total / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [hours, minutes, sec].map((value) => String(value).padStart(2, "0")).join(":");
}

function buildSubtitleSegments(subtitleBody) {
  const segments = [];
  for (const seg of subtitleBody) {
    const content = String(seg.content || "").trim();
    if (!content) {
      continue;
    }

    const start = Math.round((Number(seg.from) || 0) * 1000) / 1000;
    const end = Math.round((Number(seg.to) || 0) * 1000) / 1000;
    segments.push({
      start,
      end,
      timestamp: fmtTime(start),
      text: content,
    });
  }
  return segments;
}

function chooseSubtitle(subtitles, preferLang) {
  if (!subtitles.length) {
    return null;
  }

  const exact = subtitles.find((item) => item.lan === preferLang);
  if (exact) {
    return exact;
  }

  if (preferLang.startsWith("ai-")) {
    const aiMatch = subtitles.find((item) => String(item.lan || "").startsWith("ai-"));
    if (aiMatch) {
      return aiMatch;
    }
    return null;
  }

  return subtitles[0];
}

async function fetchBilibiliSubtitle(urlOrBvid, preferLang = "ai-zh", cookie = "", options = {}) {
  const bvid = extractBvid(urlOrBvid);
  const cookieResolution = resolveCookie(cookie);
  const headers = buildHeaders(cookieResolution.cookie);
  const includeSegments = Boolean(options.includeSegments);
  const debugPort = Number(options.debugPort || getChromeDebugPort());

  const result = {
    bvid,
    title: null,
    desc: "",
    duration: 0,
    owner: null,
    url: `https://www.bilibili.com/video/${bvid}`,
    cid: null,
    requested_subtitle_lang: preferLang,
    subtitle_lang: null,
    subtitle_lang_doc: null,
    available_subtitles: [],
    has_ai_subtitle: false,
    full_text: "",
    error: null,
  };

  if (includeSegments) {
    result.segments = [];
  }

    try {
      const info = await getVideoInfo(bvid, headers);
    result.title = info.title || null;
    result.desc = info.desc || "";
    result.duration = info.duration || 0;
    result.owner = (info.owner || {}).name || null;
    result.cid = info.cid || null;

    let subtitles = await getSubtitleList(bvid, info.cid, headers);
    if (!subtitles.length) {
      try {
        subtitles = await getSubtitleListFromBrowser(bvid, info.cid, debugPort);
      } catch (browserError) {
        result.browser_subtitle_error =
          browserError instanceof Error ? browserError.message : String(browserError);
      }
    }
    result.available_subtitles = subtitles.map((item) => ({
      lang: item.lan,
      label: item.lan_doc,
      is_ai: String(item.lan || "").startsWith("ai-"),
    }));
    result.has_ai_subtitle = subtitles.some((item) => String(item.lan || "").startsWith("ai-"));

    const chosen = chooseSubtitle(subtitles, preferLang);
    if (!chosen) {
      result.error = preferLang.startsWith("ai-")
        ? `No AI subtitle track was available for preferred language "${preferLang}".`
        : "No subtitles were returned for the requested video.";
      return result;
    }

    const body = await downloadSubtitle(chosen.subtitle_url, headers);
    const segments = buildSubtitleSegments(body);

    result.subtitle_lang = chosen.lan || null;
    result.subtitle_lang_doc = chosen.lan_doc || null;
    result.full_text = segments.map((segment) => segment.text).join(" ");
    if (includeSegments) {
      result.segments = segments;
    }
    if (!segments.length) {
      result.error = "Subtitle track was found but the subtitle body was empty.";
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function parseArgs(argv) {
  const args = {
    video: null,
    preferLang: "ai-zh",
    cookie: process.env.BILIBILI_COOKIE || "",
    writeJson: null,
    pretty: false,
    withSegments: false,
    debugPort: getChromeDebugPort(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.video) {
        args.video = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    if (token === "--with-segments") {
      args.withSegments = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--prefer-lang") {
      args.preferLang = nextValue;
    } else if (token === "--cookie") {
      args.cookie = nextValue;
    } else if (token === "--write-json") {
      args.writeJson = nextValue;
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.video) {
    throw new Error(
      "Usage: node fetch_bilibili_subtitle.js <video-url-or-bvid> " +
        "[--prefer-lang ai-zh] [--cookie \"...\"] [--write-json path] [--debug-port 9222] [--pretty] [--with-segments]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchBilibiliSubtitle(args.video, args.preferLang, args.cookie, {
      includeSegments: args.withSegments,
      debugPort: args.debugPort,
    });
    const output = JSON.stringify(data, null, args.pretty ? 2 : 0);
    process.stdout.write(`${output}\n`);

    if (args.writeJson) {
      const outputPath = path.resolve(args.writeJson);
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    }

    process.exitCode = data.error ? 1 : 0;
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
  buildSubtitleSegments,
  chooseSubtitle,
  extractBvid,
  fetchBilibiliSubtitle,
  fmtTime,
  parseArgs,
};
