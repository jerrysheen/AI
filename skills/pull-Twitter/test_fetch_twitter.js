#!/usr/bin/env node

console.log("Testing fetch_twitter.js import...");

try {
  const { fetchTwitter } = require("./scripts/fetch_twitter");
  console.log("✓ fetchTwitter imported successfully");
  console.log("Function type:", typeof fetchTwitter);
  console.log("\nTest passed!");
} catch (error) {
  console.error("✗ Import failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}
