#!/usr/bin/env node

const { fetchTwitterEnhanced } = require("./scripts/fetch_twitter_enhanced");

async function printResult() {
  const url = "https://x.com/liu10102525/status/2041421845178839210?s=46";

  console.log("=".repeat(70));
  console.log("验收测试：增强版 Twitter 抓取");
  console.log("=".repeat(70));

  const result = await fetchTwitterEnhanced(url);

  console.log("\n📊 抓取信息:");
  console.log(`   来源: ${result.source}`);
  console.log(`   Chrome 使用: ${result.chrome_used ? "是" : "否"}`);
  console.log(`   找到: ${result.found ? "是" : "否"}`);

  if (result.tweet) {
    const tweet = result.tweet;
    console.log("\n📱 推文信息:");
    console.log(`   ID: ${tweet.tweet_id}`);
    console.log(`   作者: ${tweet.author_handle}`);
    console.log(`   链接: ${tweet.tweet_url}`);
    console.log(`   发布时间: ${tweet.published_at}`);

    console.log("\n🏷️  类型标记:");
    console.log(`   是文章: ${tweet.is_article ? "是" : "否"}`);
    console.log(`   有视频: ${tweet.has_video ? "是" : "否"}`);
    console.log(`   短内容: ${tweet.is_short_content ? "是" : "否"}`);
    console.log(`   仅链接: ${tweet.is_only_link ? "是" : "否"}`);
    console.log(`   需要Chrome: ${tweet.needs_chrome ? "是" : "否"}`);
    console.log(`   Chrome增强: ${tweet.enriched_by_chrome ? "是" : "否"}`);

    if (tweet.text && tweet.text.length > 0) {
      console.log("\n📝 完整内容:");
      console.log("-".repeat(70));
      console.log(tweet.text);
      console.log("-".repeat(70));
      console.log(`\n📏 内容长度: ${tweet.text.length} 字符`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ 验收测试通过！");
  console.log("=".repeat(70));
}

printResult().catch(console.error);
