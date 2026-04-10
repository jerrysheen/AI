#!/usr/bin/env node

const { fetchTwitter } = require("./scripts/fetch_tweet_nitter");

async function printTweet() {
  const url = "https://x.com/liu10102525/status/2041421845178839210?s=46";

  console.log("=".repeat(70));
  console.log("抓取的推文信息");
  console.log("=".repeat(70));

  const result = await fetchTwitter(url);

  if (result.found && result.tweet) {
    const tweet = result.tweet;
    console.log(`\n📱 推文 ID: ${tweet.tweet_id}`);
    console.log(`👤 作者: ${tweet.author_handle}`);
    console.log(`🕐 发布时间: ${tweet.published_at}`);
    console.log(`🔗 推文链接: ${tweet.tweet_url}`);
    console.log(`\n📝 内容:`);
    console.log("   " + tweet.text);
    console.log(`\n💡 说明: 这条推文是一个文章链接引用`);
  } else {
    console.log("❌ 未找到推文");
  }

  console.log("\n" + "=".repeat(70));
  console.log("该用户的最新 3 条推文");
  console.log("=".repeat(70));

  const timeline = await fetchTwitter("@liu10102525", { limit: 3 });
  if (timeline.tweets && timeline.tweets.length > 0) {
    timeline.tweets.forEach((tweet, index) => {
      console.log(`\n--- [${index + 1}] ---`);
      console.log(`👤 ${tweet.author_handle}`);
      console.log(`🕐 ${tweet.published_at}`);
      console.log(`\n📝 ${tweet.text?.slice(0, 300) || "(无内容)"}`);
      if (tweet.text && tweet.text.length > 300) {
        console.log("   ...(更多内容)");
      }
    });
  }
}

printTweet().catch(console.error);
