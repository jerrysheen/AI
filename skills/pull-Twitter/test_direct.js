#!/usr/bin/env node

const TEST_TWEET_ID = "2042312202733174838";

console.log("Testing fetchTwitter directly...");

const { fetchTwitter } = require("./scripts/fetch_twitter");

fetchTwitter(TEST_TWEET_ID, {})
  .then((result) => {
    console.log("✓ fetchTwitter result:");
    console.log("  - Error:", result.error);
    console.log("  - Tweet ID:", result.tweet_id);
    console.log("  - Author:", result.author);
    console.log("  - Has video:", result.content_type.has_video);
    console.log("  - Task dir:", result.task_dir);
    if (result.task_dir) {
      const fs = require("fs");
      const path = require("path");
      if (fs.existsSync(result.task_dir)) {
        console.log("  - Task dir exists! Contents:", fs.readdirSync(result.task_dir));
      }
    }
  })
  .catch((error) => {
    console.error("✗ fetchTwitter failed:", error);
  });
