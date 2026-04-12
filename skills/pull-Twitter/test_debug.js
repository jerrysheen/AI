#!/usr/bin/env node

const TEST_TWEET_ID = "2042312202733174838";

console.log("Testing video metadata only...");

const { fetchTweetVideoMetadata } = require("./scripts/download_twitter_video");

fetchTweetVideoMetadata(TEST_TWEET_ID)
  .then((meta) => {
    console.log("✓ Video metadata:");
    console.log(JSON.stringify(meta, null, 2));

    console.log("\nNow testing parseInput...");
    const { parseInput } = require("./scripts/fetch_twitter_enhanced");
    try {
      const parsed = parseInput(TEST_TWEET_ID);
      console.log("✓ parseInput result:", parsed);
    } catch (e) {
      console.log("✗ parseInput failed:", e.message);
    }
  })
  .catch((error) => {
    console.error("✗ Test failed:", error);
  });
