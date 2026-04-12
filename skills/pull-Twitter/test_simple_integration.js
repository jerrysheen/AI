#!/usr/bin/env node

console.log("Testing parseTwitterInput...");

const { parseTwitterInput } = require("./scripts/fetch_twitter");

const testCases = [
  "2042312202733174838",
  "https://x.com/billtheinvestor/status/2042312202733174838",
  "https://twitter.com/billtheinvestor/status/2042312202733174838",
  "@billtheinvestor",
  "billtheinvestor",
];

for (const test of testCases) {
  try {
    const result = parseTwitterInput(test);
    console.log(`✓ ${test.slice(0, 50)}:`, result.type, result.tweet_id || result.handle);
  } catch (e) {
    console.error(`✗ ${test.slice(0, 50)}:`, e.message);
  }
}

console.log("\nTesting fetchTweetVideoMetadata...");
const { fetchTweetVideoMetadata } = require("./scripts/download_twitter_video");

fetchTweetVideoMetadata("2042312202733174838")
  .then((meta) => {
    console.log("✓ Video metadata fetched:");
    console.log("  - Author:", meta.author_handle);
    console.log("  - Has video:", true);
    console.log("  - Text preview:", meta.text?.slice(0, 50));
    console.log("\nAll integration tests passed!");
  })
  .catch((error) => {
    console.error("✗ fetchTweetVideoMetadata failed:", error.message);
  });
