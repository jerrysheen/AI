#!/usr/bin/env node

// 测试用已知的视频推文 ID
const TEST_TWEET_ID = "2042312202733174838";

console.log("Testing fetchTwitter with tweet ID:", TEST_TWEET_ID);

const { fetchTwitter } = require("./scripts/fetch_twitter");

// 先测试单独的视频元数据获取
console.log("\n1. Testing video metadata fetch...");
const { fetchTweetVideoMetadata } = require("./scripts/download_twitter_video");

fetchTweetVideoMetadata(TEST_TWEET_ID)
  .then((meta) => {
    console.log("✓ Video metadata fetched:");
    console.log("  - Author:", meta.author_handle);
    console.log("  - Has video variants:", meta.all_variants.length);
    console.log("  - Selected bitrate:", meta.selected_variant.bitrate);

    console.log("\n2. Testing fetchTwitterEnhanced...");
    const { fetchTwitterEnhanced } = require("./scripts/fetch_twitter_enhanced");
    return fetchTwitterEnhanced(TEST_TWEET_ID);
  })
  .then((enhanced) => {
    console.log("✓ fetchTwitterEnhanced result:", enhanced.input_type);
    if (enhanced.found) {
      console.log("  - Tweet found:", enhanced.tweet.tweet_id);
      console.log("  - Has video:", enhanced.tweet.has_video);
    }

    console.log("\nAll simple tests passed!");
  })
  .catch((error) => {
    console.error("✗ Test failed:", error.message);
    console.error(error.stack);
  });
