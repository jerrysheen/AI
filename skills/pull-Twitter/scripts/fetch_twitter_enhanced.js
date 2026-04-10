#!/usr/bin/env node

const https = require("node:https");
const http = require("node:http");
const path = require("node:path");

const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.nixnet.services",
];

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : require("node:http");
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, text/xml, */*;q=0.9",
        ...options.headers,
      },
      timeout: options.timeout || 20000,
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

    const isArticle = !!(
      (title && (title.includes("article") || title.includes("/article/"))) ||
      (cleanText && (cleanText.includes("article") || cleanText.includes("/article/"))) ||
      (description && description.includes("/article/"))
    );

    const hasVideo = !!(
      description && (
        description.includes("amplify_video_thumb") ||
        description.includes("video")
      )
    );

    const isShortContent = cleanText ? cleanText.length < 100 : true;
    const isOnlyLink = !!(cleanText && cleanText.match(/^(https?:\/\/|x\.com|twitter\.com)/i));

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
      is_article: isArticle,
      has_video: hasVideo,
      is_short_content: isShortContent,
      is_only_link: isOnlyLink,
      needs_chrome: isArticle || (isShortContent && isOnlyLink),
    });
  }

  return { channel_title: channelTitle, items };
}

function extractHtmlText(html) {
  if (!html) return null;
  return html
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchUserTweetsNitter(handle, options = {}) {
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

function getJsonViaHttp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(payload)); } catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.on("error", reject);
  });
}

function requestJsonViaHttp(method, url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(payload)); } catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.on("error", reject);
    request.end();
  });
}

function resolveWebSocketConstructor() {
  if (typeof WebSocket === "function") { return WebSocket; }
  const candidates = [
    path.resolve(__dirname, "..", "..", "ask-sider", "node_modules", "ws"),
    path.resolve(__dirname, "..", "..", "..", ".ai-data", "tmp", "ask-sider-runtime", "node_modules", "ws"),
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error("WebSocket runtime unavailable");
}

async function callCdp(wsUrl, actions) {
  const WebSocketImpl = resolveWebSocketConstructor();
  const socket = new WebSocketImpl(wsUrl);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) { reject(new Error(JSON.stringify(message.error))); }
    else { resolve(message.result); }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(event.error || new Error("CDP socket error")), { once: true });
  });

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try { return await actions(send); }
  finally {
    for (const { reject } of pending.values()) { reject(new Error("CDP socket closed")); }
    pending.clear();
    socket.close();
  }
}

async function getTwitterPageTarget(debugPort) {
  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://twitter.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open new page");
  }
  return { page: newPage, created: true };
}

async function fetchTweetWithChrome(tweetUrl) {
  const { getChromeDebugPort } = require("./runtime_shim");
  const { ensureTwitterBrowser } = require("./ensure_twitter_browser");

  const debugPort = await ensureTwitterBrowser();
  const target = await getTwitterPageTarget(debugPort);
  const { page } = target;

  try {
    const result = await callCdp(page.webSocketDebuggerUrl, async (send) => {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.navigate", { url: tweetUrl });
      await new Promise(r => setTimeout(r, 8000));

      const extractResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const results = {};
          results.title = document.title;

          const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
          results.metaDescription = metaDesc?.getAttribute('content');

          const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
          results.metaTitle = metaTitle?.getAttribute('content');

          let articleText = '';
          const articleEl = document.querySelector('article, [data-testid="tweet"], [data-testid="noteTweet"]');
          if (articleEl) {
            articleText = articleEl.innerText || '';
          }

          results.articleText = articleText;
          results.fullText = document.body?.innerText || '';

          return results;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      return extractResult.result.value;
    });

    let fullText = result.articleText || result.fullText || '';
    let cleanText = fullText;

    const handleMatch = result.metaTitle ? result.metaTitle.match(/@(\w+)/) : null;
    const authorHandle = handleMatch ? `@${handleMatch[1]}` : null;

    return {
      source: "chrome_cdp",
      title: result.metaTitle || result.title,
      text: cleanText,
      author_handle: authorHandle,
      _raw: result,
    };
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {}
    }
  }
}

async function fetchSingleTweetEnhanced(handle, tweetId, options = {}) {
  const nitterResult = await fetchUserTweetsNitter(handle, { limit: 100, ...options });
  const tweetFromNitter = nitterResult.tweets.find(t => t.tweet_id === tweetId);

  if (!tweetFromNitter) {
    return {
      source: "nitter_rss",
      instance: nitterResult.instance,
      found: false,
      searched_count: nitterResult.tweets.length,
      latest_tweets: nitterResult.tweets.slice(0, 5),
    };
  }

  const needsChrome = tweetFromNitter.needs_chrome || options.forceChrome;

  let enhancedTweet = { ...tweetFromNitter };
  let chromeResult = null;

  if (needsChrome) {
    try {
      const tweetUrl = `https://x.com/${handle}/status/${tweetId}`;
      chromeResult = await fetchTweetWithChrome(tweetUrl);

      if (chromeResult && chromeResult.text) {
        enhancedTweet = {
          ...enhancedTweet,
          full_text: chromeResult.text,
          text: chromeResult.text,
          enriched_by_chrome: true,
        };
      }
    } catch (e) {
      enhancedTweet.chrome_error = e.message;
    }
  }

  return {
    source: needsChrome ? "hybrid_nitter_chrome" : "nitter_rss",
    instance: nitterResult.instance,
    found: true,
    tweet: enhancedTweet,
    chrome_used: needsChrome,
    _chrome_result: chromeResult,
  };
}

async function fetchTwitterEnhanced(input, options = {}) {
  const parsed = parseInput(input);

  if (parsed.type === "tweet") {
    const result = await fetchSingleTweetEnhanced(parsed.handle, parsed.tweet_id, options);
    return {
      ...result,
      input_type: "tweet",
      input: parsed.original,
    };
  } else {
    const result = await fetchUserTweetsNitter(parsed.handle, options);

    if (options.enhanceWithChrome) {
      for (const tweet of result.tweets) {
        if (tweet.needs_chrome) {
          try {
            const tweetUrl = `https://x.com/${parsed.handle}/status/${tweet.tweet_id}`;
            const chromeData = await fetchTweetWithChrome(tweetUrl);
            if (chromeData && chromeData.text) {
              tweet.full_text = chromeData.text;
              tweet.text = chromeData.text;
              tweet.enriched_by_chrome = true;
            }
          } catch (e) {
            tweet.chrome_error = e.message;
          }
        }
      }
    }

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
    forceChrome: false,
    enhanceAll: false,
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
    if (token === "--force-chrome") {
      args.forceChrome = true;
      continue;
    }
    if (token === "--enhance-all") {
      args.enhanceAll = true;
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
      "Usage: node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js <input> [options]\n" +
      "\n" +
      "Options:\n" +
      "  --limit N          Number of tweets to fetch (default: 20)\n" +
      "  --force-chrome     Always use Chrome CDP, even for short tweets\n" +
      "  --enhance-all      Enhance all article/link tweets with Chrome\n" +
      "  --pretty           Pretty-print JSON output\n" +
      "\n" +
      "Examples:\n" +
      "  node fetch_twitter_enhanced.js @username\n" +
      "  node fetch_twitter_enhanced.js username --limit 10 --pretty\n" +
      "  node fetch_twitter_enhanced.js https://x.com/username/status/12345 --pretty"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await fetchTwitterEnhanced(args.input, {
      limit: args.limit,
      forceChrome: args.forceChrome,
      enhanceWithChrome: args.enhanceAll,
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
  fetchTwitterEnhanced,
  fetchUserTweetsNitter,
  fetchSingleTweetEnhanced,
  fetchTweetWithChrome,
  parseInput,
  parseRss,
  NITTER_INSTANCES,
};
