#!/usr/bin/env node

const { getChromeDebugPort } = require("../scripts/runtime_shim");
const { listYouTubeChannelVideos } = require("../scripts/list_youtube_channel_videos");

async function fetchYouTubeChannelVideos(input, options = {}) {
  return listYouTubeChannelVideos(input, {
    limit: Number(options.limit || 24),
    scrollRounds: Number(options.scrollRounds || 6),
    debugPort: Number(options.debugPort || getChromeDebugPort()),
    publishedAfter: options.publishedAfter || null,
    publishedBefore: options.publishedBefore || null,
  });
}

function parseArgs(argv) {
  const args = {
    input: null,
    pretty: false,
    limit: 24,
    scrollRounds: 6,
    debugPort: getChromeDebugPort(),
    publishedAfter: null,
    publishedBefore: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.input) {
        args.input = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--limit") {
      args.limit = Number(nextValue);
    } else if (token === "--scroll-rounds") {
      args.scrollRounds = Number(nextValue);
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else if (token === "--published-after") {
      args.publishedAfter = nextValue;
    } else if (token === "--published-before") {
      args.publishedBefore = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/list-youtube-videos/api/list_channel_videos.js <channel-url-or-handle> [--published-after 2026-03-01] [--published-before 2026-03-31] [--limit 24] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchYouTubeChannelVideos(args.input, {
      limit: args.limit,
      scrollRounds: args.scrollRounds,
      debugPort: args.debugPort,
      publishedAfter: args.publishedAfter,
      publishedBefore: args.publishedBefore,
    });
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchYouTubeChannelVideos,
  parseArgs,
};
