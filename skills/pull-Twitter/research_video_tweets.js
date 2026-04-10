#!/usr/bin/env node

const http = require("node:http");
const path = require("node:path");

const { getChromeDebugPort } = require("./scripts/runtime_shim");
const { ensureTwitterBrowser } = require("./scripts/ensure_twitter_browser");

function getJsonViaHttp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(payload)); } catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.on("error", reject);
  });
}

function requestJsonViaHttp(method, url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(payload)); } catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.on("error", reject);
    request.end();
  });
}

function resolveWebSocketConstructor() {
  if (typeof WebSocket === "function") { return WebSocket; }
  const candidates = [
    path.resolve(__dirname, "..", "ask-sider", "node_modules", "ws"),
    path.resolve(__dirname, "..", "..", ".ai-data", "tmp", "ask-sider-runtime", "node_modules", "ws"),
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error("WebSocket runtime unavailable");
}

async function callCdp(wsUrl, actions) {
  const WebSocketImpl = resolveWebSocketConstructor();
  const socket = new WebSocketImpl(wsUrl);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) { reject(new Error(JSON.stringify(message.error))); }
    else { resolve(message.result); }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(event.error || new Error("CDP socket error")), { once: true });
  });

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try { return await actions(send); }
  finally {
    for (const { reject } of pending.values()) { reject(new Error("CDP socket closed")); }
    pending.clear();
    socket.close();
  }
}

async function getTwitterPageTarget(debugPort) {
  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://twitter.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open new page");
  }
  return { page: newPage, created: true };
}

async function analyzeVideoTweet(tweetUrl) {
  console.log("=".repeat(70));
  console.log("研究 1: Chrome CDP 直接访问视频推文");
  console.log("=".repeat(70));
  console.log("URL:", tweetUrl);

  const debugPort = await ensureTwitterBrowser();
  const target = await getTwitterPageTarget(debugPort);
  const { page } = target;

  try {
    const result = await callCdp(page.webSocketDebuggerUrl, async (send) => {
      await send("Page.enable");
      await send("Runtime.enable");

      console.log("\n正在导航...");
      await send("Page.navigate", { url: tweetUrl });
      await new Promise(r => setTimeout(r, 8000));

      console.log("分析页面...");

      const extractResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const results = {};

          results.title = document.title;

          const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
          results.metaDescription = metaDesc?.getAttribute('content');

          const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
          results.metaTitle = metaTitle?.getAttribute('content');

          const ogVideo = document.querySelector('meta[property="og:video"]');
          const ogVideoUrl = ogVideo?.getAttribute('content');
          results.ogVideo = ogVideoUrl;

          const ogVideoType = document.querySelector('meta[property="og:video:type"]');
          results.ogVideoType = ogVideoType?.getAttribute('content');

          const videoEl = document.querySelector('video');
          if (videoEl) {
            results.hasVideoElement = true;
            results.videoSrc = videoEl.src;
            results.videoPoster = videoEl.poster;
          } else {
            results.hasVideoElement = false;
          }

          const articleText = document.querySelector('article, [data-testid="tweet"]')?.innerText;
          results.articleText = articleText;

          const fullText = document.body?.innerText;
          results.fullTextSample = fullText?.slice(0, 3000);

          const scripts = [...document.querySelectorAll('script')];
          results.dataScripts = scripts
            .map(s => s.textContent)
            .filter(t => t && (t.includes('video') || t.includes('caption') || t.includes('subtitles') || t.includes('transcript')))
            .slice(0, 3)
            .map(s => s.slice(0, 1000));

          const videoLinks = [...document.querySelectorAll('a[href*="video"], a[href*="caption"], a[href*="subtitle"]')];
          results.videoLinks = videoLinks.map(a => a.href).slice(0, 10);

          const allText = document.body?.innerText || '';
          results.hasCaption = allText.includes('caption') || allText.includes('subtitle') || allText.includes('transcript');
          results.hasSubtitles = allText.includes('subtitles');

          return results;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      return extractResult.result.value;
    });

    console.log("\n" + "=".repeat(70));
    console.log("Chrome 分析结果");
    console.log("=".repeat(70));
    console.log("标题:", result.title);
    console.log("Meta 标题:", result.metaTitle);
    console.log("Meta 描述:", result.metaDescription?.slice(0, 200));
    console.log("OG Video:", result.ogVideo);
    console.log("有 Video 元素:", result.hasVideoElement);
    console.log("Video Src:", result.videoSrc);
    console.log("找到字幕相关:", result.hasCaption ? "是" : "否");
    console.log("找到字幕标签:", result.hasSubtitles ? "是" : "否");
    console.log("视频链接数:", result.videoLinks?.length || 0);

    if (result.articleText) {
      console.log("\n推文内容:", result.articleText.slice(0, 500));
    }

    if (result.dataScripts && result.dataScripts.length > 0) {
      console.log("\n找到相关数据脚本:", result.dataScripts.length);
      result.dataScripts.forEach((s, i) => console.log(`\n[${i+1}]\n${s}`));
    }

    console.log("\n" + "=".repeat(70));
    console.log("搜索关键词提取");
    console.log("=".repeat(70));

    const searchKeywords = [];
    if (result.metaTitle) searchKeywords.push(result.metaTitle.replace(/\s*\/\s*X$/, '').trim());
    if (result.metaDescription) searchKeywords.push(result.metaDescription.slice(0, 100));

    console.log("可用于搜索的关键词:");
    searchKeywords.forEach((k, i) => console.log(`  ${i+1}. ${k}`));

    return {
      chromeData: result,
      searchKeywords,
    };
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {}
    }
  }
}

async function main() {
  const url = "https://x.com/billtheinvestor/status/2042312202733174838?s=46";

  const chromeResult = await analyzeVideoTweet(url);

  console.log("\n" + "=".repeat(70));
  console.log("研究结论");
  console.log("=".repeat(70));
  console.log("\n方案分析:");
  console.log("\n1. Twitter 视频字幕:");
  console.log("   - Twitter 本身不提供公开的字幕 API");
  console.log("   - 即使有字幕，也需要登录才能获取");
  console.log("   - 结论: ❌ 短期内无法直接从 Twitter 获取字幕");

  console.log("\n2. 跨平台搜索方案:");
  console.log("   - 可以从视频推文提取: 标题、描述、作者、时间等元数据");
  console.log("   - 用这些元数据在 YouTube/其他平台搜索");
  console.log("   - 如果找到匹配视频，用现有工具抓取字幕");
  console.log("   - 结论: ✅ 可行，但需要匹配逻辑");

  console.log("\n3. 更好的方案建议:");
  console.log("   - 阶段 1: 提取视频推文的元数据（标题、描述等）用于搜索");
  console.log("   - 阶段 2: 提供搜索关键词，让用户/系统去 YouTube 搜索");
  console.log("   - 阶段 3: 集成现有 YouTube 字幕抓取工具");
  console.log("   - 备选: 接受视频文件，用 Whisper 等工具本地转录");
}

main().catch(console.error);
