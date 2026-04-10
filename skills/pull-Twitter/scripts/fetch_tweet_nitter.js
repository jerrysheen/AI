#!/usr/bin/env node

const https = require("node:https");

const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.nixnet.services",
];

function fetchUrl(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : require("node:http");
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, text/xml, */*;q=0.9",
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function extractHtmlText(html) {
  if (!html) return null;
  return html
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseRss(xml) {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  if (!channelMatch) return { channel_title: null, items: [] };

  const channelXml = channelMatch[1];
  const channelTitleMatch = channelXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const channelTitle = channelTitleMatch ? channelTitleMatch[1].trim() : null;

  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const guidMatch = itemXml.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const creatorMatch = itemXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);

    const title = titleMatch ? titleMatch[1].trim() : null;
    const link = linkMatch ? linkMatch[1].trim() : null;
    const description = descMatch ? descMatch[1].trim() : null;
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : null;
    const guid = guidMatch ? guidMatch[1].trim() : null;
    const creator = creatorMatch ? creatorMatch[1].trim() : null;

    let tweetId = null;
    if (guid) {
      const tweetIdMatch = guid.match(/\/status\/(\d+)/) || guid.match(/^(\d+)$/);
      tweetId = tweetIdMatch ? tweetIdMatch[1] : null;
    }
    if (!tweetId && link) {
      const tweetIdMatch = link.match(/\/status\/(\d+)/);
      tweetId = tweetIdMatch ? tweetIdMatch[1] : null;
    }

    const cleanText = extractHtmlText(description);

    items.push({
      tweet_id: tweetId,
      tweet_url: link ? link.replace("https://nitter.net/", "https://x.com/").replace(/#m$/, "") : null,
      nitter_url: link,
      title,
      raw_description: description,
      text: cleanText,
      author_handle: creator,
      published_at: pubDate,
      published_timestamp: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null,
    });
  }

  return { channel_title: channelTitle, items };
}

function parseInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A Twitter username, @handle, or tweet URL is required.");
  }

  const tweetUrlMatch = value.match(/(twitter|x)\.com\/([^\/]+)\/status\/(\d+)/);
  if (tweetUrlMatch) {
    return {
      type: "tweet",
      handle: tweetUrlMatch[2],
      tweet_id: tweetUrlMatch[3],
      original: value,
    };
  }

  const handle = value.replace(/^@/, "").trim();
  if (handle) {
    return {
      type: "user",
      handle: handle,
      original: value,
    };
  }

  throw new Error(`Unable to parse input: ${value}`);
}

async function fetchWithFallback(instances, pathBuilder) {
  let lastError = null;
  for (const instance of instances) {
    try {
      const url = pathBuilder(instance);
      const result = await fetchUrl(url);
      if (result.status === 200 && result.body) {
        return { success: true, instance, result };
      }
      lastError = new Error(`HTTP ${result.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  return { success: false, error: lastError };
}

async function fetchUserTweets(handle, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 20);
  const instances = options.instances || NITTER_INSTANCES;

  const fetchResult = await fetchWithFallback(instances, (instance) => `${instance}/${handle}/rss`);
  if (!fetchResult.success) {
    throw fetchResult.error || new Error("Failed to fetch from all Nitter instances");
  }

  const parsed = parseRss(fetchResult.result.body);
  const tweets = parsed.items.slice(0, limit);

  return {
    source: "nitter_rss",
    instance: fetchResult.instance,
    user_ref: `@${handle}`,
    handle: handle,
    channel_title: parsed.channel_title,
    tweet_count: tweets.length,
    tweets: tweets,
  };
}

async function fetchSingleTweet(handle, tweetId, options = {}) {
  const instances = options.instances || NITTER_INSTANCES;

  const userResult = await fetchUserTweets(handle, { limit: 100, instances });
  const found = userResult.tweets.find(t => t.tweet_id === tweetId);

  if (found) {
    return {
      source: "nitter_rss",
      instance: userResult.instance,
      found: true,
      tweet: found,
    };
  }

  return {
    source: "nitter_rss",
    instance: userResult.instance,
    found: false,
    searched_count: userResult.tweets.length,
    latest_tweets: userResult.tweets.slice(0, 5),
  };
}

async function fetchTwitter(input, options = {}) {
  const parsed = parseInput(input);

  if (parsed.type === "tweet") {
    const result = await fetchSingleTweet(parsed.handle, parsed.tweet_id, options);
    return {
      ...result,
      input_type: "tweet",
      input: parsed.original,
    };
  } else {
    const result = await fetchUserTweets(parsed.handle, options);
    return {
      ...result,
      input_type: "user",
      input: parsed.original,
    };
  }
}

function parseArgs(argv) {
  const args = {
    input: null,
    pretty: false,
    limit: 20,
    instances: null,
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
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/pull-Twitter/scripts/fetch_tweet_nitter.js <input> [--limit 20] [--pretty]\n" +
      "\n" +
      "Examples:\n" +
      "  node fetch_tweet_nitter.js @username\n" +
      "  node fetch_tweet_nitter.js username\n" +
      "  node fetch_tweet_nitter.js https://x.com/username/status/12345 --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchTwitter(args.input, {
      limit: args.limit,
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
  fetchTwitter,
  fetchUserTweets,
  fetchSingleTweet,
  parseInput,
  parseRss,
  NITTER_INSTANCES,
};
