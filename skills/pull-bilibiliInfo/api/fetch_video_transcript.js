#!/usr/bin/env node

const { getChromeDebugPort } = require("../../../src/shared/runtime_config");
const {
  fetchBilibiliTranscriptAuto,
} = require("../scripts/fetch_bilibili_transcript_auto");

function normalizeTranscriptResult(rawResult) {
  const ok = !rawResult.error;

  return {
    ok,
    source: "bilibili",
    kind: "video_transcript",
    video: {
      bvid: rawResult.bvid || null,
      title: rawResult.title || null,
      url: rawResult.url || null,
      cid: rawResult.cid || null,
      duration_seconds: Number(rawResult.duration || 0),
      owner: rawResult.owner || null,
      description: rawResult.desc || "",
    },
    transcript: {
      source: rawResult.transcript_source || null,
      requested_lang: rawResult.requested_subtitle_lang || null,
      selected_lang: rawResult.subtitle_lang || null,
      selected_lang_label: rawResult.subtitle_lang_doc || null,
      has_ai_subtitle: Boolean(rawResult.has_ai_subtitle),
      available_subtitles: Array.isArray(rawResult.available_subtitles)
        ? rawResult.available_subtitles
        : [],
      full_text: rawResult.full_text || "",
      segments: Array.isArray(rawResult.segments) ? rawResult.segments : null,
    },
    artifacts: {
      audio_file: rawResult.audio_file || null,
      asr_file: rawResult.asr_file || null,
    },
    fallback_used: Boolean(rawResult.fallback_used),
    browser_subtitle_error: rawResult.browser_subtitle_error || null,
    error: rawResult.error || null,
  };
}

async function fetchBilibiliVideoTranscript(input, options = {}) {
  const rawResult = await fetchBilibiliTranscriptAuto(input, {
    preferLang: options.preferLang || "ai-zh",
    cookie: options.cookie || "",
    withSegments: Boolean(options.withSegments),
    debugPort: Number(options.debugPort || getChromeDebugPort()),
  });

  return normalizeTranscriptResult(rawResult);
}

function parseArgs(argv) {
  const args = {
    input: null,
    preferLang: "ai-zh",
    cookie: process.env.BILIBILI_COOKIE || "",
    withSegments: false,
    pretty: false,
    debugPort: getChromeDebugPort(),
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
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/pull-bilibiliInfo/api/fetch_video_transcript.js <video-url-or-bvid> [--prefer-lang ai-zh] [--with-segments] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchBilibiliVideoTranscript(args.input, {
      preferLang: args.preferLang,
      cookie: args.cookie,
      withSegments: args.withSegments,
      debugPort: args.debugPort,
    });
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchBilibiliVideoTranscript,
  normalizeTranscriptResult,
  parseArgs,
};
