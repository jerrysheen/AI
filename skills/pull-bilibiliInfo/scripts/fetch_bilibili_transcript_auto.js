#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getChromeDebugPort } = require("../../../src/shared/runtime_config");
const { fetchBilibiliSubtitle, extractBvid } = require("./fetch_bilibili_subtitle");

async function fetchBilibiliTranscriptAuto(urlOrBvid, options = {}) {
  const bvid = extractBvid(urlOrBvid);
  const subtitleResult = await fetchBilibiliSubtitle(
    bvid,
    options.preferLang || "ai-zh",
    options.cookie || "",
    {
      includeSegments: Boolean(options.withSegments),
      debugPort: options.debugPort,
    }
  );

  if (!subtitleResult.error) {
    return {
      ...subtitleResult,
      transcript_source: "subtitle",
      audio_file: null,
      asr_file: null,
      fallback_used: false,
    };
  }

  // Future ASR hook: if Whisper fallback is re-enabled later, branch here and
  // wire in `fetch_bilibili_audio.js` plus `transcribe_bilibili_audio.js`.
  return {
    ...subtitleResult,
    transcript_source: null,
    audio_file: null,
    asr_file: null,
    fallback_used: false,
  };
}

function parseArgs(argv) {
  const args = {
    video: null,
    preferLang: "ai-zh",
    cookie: process.env.BILIBILI_COOKIE || "",
    writeJson: null,
    pretty: false,
    withSegments: false,
    debugPort: getChromeDebugPort(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.video) {
        args.video = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
      continue;
    }

    if (token === "--with-segments") {
      args.withSegments = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--prefer-lang") {
      args.preferLang = nextValue;
    } else if (token === "--cookie") {
      args.cookie = nextValue;
    } else if (token === "--write-json") {
      args.writeJson = nextValue;
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.video) {
    throw new Error(
      "Usage: node fetch_bilibili_transcript_auto.js <video-url-or-bvid> [--prefer-lang ai-zh] [--write-json path] [--with-segments] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchBilibiliTranscriptAuto(args.video, {
      preferLang: args.preferLang,
      cookie: args.cookie,
      withSegments: args.withSegments,
      debugPort: args.debugPort,
    });
    const output = JSON.stringify(data, null, args.pretty ? 2 : 0);
    process.stdout.write(`${output}\n`);

    if (args.writeJson) {
      const outputPath = path.resolve(args.writeJson);
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    }

    process.exitCode = data.error ? 1 : 0;
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
  fetchBilibiliTranscriptAuto,
  parseArgs,
};
