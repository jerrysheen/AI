#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...options.headers,
      },
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

async function testDirectTwitterAccess(tweetUrl) {
  console.log("\n=== 方案 1: 直接访问 Twitter/X ===");
  try {
    const result = await fetchUrl(tweetUrl);
    console.log(`状态码: ${result.status}`);
    console.log(`Content-Length: ${result.headers["content-length"] || "N/A"}`);
    if (result.body.includes("login")) {
      console.log("❌ 页面包含登录要求");
    }
    if (result.body.includes("article") || result.body.includes("tweet")) {
      console.log("✅ 页面可能包含推文内容");
    }
    return { success: result.status === 200, hasLogin: result.body.includes("login") };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function testNitterInstance(tweetUrl, instance) {
  console.log(`\n=== 方案 2: Nitter 镜像 (${instance}) ===`);
  try {
    const nitterUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, instance);
    console.log(`访问: ${nitterUrl}`);
    const result = await fetchUrl(nitterUrl);
    console.log(`状态码: ${result.status}`);
    if (result.status === 200) {
      if (result.body.includes("tweet-content") || result.body.includes("main-tweet")) {
        console.log("✅ 找到推文内容标记");
        return { success: true, url: nitterUrl };
      }
      console.log("⚠️ 状态 200 但未找到明确的推文标记");
      return { success: true, url: nitterUrl, warning: true };
    }
    return { success: false, status: result.status };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function testFxTwitter(tweetUrl) {
  console.log("\n=== 方案 3: FixTweet (fxtwitter.com) ===");
  try {
    const fxUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://fxtwitter.com");
    console.log(`访问: ${fxUrl}`);
    const result = await fetchUrl(fxUrl);
    console.log(`状态码: ${result.status}`);
    if (result.status === 200) {
      if (result.body.includes("twitter.com") || result.body.includes("og:description")) {
        console.log("✅ 页面包含嵌入内容");
      }
      return { success: true, url: fxUrl };
    }
    return { success: false, status: result.status };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function testVxtwitter(tweetUrl) {
  console.log("\n=== 方案 4: VXTwitter (vxtwitter.com) ===");
  try {
    const vxUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://vxtwitter.com");
    console.log(`访问: ${vxUrl}`);
    const result = await fetchUrl(vxUrl);
    console.log(`状态码: ${result.status}`);
    if (result.status === 200) {
      return { success: true, url: vxUrl };
    }
    return { success: false, status: result.status };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

function parseTweetUrl(url) {
  const match = url.match(/\/status\/(\d+)/);
  if (!match) return null;
  const tweetId = match[1];
  const userMatch = url.match(/(twitter|x)\.com\/([^\/]+)/);
  const handle = userMatch ? userMatch[2] : null;
  return { tweetId, handle, url };
}

async function main() {
  const sampleUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";
  const parsed = parseTweetUrl(sampleUrl);

  console.log("=" .repeat(60));
  console.log("Twitter/X 无登录抓取方案测试");
  console.log("=" .repeat(60));
  console.log("目标推文:", sampleUrl);
  if (parsed) {
    console.log("推文 ID:", parsed.tweetId);
    console.log("用户:", parsed.handle);
  }

  const results = {};

  // 方案 1: 直接访问
  results.direct = await testDirectTwitterAccess(sampleUrl);

  // 方案 2: Nitter 镜像
  const nitterInstances = [
    "https://nitter.net",
    "https://nitter.nixnet.services",
    "https://nitter.poast.org",
  ];
  results.nitter = [];
  for (const instance of nitterInstances) {
    results.nitter.push(await testNitterInstance(sampleUrl, instance));
  }

  // 方案 3: FixTweet
  results.fxtwitter = await testFxTwitter(sampleUrl);

  // 方案 4: VXTwitter
  results.vxtwitter = await testVxtwitter(sampleUrl);

  console.log("\n" + "=".repeat(60));
  console.log("测试总结");
  console.log("=".repeat(60));
  console.log("直接访问:", results.direct.success ? (results.direct.hasLogin ? "✅ 但需登录" : "✅ 成功") : "❌ 失败");
  console.log("Nitter 可用:", results.nitter.filter(r => r.success).length, "/", results.nitter.length);
  console.log("FixTwitter:", results.fxtwitter.success ? "✅" : "❌");
  console.log("VXTwitter:", results.vxtwitter.success ? "✅" : "❌");

  const bestNitter = results.nitter.find(r => r.success && !r.warning);
  if (bestNitter) {
    console.log("\n推荐方案: Nitter (", bestNitter.url, ")");
  } else if (results.fxtwitter.success) {
    console.log("\n推荐方案: FixTwitter (", results.fxtwitter.url, ")");
  }
}

main().catch(console.error);
