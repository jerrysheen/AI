#!/usr/bin/env node

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : require("node:http");
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function extractArticleContent(html) {
  const results = {
    title: null,
    author: null,
    content: null,
    hasArticle: false,
  };

  const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
  if (titleMatch) {
    results.title = titleMatch[1].trim();
  }

  const articleSelectors = [
    /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*main-tweet[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const selector of articleSelectors) {
    const match = html.match(selector);
    if (match) {
      results.hasArticle = true;
      let content = match[1];
      content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
      content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
      content = content.replace(/<a[^>]*href="([^"]+)"[^>]*>/gi, (m, href) => `[${href}] `);
      content = content.replace(/<[^>]+>/g, " ");
      content = content.replace(/\s+/g, " ").trim();
      results.content = content;
      break;
    }
  }

  return results;
}

async function testNitterTweetPage() {
  console.log("=".repeat(70));
  console.log("深度研究: Nitter 推文页面内容");
  console.log("=".repeat(70));

  const nitterUrl = "https://nitter.net/liu10102525/status/2041421845178839210";

  console.log(`\n访问: ${nitterUrl}`);
  try {
    const result = await fetchUrl(nitterUrl);
    console.log(`状态码: ${result.status}`);

    fs.writeFileSync(path.join(__dirname, "nitter_tweet_page.html"), result.body);
    console.log("HTML 已保存到 nitter_tweet_page.html");

    const article = extractArticleContent(result.body);
    console.log(`\n提取结果:`);
    console.log(`标题: ${article.title}`);
    console.log(`有文章内容: ${article.hasArticle}`);
    if (article.content) {
      console.log(`内容长度: ${article.content.length} 字符`);
      console.log(`内容样本: ${article.content.slice(0, 500)}...`);
    }

    console.log(`\n查找所有 class:`);
    const classMatches = result.body.match(/class="[^"]+"/g) || [];
    const classes = new Set();
    classMatches.forEach(m => {
      m.slice(7, -1).split(/\s+/).forEach(c => classes.add(c));
    });
    const interestingClasses = Array.from(classes).filter(c =>
      c.includes("tweet") || c.includes("article") || c.includes("content") || c.includes("text")
    );
    console.log(`相关 class: ${interestingClasses.join(", ")}`);

    console.log(`\nHTML 前 3000 字符:`);
    console.log(result.body.slice(0, 3000));

  } catch (e) {
    console.log(`❌ 失败: ${e.message}`);
  }
}

async function testNitterArticleSearch() {
  console.log("\n" + "=".repeat(70));
  console.log("研究: 查找 Nitter RSS 中的文章链接");
  console.log("=".repeat(70));

  const { fetchUserTweets } = require("./scripts/fetch_tweet_nitter");
  const result = await fetchUserTweets("liu10102525", { limit: 10 });

  if (result.tweets) {
    for (const tweet of result.tweets) {
      console.log(`\n--- ${tweet.tweet_id} ---`);
      if (tweet.title && tweet.title.includes("article")) {
        console.log(`标题: ${tweet.title}`);
      }
      if (tweet.text && tweet.text.includes("article")) {
        console.log(`文本: ${tweet.text}`);
      }
      if (tweet.raw_description) {
        const links = tweet.raw_description.match(/href="([^"]+)"/g);
        if (links) {
          console.log(`链接数: ${links.length}`);
          links.slice(0, 3).forEach(l => console.log(`  ${l}`));
        }
      }
    }
  }
}

async function main() {
  await testNitterTweetPage();
  await testNitterArticleSearch();
}

main().catch(console.error);
