#!/usr/bin/env node

const https = require("node:https");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 15000,
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

function extractMetaTag(html, property) {
  const regex = new RegExp(`<meta[^>]+(property|name)="${property}"[^>]+content="([^"]+)"`, "i");
  const match = html.match(regex);
  return match ? match[2] : null;
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function testVxtwitter(tweetUrl) {
  console.log("\n=== 测试 VXTwitter 内容提取 ===");
  const vxUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://vxtwitter.com");
  console.log("URL:", vxUrl);

  try {
    const result = await fetchUrl(vxUrl);
    console.log("状态码:", result.status);

    if (result.status === 200) {
      const ogTitle = extractMetaTag(result.body, "og:title");
      const ogDesc = extractMetaTag(result.body, "og:description");
      const ogImage = extractMetaTag(result.body, "og:image");
      const twitterCreator = extractMetaTag(result.body, "twitter:creator");

      console.log("\n提取结果:");
      if (ogTitle) console.log("标题:", decodeHtmlEntities(ogTitle));
      if (ogDesc) console.log("描述:", decodeHtmlEntities(ogDesc));
      if (ogImage) console.log("图片:", ogImage);
      if (twitterCreator) console.log("作者:", twitterCreator);

      return {
        success: !!(ogTitle || ogDesc),
        data: {
          title: ogTitle ? decodeHtmlEntities(ogTitle) : null,
          description: ogDesc ? decodeHtmlEntities(ogDesc) : null,
          image: ogImage,
          creator: twitterCreator,
        },
      };
    }
    return { success: false };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function testNitter(tweetUrl) {
  console.log("\n=== 测试 Nitter 内容提取 ===");
  const nitterUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://nitter.net");
  console.log("URL:", nitterUrl);

  try {
    const result = await fetchUrl(nitterUrl);
    console.log("状态码:", result.status);

    if (result.status === 200) {
      const tweetTextMatch = result.body.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      const fullNameMatch = result.body.match(/<a class="fullname"[^>]*>([^<]+)</);
      const usernameMatch = result.body.match(/<a class="username"[^>]*>([^<]+)</);
      const timeMatch = result.body.match(/<span class="tweet-date"[^>]*><a[^>]*title="([^"]+)"/);

      let tweetText = null;
      if (tweetTextMatch) {
        tweetText = tweetTextMatch[1]
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .trim();
        tweetText = decodeHtmlEntities(tweetText);
      }

      console.log("\n提取结果:");
      if (fullNameMatch) console.log("全名:", decodeHtmlEntities(fullNameMatch[1]));
      if (usernameMatch) console.log("用户名:", usernameMatch[1]);
      if (timeMatch) console.log("时间:", timeMatch[1]);
      if (tweetText) console.log("推文:\n", tweetText);

      return {
        success: !!tweetText,
        data: {
          fullName: fullNameMatch ? decodeHtmlEntities(fullNameMatch[1]) : null,
          username: usernameMatch ? usernameMatch[1] : null,
          time: timeMatch ? timeMatch[1] : null,
          text: tweetText,
        },
      };
    }
    return { success: false };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function main() {
  const sampleUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";

  console.log("=" .repeat(60));
  console.log("深入测试: 内容提取");
  console.log("=" .repeat(60));

  const vxResult = await testVxtwitter(sampleUrl);
  const nitterResult = await testNitter(sampleUrl);

  console.log("\n" + "=".repeat(60));
  console.log("最终推荐");
  console.log("=".repeat(60));

  if (nitterResult.success) {
    console.log("🏆 Nitter 方案: 可以提取完整推文内容");
  } else if (vxResult.success) {
    console.log("🏆 VXTwitter 方案: 可以通过 OpenGraph 提取元数据");
  } else {
    console.log("⚠️ 需要尝试其他方案");
  }
}

main().catch(console.error);
