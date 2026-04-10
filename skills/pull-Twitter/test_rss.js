#!/usr/bin/env node

const https = require("node:https");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, text/xml, */*",
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

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const creatorMatch = itemXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);

    items.push({
      title: titleMatch ? titleMatch[1].trim() : null,
      link: linkMatch ? linkMatch[1].trim() : null,
      description: descMatch ? descMatch[1].trim() : null,
      pubDate: pubDateMatch ? pubDateMatch[1].trim() : null,
      creator: creatorMatch ? creatorMatch[1].trim() : null,
    });
  }

  return items;
}

async function testRss() {
  console.log("=" .repeat(60));
  console.log("测试 RSS 方案");
  console.log("=" .repeat(60));

  const rssUrls = [
    "https://nitter.net/liu10102525/rss",
    "https://nitter.net/liu10102525/status/2041421845178839210/rss",
  ];

  for (const rssUrl of rssUrls) {
    console.log(`\n尝试: ${rssUrl}`);
    try {
      const result = await fetchUrl(rssUrl);
      console.log(`状态码: ${result.status}`);

      if (result.status === 200 && result.body.includes("<rss")) {
        console.log("✅ 找到 RSS feed!");
        const items = parseRss(result.body);
        console.log(`解析到 ${items.length} 条项目`);

        if (items.length > 0) {
          console.log("\n第一条:");
          console.log("标题:", items[0].title);
          console.log("链接:", items[0].link);
          console.log("描述:", items[0].description?.slice(0, 200));
          return { success: true, url: rssUrl, items };
        }
      } else {
        console.log("内容前 500 字符:", result.body.slice(0, 500));
      }
    } catch (e) {
      console.log("❌ 失败:", e.message);
    }
  }

  return { success: false };
}

async function testNitterApi() {
  console.log("\n" + "=".repeat(60));
  console.log("测试 Nitter API/嵌入方案");
  console.log("=".repeat(60));

  const urls = [
    "https://nitter.net/liu10102525/status/2041421845178839210/embed",
    "https://nitter.pussthecat.org/liu10102525/status/2041421845178839210",
    "https://nitter.lucabased.xyz/liu10102525/status/2041421845178839210",
  ];

  for (const url of urls) {
    console.log(`\n尝试: ${url}`);
    try {
      const result = await fetchUrl(url);
      console.log(`状态码: ${result.status}`);
      if (result.status === 200) {
        if (result.body.includes("tweet-content") || result.body.includes("main-tweet")) {
          console.log("✅ 找到推文内容!");
          console.log("内容长度:", result.body.length);
          return { success: true, url };
        }
        console.log("内容前 800 字符:", result.body.slice(0, 800));
      }
    } catch (e) {
      console.log("❌ 失败:", e.message);
    }
  }
  return { success: false };
}

async function main() {
  const rssResult = await testRss();
  const nitterResult = await testNitterApi();

  console.log("\n" + "=".repeat(60));
  console.log("最终总结");
  console.log("=".repeat(60));

  if (rssResult.success) {
    console.log("🏆 RSS 方案可行!");
  } else if (nitterResult.success) {
    console.log("🏆 Nitter 嵌入方案可行!");
  } else {
    console.log("⚠️  公共方案均不可行，建议使用 Chrome CDP 方案（需要登录）");
  }
}

main().catch(console.error);
