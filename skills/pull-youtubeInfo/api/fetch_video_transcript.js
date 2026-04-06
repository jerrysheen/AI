#!/usr/bin/env node

const { getChromeDebugPort } = require("../scripts/runtime_shim");
const { fetchYouTubeSubtitle } = require("../scripts/fetch_youtube_subtitle");

function normalizeTranscriptResult(rawResult) {
  const ok = !rawResult.error;

  return {
    ok,
    status: ok ? "available" : "unavailable",
    source: "youtube",
    kind: "video_transcript",
    video: {
      video_id: rawResult.video_id || null,
      title: rawResult.title || null,
      url: rawResult.url || null,
    },
    transcript: {
      source: rawResult.transcript_source || null,
      requested_lang: rawResult.requested_subtitle_lang || null,
      selected_lang: rawResult.subtitle_lang || null,
      selected_lang_label: rawResult.subtitle_name || null,
      has_ai_subtitle: Boolean(rawResult.has_auto_subtitle),
      available_subtitles: Array.isArray(rawResult.available_subtitles)
        ? rawResult.available_subtitles
        : [],
      full_text: rawResult.full_text || "",
      segments: Array.isArray(rawResult.segments) ? rawResult.segments : null,
    },
    artifacts: {
      audio_file: null,
      asr_file: null,
    },
    fallback_used: false,
    browser_subtitle_error: rawResult.browser_subtitle_error || null,
    error: rawResult.error || null,
  };
}

async function fetchYouTubeVideoTranscript(input, options = {}) {
  const rawResult = await fetchYouTubeSubtitle(input, {
    preferLang: options.preferLang || "",
    debugPort: Number(options.debugPort || getChromeDebugPort()),
  });

  return normalizeTranscriptResult(rawResult);
}

function parseArgs(argv) {
  const args = {
    input: null,
    preferLang: "",
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
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/pull-youtubeInfo/api/fetch_video_transcript.js <youtube-url-or-id> [--prefer-lang zh-TW] [--with-segments] [--debug-port 9222] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchYouTubeVideoTranscript(args.input, {
      preferLang: args.preferLang,
      withSegments: args.withSegments,
      debugPort: args.debugPort,
    });

    if (!args.withSegments && result.transcript) {
      result.transcript.segments = null;
    }

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
  fetchYouTubeVideoTranscript,
  normalizeTranscriptResult,
  parseArgs,
};
