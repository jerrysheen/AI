#!/usr/bin/env node

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

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

async function fetchTweetWithChrome(tweetUrl) {
  console.log("=".repeat(70));
  console.log("使用 Chrome CDP 访问推文");
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

      console.log("获取页面内容...");

      const htmlResult = await send("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      });
      const fullHtml = htmlResult.result.value || "";
      console.log(`HTML 长度: ${fullHtml.length} 字符`);

      fs.writeFileSync(path.join(__dirname, "twitter_article_page.html"), fullHtml);
      console.log("HTML 已保存到 twitter_article_page.html");

      console.log("\n尝试多种方式提取内容...");

      const extractResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const results = {};

          results.title = document.title;

          const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
          results.metaDescription = metaDesc?.getAttribute('content');

          const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
          results.metaTitle = metaTitle?.getAttribute('content');

          results.bodyText = document.body?.innerText?.slice(0, 5000);

          const articleSelectors = [
            'article',
            '[data-testid="tweet"]',
            '[data-testid="noteTweet"]',
            '.note-tweet',
            '.article',
            '#article',
          ];
          results.foundElements = {};
          for (const sel of articleSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              results.foundElements[sel] = {
                exists: true,
                html: el.outerHTML?.slice(0, 2000),
                text: el.innerText?.slice(0, 1000),
              };
            }
          }

          const allText = document.body?.innerText || '';
          results.allTextSample = allText.slice(0, 3000);

          const scripts = [...document.querySelectorAll('script')];
          results.dataScripts = scripts
            .map(s => s.textContent)
            .filter(t => t && (t.includes('__INITIAL_STATE__') || t.includes('tweet') || t.includes('note') || t.includes('article')))
            .slice(0, 3)
            .map(s => s.slice(0, 1000));

          return results;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      return extractResult.result.value;
    });

    console.log("\n" + "=".repeat(70));
    console.log("提取结果");
    console.log("=".repeat(70));
    console.log("标题:", result.title);
    console.log("Meta 标题:", result.metaTitle);
    console.log("Meta 描述:", result.metaDescription?.slice(0, 200));
    console.log("\n找到的元素:", Object.keys(result.foundElements || {}));

    for (const [sel, data] of Object.entries(result.foundElements || {})) {
      console.log(`\n--- ${sel} ---`);
      console.log("文本:", data.text);
    }

    console.log("\n" + "=".repeat(70));
    console.log("页面完整文本样本");
    console.log("=".repeat(70));
    console.log(result.allTextSample);

    if (result.dataScripts && result.dataScripts.length > 0) {
      console.log("\n" + "=".repeat(70));
      console.log("数据脚本样本");
      console.log("=".repeat(70));
      result.dataScripts.forEach((s, i) => console.log(`\n[${i+1}]\n${s}`));
    }

    return result;
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {}
    }
  }
}

async function main() {
  const url = "https://x.com/liu10102525/status/2041421845178839210?s=46";
  await fetchTweetWithChrome(url);
}

main().catch(console.error);
