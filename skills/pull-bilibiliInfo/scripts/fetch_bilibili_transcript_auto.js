#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getChromeDebugPort } = require("../../../src/shared/runtime_config");
const { fetchBilibiliSubtitle, extractBvid } = require("./fetch_bilibili_subtitle");
const { downloadBilibiliAudio } = require("./fetch_bilibili_audio");
const { transcribeBilibiliAudio } = require("./transcribe_bilibili_audio");

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

  if (options.enableAudioFallback === false) {
    return {
      ...subtitleResult,
      transcript_source: null,
      audio_file: null,
      asr_file: null,
      fallback_used: false,
    };
  }

  const videoUrl = `https://www.bilibili.com/video/${bvid}`;
  const audioResult = downloadBilibiliAudio(videoUrl, {
    audioFormat: options.audioFormat || "m4a",
    timeoutMs: options.audioTimeoutMs,
  });
  const asrResult = transcribeBilibiliAudio(audioResult.audio_file, {
    model: options.whisperModel || "small",
    language: options.whisperLanguage || "Chinese",
    timeoutMs: options.asrTimeoutMs,
  });

  return {
    ...subtitleResult,
    subtitle_lang: null,
    subtitle_lang_doc: null,
    has_ai_subtitle: false,
    full_text: asrResult.transcript_text,
    error: asrResult.transcript_text ? null : "ASR completed but transcript text was empty.",
    transcript_source: "audio_asr",
    audio_file: audioResult.audio_file,
    asr_file: asrResult.transcript_file,
    fallback_used: true,
    asr_model: asrResult.model,
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
    whisperModel: "small",
    whisperLanguage: "Chinese",
    audioFormat: "m4a",
    enableAudioFallback: true,
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

    if (token === "--no-audio-fallback") {
      args.enableAudioFallback = false;
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
    } else if (token === "--whisper-model") {
      args.whisperModel = nextValue;
    } else if (token === "--whisper-language") {
      args.whisperLanguage = nextValue;
    } else if (token === "--audio-format") {
      args.audioFormat = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
    index += 1;
  }

  if (!args.video) {
    throw new Error(
      "Usage: node fetch_bilibili_transcript_auto.js <video-url-or-bvid> [--prefer-lang ai-zh] [--whisper-model small] [--whisper-language Chinese] [--audio-format m4a] [--no-audio-fallback] [--write-json path] [--pretty]"
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
      whisperModel: args.whisperModel,
      whisperLanguage: args.whisperLanguage,
      audioFormat: args.audioFormat,
      enableAudioFallback: args.enableAudioFallback,
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
