#!/usr/bin/env node

const {
  extractMid,
  listUpVideos,
  normalizeSpaceUrl,
  parseArgs,
} = require("../../list-bilibili-up-videos/scripts/list_bilibili_up_videos");

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await listUpVideos(args.target, {
      limit: args.limit,
      waitMs: args.waitMs,
      debugPort: args.debugPort,
      publishedAfter: args.publishedAfter,
      publishedBefore: args.publishedBefore,
    });
    process.stdout.write(`${JSON.stringify(data, null, args.pretty ? 2 : 0)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractMid,
  listUpVideos,
  normalizeSpaceUrl,
  parseArgs,
};
