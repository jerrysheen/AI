#!/usr/bin/env node

const https = require("node:https");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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

function parseRss(xml) {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  if (!channelMatch) return { title: null, items: [] };

  const channelXml = channelMatch[1];
  const channelTitleMatch = channelXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const channelTitle = channelTitleMatch ? channelTitleMatch[1].trim() : null;

  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const guidMatch = itemXml.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);

    const title = titleMatch ? titleMatch[1].trim() : null;
    const link = linkMatch ? linkMatch[1].trim() : null;
    const description = descMatch ? descMatch[1].trim() : null;
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : null;
    const guid = guidMatch ? guidMatch[1].trim() : null;

    let tweetId = null;
    if (guid) {
      const tweetIdMatch = guid.match(/\/status\/(\d+)/);
      tweetId = tweetIdMatch ? tweetIdMatch[1] : null;
    }
    if (!tweetId && link) {
      const tweetIdMatch = link.match(/\/status\/(\d+)/);
      tweetId = tweetIdMatch ? tweetIdMatch[1] : null;
    }

    let cleanText = null;
    if (description) {
      cleanText = description
        .replace(/^<!\[CDATA\[/, "")
        .replace(/\]\]>$/, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();
    }

    items.push({
      title,
      link,
      description,
      clean_text: cleanText,
      pub_date: pubDate,
      pub_timestamp: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null,
      guid,
      tweet_id: tweetId,
    });
  }

  return { channel_title: channelTitle, items };
}

function extractHtmlText(html) {
  if (!html) return null;
  return html
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function fetchUserTimeline(handle) {
  console.log("=" .repeat(60));
  console.log(`获取 @${handle} 的时间线 (通过 Nitter RSS)`);
  console.log("=" .repeat(60));

  const rssUrl = `https://nitter.net/${handle}/rss`;
  console.log(`RSS URL: ${rssUrl}`);

  try {
    const result = await fetchUrl(rssUrl);
    if (result.status !== 200) {
      console.log(`❌ HTTP ${result.status}`);
      return null;
    }

    const parsed = parseRss(result.body);
    console.log(`✅ 获取成功!`);
    console.log(`频道: ${parsed.channel_title}`);
    console.log(`推文数: ${parsed.items.length}`);

    if (parsed.items.length > 0) {
      console.log("\n最新 3 条推文:");
      for (let i = 0; i < Math.min(3, parsed.items.length); i++) {
        const item = parsed.items[i];
        console.log(`\n--- [${i+1}] ${item.tweet_id || 'N/A'} ---`);
        console.log(`时间: ${item.pub_date}`);
        console.log(`内容: ${item.clean_text?.slice(0, 200) || 'N/A'}...`);
      }
    }

    return { success: true, handle, channel_title: parsed.channel_title, tweets: parsed.items };
  } catch (e) {
    console.log("❌ 失败:", e.message);
    return { success: false, error: e.message };
  }
}

async function findSingleTweet(handle, tweetId) {
  console.log("\n" + "=".repeat(60));
  console.log(`在 @${handle} 的时间线中查找推文 ${tweetId}`);
  console.log("=".repeat(60));

  const timeline = await fetchUserTimeline(handle);
  if (!timeline || !timeline.success) {
    return { success: false, error: "无法获取时间线" };
  }

  const found = timeline.tweets.find(t => t.tweet_id === tweetId);
  if (found) {
    console.log("\n✅ 找到目标推文!");
    console.log("\n完整信息:");
    console.log(JSON.stringify(found, null, 2));
    return { success: true, tweet: found };
  } else {
    console.log("\n⚠️  未在最新推文中找到，可能需要更多历史数据");
    console.log(`已扫描 ${timeline.tweets.length} 条推文`);
    return { success: false, tweets_scanned: timeline.tweets.length };
  }
}

async function main() {
  const sampleUrl = "https://x.com/liu10102525/status/2041421845178839210?s=46";
  const handle = "liu10102525";
  const tweetId = "2041421845178839210";

  // 先测试获取用户时间线
  const timelineResult = await fetchUserTimeline(handle);

  // 尝试查找特定推文
  if (timelineResult && timelineResult.success) {
    await findSingleTweet(handle, tweetId);
  }

  console.log("\n" + "=".repeat(60));
  console.log("方案总结");
  console.log("=".repeat(60));
  console.log("✅ Nitter RSS 方案可行，可以获取用户最新推文");
  console.log("⚠️  对于单条推文，如果在最新推文中，可以直接获取");
  console.log("⚠️  对于旧推文，可能需要抓取更多历史数据");
  console.log("\n使用方式:");
  console.log("  node fetch_nitter.js @username");
  console.log("  node fetch_nitter.js https://x.com/username/status/12345");
}

main().catch(console.error);
