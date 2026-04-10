#!/usr/bin/env node

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

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

async function testNitterStructure(tweetUrl) {
  console.log("\n=== 分析 Nitter HTML 结构 ===");
  const nitterUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://nitter.net");

  try {
    const result = await fetchUrl(nitterUrl);
    console.log("状态码:", result.status);

    if (result.status === 200) {
      fs.writeFileSync(path.join(__dirname, "nitter_sample.html"), result.body);
      console.log("HTML 已保存到 nitter_sample.html");

      console.log("\n寻找可能的选择器:");
      const classMatches = result.body.match(/class="[^"]+"/g) || [];
      const uniqueClasses = new Set();
      classMatches.forEach(m => {
        const classes = m.slice(7, -1).split(/\s+/);
        classes.forEach(c => uniqueClasses.add(c));
      });
      console.log("常见 class:", Array.from(uniqueClasses).filter(c => c.includes('tweet') || c.includes('content') || c.includes('text')).slice(0, 20));

      console.log("\nHTML 前 2000 字符:");
      console.log(result.body.slice(0, 2000));
    }
  } catch (e) {
    console.log("❌ 失败:", e.message);
  }
}

async function testVxtwitterStructure(tweetUrl) {
  console.log("\n=== 分析 VXTwitter HTML 结构 ===");
  const vxUrl = tweetUrl.replace(/https:\/\/(twitter|x)\.com/, "https://vxtwitter.com");

  try {
    const result = await fetchUrl(vxUrl);
    console.log("状态码:", result.status);

    if (result.status === 200) {
      fs.writeFileSync(path.join(__dirname, "vxtwitter_sample.html"), result.body);
      console.log("HTML 已保存到 vxtwitter_sample.html");

      console.log("\n寻找 meta 标签:");
      const metaMatches = result.body.match(/<meta[^>]+>/g) || [];
      metaMatches.slice(0, 30).forEach(m => console.log(m));

      console.log("\nHTML 前 2000 字符:");
      console.log(result.body.slice(0, 2000));
    }
  } catch (e) {
    console.log("❌ 失败:", e.message);
  }
}

async function main() {
  const sampleUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";
  await testNitterStructure(sampleUrl);
  await testVxtwitterStructure(sampleUrl);
}

main().catch(console.error);
