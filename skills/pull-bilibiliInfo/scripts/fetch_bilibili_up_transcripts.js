#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getBilibiliRunsDir, getChromeDebugPort } = require("./runtime_shim");
const { upsertContentCache } = require("./content_cache_shim");

const { fetchBilibiliSubtitle } = require("./fetch_bilibili_subtitle");
const { downloadBilibiliAudio } = require("./fetch_bilibili_audio");
const { listUpVideos } = require("./list_bilibili_up_videos");
const { transcribeBilibiliAudio } = require("./transcribe_bilibili_audio");

function formatRunId(date = new Date()) {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function buildManifest({ runId, target, listing, outputRoot }) {
  return {
    run_id: runId,
    target,
    generated_at: new Date().toISOString(),
    mid: listing.mid,
    space_url: listing.space_url,
    upload_url: listing.upload_url,
    filters: listing.filters || {
      published_after: null,
      published_before: null,
    },
    video_count: listing.video_count,
    output_root: outputRoot,
    videos: listing.videos.map((video) => ({
      bvid: video.bvid,
      title: video.title,
      video_url: video.video_url,
      publish_time: video.publish_time,
      publish_timestamp: video.publish_timestamp || null,
      status: "pending",
      output_file: null,
      cache_file: null,
      audio_file: null,
      asr_file: null,
      transcript_source: null,
      error: null,
    })),
  };
}

async function fetchUpTranscripts(target, options = {}) {
  const runId = options.runId || formatRunId();
  const baseOutputDir = path.resolve(options.outputDir || getBilibiliRunsDir());
  const runDir = path.join(baseOutputDir, sanitizeFilename(runId));
  const videosDir = path.join(runDir, "videos");
  ensureDir(videosDir);

  const listing = await listUpVideos(target, {
    limit: options.limit,
    waitMs: options.waitMs,
    debugPort: options.debugPort,
    publishedAfter: options.publishedAfter,
    publishedBefore: options.publishedBefore,
  });

  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = buildManifest({
    runId,
    target,
    listing,
    outputRoot: runDir,
  });
  writeJson(manifestPath, manifest);

  for (const entry of manifest.videos) {
    try {
      const transcript = await fetchBilibiliSubtitle(entry.bvid, options.preferLang || "ai-zh", "", {
        includeSegments: false,
        debugPort: options.debugPort,
      });

      let finalTranscript = transcript;
      let transcriptSource = transcript.error ? null : "subtitle";
      let audioResult = null;
      let asrResult = null;

      if (transcript.error && options.enableAudioFallback !== false) {
        audioResult = downloadBilibiliAudio(entry.video_url, {
          audioFormat: options.audioFormat || "m4a",
          timeoutMs: options.audioTimeoutMs,
        });

        asrResult = transcribeBilibiliAudio(audioResult.audio_file, {
          model: options.whisperModel || "small",
          language: options.whisperLanguage || "Chinese",
          timeoutMs: options.asrTimeoutMs,
        });

        finalTranscript = {
          ...transcript,
          subtitle_lang: null,
          subtitle_lang_doc: null,
          has_ai_subtitle: false,
          full_text: asrResult.transcript_text,
          error: asrResult.transcript_text ? null : "ASR completed but transcript text was empty.",
          asr_used: true,
          asr_model: asrResult.model,
          asr_transcript_file: asrResult.transcript_file,
        };
        transcriptSource = "audio_asr";
      }

      const outputFile = path.join(videosDir, `${sanitizeFilename(entry.bvid)}.json`);
      writeJson(outputFile, {
        ...finalTranscript,
        source_mid: manifest.mid,
        source_space_url: manifest.space_url,
        publish_time: entry.publish_time,
        publish_timestamp: entry.publish_timestamp,
        transcript_source: transcriptSource,
        audio_file: audioResult ? audioResult.audio_file : null,
        asr_file: asrResult ? asrResult.transcript_file : null,
      });

      entry.status = finalTranscript.error ? "error" : "done";
      entry.output_file = outputFile;
      entry.audio_file = audioResult ? audioResult.audio_file : null;
      entry.asr_file = asrResult ? asrResult.transcript_file : null;
      entry.transcript_source = transcriptSource;
      entry.error = finalTranscript.error || null;
      entry.cache_file = null;

      if (!finalTranscript.error) {
        const cacheResult = upsertContentCache({
          source: "bilibili",
          category: "transcripts",
          contentId: entry.bvid,
          publishedAt: entry.publish_time,
          record: {
            bvid: entry.bvid,
            title: finalTranscript.title || entry.title,
            publish_time: entry.publish_time,
            publish_timestamp: entry.publish_timestamp,
            subtitle_lang: finalTranscript.subtitle_lang,
            has_ai_subtitle: finalTranscript.has_ai_subtitle,
            full_text: finalTranscript.full_text,
            transcript_source: transcriptSource,
            audio_file: audioResult ? audioResult.audio_file : null,
            asr_file: asrResult ? asrResult.transcript_file : null,
            source_ref: manifest.space_url,
            video_url: entry.video_url,
            run_id: manifest.run_id,
            manifest_path: manifestPath,
            transcript_file: outputFile,
          },
        });
        entry.cache_file = cacheResult.file_path;
      }
    } catch (error) {
      entry.status = "error";
      entry.output_file = null;
      entry.cache_file = null;
      entry.error = error instanceof Error ? error.message : String(error);
    }

    writeJson(manifestPath, manifest);
  }

  return {
    run_id: manifest.run_id,
    manifest_path: manifestPath,
    output_root: runDir,
    total_videos: manifest.video_count,
    done_count: manifest.videos.filter((item) => item.status === "done").length,
    error_count: manifest.videos.filter((item) => item.status === "error").length,
    videos: manifest.videos,
  };
}

function parseArgs(argv) {
  const args = {
    target: null,
    pretty: false,
    limit: 12,
    waitMs: 8000,
    debugPort: getChromeDebugPort(),
    publishedAfter: null,
    publishedBefore: null,
    outputDir: null,
    preferLang: "ai-zh",
    whisperModel: "small",
    whisperLanguage: "Chinese",
    audioFormat: "m4a",
    enableAudioFallback: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      if (!args.target) {
        args.target = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--pretty") {
      args.pretty = true;
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

    if (token === "--limit") {
      args.limit = Number(nextValue);
    } else if (token === "--wait-ms") {
      args.waitMs = Number(nextValue);
    } else if (token === "--debug-port") {
      args.debugPort = Number(nextValue);
    } else if (token === "--published-after") {
      args.publishedAfter = nextValue;
    } else if (token === "--published-before") {
      args.publishedBefore = nextValue;
    } else if (token === "--output-dir") {
      args.outputDir = nextValue;
    } else if (token === "--prefer-lang") {
      args.preferLang = nextValue;
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

  if (!args.target) {
    throw new Error(
      "Usage: node fetch_bilibili_up_transcripts.js <space-url-or-mid> [--published-after 2026-01-01] [--published-before 2026-12-31] [--limit 12] [--output-dir .\\.ai-data\\bilibili\\runs] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchUpTranscripts(args.target, {
      limit: args.limit,
      waitMs: args.waitMs,
      debugPort: args.debugPort,
      publishedAfter: args.publishedAfter,
      publishedBefore: args.publishedBefore,
      outputDir: args.outputDir,
      preferLang: args.preferLang,
      whisperModel: args.whisperModel,
      whisperLanguage: args.whisperLanguage,
      audioFormat: args.audioFormat,
      enableAudioFallback: args.enableAudioFallback,
    });
    process.stdout.write(`${JSON.stringify(result, null, args.pretty ? 2 : 0)}\n`);
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
  fetchUpTranscripts,
  formatRunId,
  parseArgs,
};
