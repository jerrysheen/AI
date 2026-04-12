#!/usr/bin/env node

const TEST_TWEET_ID = "2042312202733174838";

console.log("Testing fetchTwitter without actual video download...");

// 临时修改 downloadTwitterVideo 来跳过实际下载
const originalDownload = require("./scripts/download_twitter_video").downloadTwitterVideo;

// 模拟下载
function mockDownloadTwitterVideo(tweetId, options) {
  console.log("Mocking download for tweet:", tweetId);
  return Promise.resolve({
    source: "twitter_syndication_video",
    input: tweetId,
    tweet_id: tweetId,
    output_path: options.output,
    file_size_bytes: 1234567,
  });
}

// 替换模块中的函数
const dlModule = require("./scripts/download_twitter_video");
dlModule.downloadTwitterVideo = mockDownloadTwitterVideo;

// 现在测试 fetchTwitter
const { fetchTwitter } = require("./scripts/fetch_twitter");

// 创建一个临时 job 对象
const mockJob = {
  job_id: "test_job_123",
  source: "twitter",
  source_url: `https://x.com/test/status/${TEST_TWEET_ID}`,
  title: "Test Tweet",
  content_type: { has_video: true, has_images: false, has_text: true },
  status: "pending",
};

fetchTwitter(TEST_TWEET_ID, { job: mockJob })
  .then((result) => {
    console.log("\n✓ fetchTwitter result (mocked download):");
    console.log("  - Error:", result.error);
    console.log("  - Tweet ID:", result.tweet_id);
    console.log("  - Author:", result.author);
    console.log("  - Has video:", result.content_type.has_video);
    console.log("  - Task dir:", result.task_dir);
    console.log("  - Job ID:", result.job_id);
    if (result.task_dir) {
      const fs = require("fs");
      const path = require("path");
      if (fs.existsSync(result.task_dir)) {
        console.log("  - Task dir exists! Contents:", fs.readdirSync(result.task_dir));
      }
    }
    console.log("\nTest passed!");
  })
  .catch((error) => {
    console.error("\n✗ fetchTwitter failed:", error);
  });
