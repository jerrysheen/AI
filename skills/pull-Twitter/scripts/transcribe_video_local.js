#!/usr/bin/env node

const { transcribeLocalMedia } = require("../../autoTranslate/scripts/transcribe_local_media");

function parseArgs(argv) {
  const args = {
    input: null,
    modelSize: null,
    language: null,
    threads: null,
    outputDir: null,
    startSeconds: null,
    clipSeconds: null,
    keepWav: false,
    prompt: "",
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

    if (token === "--keep-wav") {
      args.keepWav = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--model-size":
        args.modelSize = String(nextValue).trim();
        break;
      case "--language":
        args.language = String(nextValue).trim();
        break;
      case "--threads":
        args.threads = Number(nextValue);
        break;
      case "--output-dir":
        args.outputDir = nextValue;
        break;
      case "--start-seconds":
        args.startSeconds = Number(nextValue);
        break;
      case "--clip-seconds":
        args.clipSeconds = Number(nextValue);
        break;
      case "--prompt":
        args.prompt = String(nextValue);
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/pull-Twitter/scripts/transcribe_video_local.js <media-file> [options]\n" +
      "\n" +
      "This command is a compatibility wrapper around skills/autoTranslate.\n" +
      "\n" +
      "Options:\n" +
      "  --model-size tiny|base|small   Whisper model size\n" +
      "  --language auto|zh|en          Whisper language\n" +
      "  --threads N                    CPU threads for whisper-cli\n" +
      "  --output-dir PATH              Run output directory\n" +
      "  --start-seconds N              Clip start offset in seconds\n" +
      "  --clip-seconds N               Only transcribe the first N seconds from start offset\n" +
      "  --prompt TEXT                  Initial prompt for whisper\n" +
      "  --keep-wav                     Keep extracted wav file\n"
    );
  }

  if (args.threads !== null && (!Number.isFinite(args.threads) || args.threads < 1)) {
    throw new Error(`Invalid thread count: ${args.threads}`);
  }
  if (args.startSeconds !== null && (!Number.isFinite(args.startSeconds) || args.startSeconds < 0)) {
    throw new Error(`Invalid start seconds: ${args.startSeconds}`);
  }
  if (args.clipSeconds !== null && (!Number.isFinite(args.clipSeconds) || args.clipSeconds < 0)) {
    throw new Error(`Invalid clip seconds: ${args.clipSeconds}`);
  }

  return args;
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const summary = await transcribeLocalMedia(cliArgs.input, {
    modelSize: cliArgs.modelSize || undefined,
    language: cliArgs.language || undefined,
    threads: cliArgs.threads || undefined,
    outputDir: cliArgs.outputDir || undefined,
    startSeconds: cliArgs.startSeconds || undefined,
    clipSeconds: cliArgs.clipSeconds || undefined,
    prompt: cliArgs.prompt || undefined,
    keepWav: cliArgs.keepWav,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  transcribeVideoLocal: transcribeLocalMedia,
};
