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
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timed out")); });
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
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timed out")); });
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

async function fetchSingleTweet(tweetUrl) {
  console.log("=" .repeat(60));
  console.log("Chrome CDP 单条推文抓取测试");
  console.log("=" .repeat(60));
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
      await new Promise(r => setTimeout(r, 6000));

      console.log("获取页面内容...");

      // 获取完整 HTML
      const htmlResult = await send("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      });
      const fullHtml = htmlResult.result.value || "";
      console.log(`HTML 长度: ${fullHtml.length} 字符`);

      // 检查是否有登录墙
      const hasLoginWall = fullHtml.includes("Sign in to X") || fullHtml.includes("signin");
      console.log("检测到登录墙:", hasLoginWall ? "是" : "否");

      // 尝试多种方式提取
      const attempts = [];

      // 尝试 1: 找 script 标签里的 JSON 数据
      console.log("\n尝试 1: 查找 script 标签中的数据");
      const scriptResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const scripts = [...document.querySelectorAll('script')];
          const dataScripts = scripts.map(s => s.textContent).filter(t => t && (t.includes('__INITIAL_STATE__') || t.includes('tweet') || t.includes('content')));
          return {
            count: dataScripts.length,
            samples: dataScripts.slice(0, 3).map(s => s.slice(0, 500))
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      console.log("找到数据脚本:", scriptResult.result.value?.count || 0);

      // 尝试 2: 直接找可见文本
      console.log("\n尝试 2: 提取可见文本");
      const textResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const allText = document.body.innerText || '';
          const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
          const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
          return {
            bodyTextLength: allText.length,
            bodyTextSample: allText.slice(0, 1000),
            metaDescription: metaDesc?.getAttribute('content'),
            metaTitle: metaTitle?.getAttribute('content'),
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      const textData = textResult.result.value || {};
      attempts.push({
        method: "meta_tags",
        title: textData.metaTitle,
        description: textData.metaDescription,
      });

      if (textData.metaDescription) {
        console.log("✅ 找到 meta description:", textData.metaDescription.slice(0, 200));
      }
      if (textData.metaTitle) {
        console.log("✅ 找到 meta title:", textData.metaTitle);
      }

      return {
        hasLoginWall,
        attempts,
        fullHtmlSample: fullHtml.slice(0, 3000),
      };
    });

    console.log("\n" + "=".repeat(60));
    console.log("测试结果");
    console.log("=".repeat(60));

    const bestAttempt = result.attempts.find(a => a.description || a.title);
    if (bestAttempt) {
      console.log("\n🏆 可以通过 meta 标签获取基本信息");
      console.log("标题:", bestAttempt.title);
      console.log("描述:", bestAttempt.description);
      return { success: true, method: "meta_tags", data: bestAttempt };
    } else if (result.hasLoginWall) {
      console.log("\n⚠️  遇到登录墙，但可以尝试 Chrome CDP 方案（用户需先在浏览器登录）");
      return { success: false, hasLoginWall: true };
    }

    return { success: false };
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {}
    }
  }
}

async function main() {
  const sampleUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";
  const result = await fetchSingleTweet(sampleUrl);

  console.log("\n" + "=".repeat(60));
  console.log("方案建议");
  console.log("=".repeat(60));

  if (result.success) {
    console.log("推荐: 通过 Chrome CDP 提取 meta 标签内容（无需登录）");
  } else if (result.hasLoginWall) {
    console.log("推荐: Chrome CDP 方案（需要用户先在浏览器中登录 Twitter）");
    console.log("备选: 可以尝试从 meta 标签提取有限信息");
  } else {
    console.log("需要进一步探索方案");
  }
}

main().catch(console.error);
