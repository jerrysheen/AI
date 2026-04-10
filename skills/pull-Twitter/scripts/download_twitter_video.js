#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const SYNDICATION_ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result";

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    bitrate: null,
    pretty: false,
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

    if (token === "--output") {
      args.output = nextValue;
    } else if (token === "--bitrate") {
      args.bitrate = Number(nextValue);
      if (!Number.isFinite(args.bitrate) || args.bitrate <= 0) {
        throw new Error(`Invalid bitrate: ${nextValue}`);
      }
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node scripts/download_twitter_video.js <tweet-url-or-id> [--output <path>] [--bitrate <n>] [--pretty]\n" +
      "\n" +
      "Examples:\n" +
      "  node scripts/download_twitter_video.js \"https://x.com/user/status/12345\" --pretty\n" +
      "  node scripts/download_twitter_video.js 12345 --bitrate 832000 --output assets/downloads/sample.mp4"
    );
  }

  return args;
}

function parseTweetInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A tweet URL or tweet id is required.");
  }

  const match = value.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i);
  if (match) {
    return { tweetId: match[1], original: value };
  }

  if (/^\d{6,25}$/.test(value)) {
    return { tweetId: value, original: value };
  }

  throw new Error(`Unable to parse tweet input: ${value}`);
}

function fetchJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
      },
      timeout: timeoutMs,
    }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        payload += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Unexpected HTTP ${response.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(payload));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    });

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`Request timeout for ${url}`));
    });
  });
}

function sanitizeSegment(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildDefaultOutputPath(metadata) {
  const downloadsDir = path.resolve(process.cwd(), "assets", "downloads");
  const handle = sanitizeSegment(metadata.author_handle || metadata.screen_name || "twitter");
  const tweetId = sanitizeSegment(metadata.tweet_id || "tweet");
  const bitrate = metadata.selected_variant?.bitrate || "adaptive";
  const filename = `${handle}-${tweetId}-${bitrate}.mp4`;
  return path.join(downloadsDir, filename);
}

function selectVariant(variants, preferredBitrate) {
  const mp4Variants = (Array.isArray(variants) ? variants : [])
    .filter((item) => item && item.content_type === "video/mp4" && item.url)
    .sort((left, right) => (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0));

  if (!mp4Variants.length) {
    return null;
  }

  if (preferredBitrate) {
    const exact = mp4Variants.find((item) => Number(item.bitrate) === preferredBitrate);
    if (exact) {
      return exact;
    }

    const belowPreferred = mp4Variants.find((item) => Number(item.bitrate) <= preferredBitrate);
    if (belowPreferred) {
      return belowPreferred;
    }
  }

  return mp4Variants[0];
}

async function fetchTweetVideoMetadata(tweetId, preferredBitrate) {
  const url = `${SYNDICATION_ENDPOINT}?id=${encodeURIComponent(tweetId)}&token=x`;
  const payload = await fetchJson(url);

  const mediaDetails = Array.isArray(payload.mediaDetails) ? payload.mediaDetails : [];
  const videoMedia = mediaDetails.find((item) => item && item.type === "video" && item.video_info);
  if (!videoMedia) {
    throw new Error("No video media was found for this tweet.");
  }

  const selectedVariant = selectVariant(videoMedia.video_info.variants, preferredBitrate);
  if (!selectedVariant) {
    throw new Error("No downloadable MP4 variant was found for this tweet.");
  }

  return {
    tweet_id: payload.id_str || tweetId,
    text: payload.text || "",
    created_at: payload.created_at || null,
    author_name: payload.user?.name || null,
    author_handle: payload.user?.screen_name ? `@${payload.user.screen_name}` : null,
    screen_name: payload.user?.screen_name || null,
    video_duration_millis: videoMedia.video_info?.duration_millis || null,
    thumbnail_url: videoMedia.media_url_https || null,
    expanded_url: videoMedia.expanded_url || null,
    selected_variant: selectedVariant,
    all_variants: videoMedia.video_info?.variants || [],
  };
}

function downloadFile(url, destinationPath, timeoutMs = 60000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects while downloading video."));
      return;
    }

    const fileStream = fs.createWriteStream(destinationPath);
    const request = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: timeoutMs,
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        fileStream.close();
        fs.rmSync(destinationPath, { force: true });
        downloadFile(response.headers.location, destinationPath, timeoutMs, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        fileStream.close();
        fs.rmSync(destinationPath, { force: true });
        reject(new Error(`Unexpected HTTP ${response.statusCode} while downloading video.`));
        return;
      }

      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(() => {
          const stats = fs.statSync(destinationPath);
          resolve({
            bytes: stats.size,
            content_type: response.headers["content-type"] || null,
          });
        });
      });
    });

    request.on("error", (error) => {
      fileStream.close();
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    });

    request.on("timeout", () => {
      request.destroy(new Error("Video download timed out."));
    });

    fileStream.on("error", (error) => {
      request.destroy(error);
    });
  });
}

async function downloadTwitterVideo(input, options = {}) {
  const parsed = parseTweetInput(input);
  const metadata = await fetchTweetVideoMetadata(parsed.tweetId, options.bitrate || null);
  const outputPath = path.resolve(options.output || buildDefaultOutputPath(metadata));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const downloadResult = await downloadFile(metadata.selected_variant.url, outputPath);

  return {
    source: "twitter_syndication_video",
    input: parsed.original,
    tweet_id: metadata.tweet_id,
    author_name: metadata.author_name,
    author_handle: metadata.author_handle,
    created_at: metadata.created_at,
    text: metadata.text,
    selected_variant: metadata.selected_variant,
    output_path: outputPath,
    file_size_bytes: downloadResult.bytes,
    content_type: downloadResult.content_type,
    thumbnail_url: metadata.thumbnail_url,
    expanded_url: metadata.expanded_url,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await downloadTwitterVideo(args.input, {
      output: args.output,
      bitrate: args.bitrate,
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
  downloadTwitterVideo,
  fetchTweetVideoMetadata,
};
