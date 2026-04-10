#!/usr/bin/env node

const https = require("node:https");

const sampleTweetUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";
const articleUrl = "http://x.com/i/article/2041419068423426048";

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : require("node:http");
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options.headers,
      },
      timeout: 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, url }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function extractMetaTags(html) {
  const tags = {};
  const metaRegex = /<meta[^>]+(property|name)="([^"]+)"[^>]+content="([^"]+)"/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    tags[match[2]] = match[3];
  }
  return tags;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)</i);
  return match ? match[1].trim() : null;
}

function extractBodyText(html) {
  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];
  body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<[^>]+>/g, " ");
  body = body.replace(/\s+/g, " ");
  return body.trim();
}

async function testArticleUrl() {
  console.log("=".repeat(70));
  console.log("研究 1: x.com/i/article/... 链接结构");
  console.log("=".repeat(70));

  const urls = [
    "https://x.com/i/article/2041419068423426048",
    "https://twitter.com/i/article/2041419068423426048",
  ];

  for (const url of urls) {
    console.log(`\n--- 测试: ${url} ---`);
    try {
      const result = await fetchUrl(url);
      console.log(`状态码: ${result.status}`);
      console.log(`最终 URL: ${result.url}`);

      if (result.status >= 300 && result.status < 400) {
        console.log(`重定向到: ${result.headers.location}`);
      }

      if (result.body) {
        const title = extractTitle(result.body);
        const meta = extractMetaTags(result.body);
        console.log(`页面标题: ${title}`);
        console.log(`og:title: ${meta["og:title"] || "N/A"}`);
        console.log(`og:description: ${meta["og:description"] ? meta["og:description"].slice(0, 150) + "..." : "N/A"}`);
        console.log(`og:type: ${meta["og:type"] || "N/A"}`);

        const bodyText = extractBodyText(result.body);
        console.log(`正文长度: ${bodyText.length} 字符`);
        console.log(`正文样本: ${bodyText.slice(0, 300)}...`);
      }
    } catch (e) {
      console.log(`❌ 失败: ${e.message}`);
    }
  }
}

async function testNitterArticle() {
  console.log("\n" + "=".repeat(70));
  console.log("研究 2: Nitter 上的文章显示");
  console.log("=".repeat(70));

  const nitterUrl = "https://nitter.net/liu10102525/status/2041421845178839210";

  console.log(`\n访问: ${nitterUrl}`);
  try {
    const result = await fetchUrl(nitterUrl);
    console.log(`状态码: ${result.status}`);

    if (result.body) {
      console.log("\n查找文章链接...");
      const articleMatches = result.body.match(/href="([^"]*\/article\/[^"]+)"/gi);
      if (articleMatches) {
        console.log(`找到 ${articleMatches.length} 个文章链接:`);
        articleMatches.slice(0, 3).forEach(m => console.log(`  ${m}`));
      } else {
        console.log("未找到文章链接");
      }

      const bodyText = extractBodyText(result.body);
      console.log(`\n页面正文长度: ${bodyText.length} 字符`);
      console.log(`正文样本: ${bodyText.slice(0, 500)}...`);
    }
  } catch (e) {
    console.log(`❌ 失败: ${e.message}`);
  }
}

async function testVideoTweet() {
  console.log("\n" + "=".repeat(70));
  console.log("研究 3: 视频推文的结构");
  console.log("=".repeat(70));

  console.log("\n查看当前 RSS 数据中是否有视频相关字段...");
  const { fetchUserTweets } = require("./scripts/fetch_tweet_nitter");
  const result = await fetchUserTweets("liu10102525", { limit: 5 });

  if (result.tweets) {
    for (const tweet of result.tweets) {
      console.log(`\n--- 推文 ${tweet.tweet_id} ---`);
      console.log(`标题包含 'video'? ${(tweet.title || "").toLowerCase().includes("video")}`);
      console.log(`描述包含 'video'? ${(tweet.raw_description || "").toLowerCase().includes("video")}`);
      if (tweet.raw_description) {
        const hasPic = tweet.raw_description.includes("pic/");
        const hasMedia = tweet.raw_description.includes("media%2F");
        const hasAmplify = tweet.raw_description.includes("amplify_video_thumb");
        console.log(`包含图片: ${hasPic}, 包含媒体: ${hasMedia}, 包含视频缩略图: ${hasAmplify}`);
      }
    }
  }
}

async function main() {
  await testArticleUrl();
  await testNitterArticle();
  await testVideoTweet();

  console.log("\n" + "=".repeat(70));
  console.log("研究完成");
  console.log("=".repeat(70));
}

main().catch(console.error);
