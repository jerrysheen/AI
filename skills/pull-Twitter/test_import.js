#!/usr/bin/env node

console.log("Testing module imports...");

try {
  console.log("1. Testing runtime_shim...");
  const runtimeShim = require("./scripts/runtime_shim");
  console.log("   ✓ runtime_shim loaded");

  console.log("2. Testing ensure_twitter_browser...");
  const ensureTwitterBrowser = require("./scripts/ensure_twitter_browser");
  console.log("   ✓ ensure_twitter_browser loaded");

  console.log("3. Testing list_twitter_user_tweets...");
  const { normalizeUserInput, parseArgs } = require("./scripts/list_twitter_user_tweets");
  console.log("   ✓ list_twitter_user_tweets loaded");

  console.log("4. Testing normalizeUserInput...");
  const test1 = normalizeUserInput("@elonmusk");
  console.log("   ✓ @elonmusk ->", test1);

  const test2 = normalizeUserInput("elonmusk");
  console.log("   ✓ elonmusk ->", test2);

  const test3 = normalizeUserInput("https://twitter.com/elonmusk");
  console.log("   ✓ URL ->", test3);

  console.log("5. Testing API module...");
  const api = require("./api");
  console.log("   ✓ API loaded");

  console.log("\n✅ All import tests passed!");
  process.exit(0);
} catch (error) {
  console.error("\n❌ Import test failed:", error);
  console.error(error.stack);
  process.exit(1);
}
