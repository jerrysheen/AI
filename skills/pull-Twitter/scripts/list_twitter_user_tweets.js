#!/usr/bin/env node

const http = require("node:http");
const path = require("node:path");
const { getChromeDebugPort } = require("./runtime_shim");
const { ensureTwitterBrowser } = require("./ensure_twitter_browser");

function normalizeUserInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A Twitter username or URL is required.");
  }

  if (value.startsWith("@")) {
    const handle = value.slice(1);
    return {
      user_ref: value,
      handle: handle,
      profile_url: `https://twitter.com/${handle}`,
    };
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!hostname.includes("twitter.com") && !hostname.includes("x.com")) {
      throw new Error("Not a Twitter/X URL.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) {
      throw new Error("Missing username path.");
    }
    const handle = parts[0];
    return {
      user_ref: `@${handle}`,
      handle: handle,
      profile_url: `https://twitter.com/${handle}`,
    };
  } catch {
    const handle = value.replace(/^@/, "").trim();
    if (!handle) {
      throw new Error(`Unable to normalize Twitter user input: ${input}`);
    }
    return {
      user_ref: `@${handle}`,
      handle: handle,
      profile_url: `https://twitter.com/${handle}`,
    };
  }
}

function getJsonViaHttp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        payload += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${payload.slice(0, 500)}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
    request.on("error", reject);
  });
}

function requestJsonViaHttp(method, url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      let payload = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        payload += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${payload.slice(0, 500)}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
    request.on("error", reject);
    request.end();
  });
}

function resolveWebSocketConstructor() {
  if (typeof WebSocket === "function") {
    return WebSocket;
  }

  const candidates = [
    path.resolve(__dirname, "..", "..", "ask-sider", "node_modules", "ws"),
    path.resolve(__dirname, "..", "..", "..", ".ai-data", "tmp", "ask-sider-runtime", "node_modules", "ws"),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("WebSocket runtime is unavailable. Install or reuse the existing ws dependency first.");
}

async function callCdp(wsUrl, actions) {
  const WebSocketImpl = resolveWebSocketConstructor();
  const socket = new WebSocketImpl(wsUrl);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
      return;
    }
    resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(event.error || new Error("CDP socket error")), {
      once: true,
    });
  });

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    return await actions(send);
  } finally {
    for (const { reject } of pending.values()) {
      reject(new Error("CDP socket closed before reply was received."));
    }
    pending.clear();
    socket.close();
  }
}

async function getTwitterPageTarget(debugPort = getChromeDebugPort()) {
  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://twitter.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open a new Twitter page in Chrome.");
  }
  return {
    page: newPage,
    created: true,
  };
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return Math.floor(parsed / 1000);
}

function toIsoOrNull(input) {
  const parsed = Date.parse(String(input || ""));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

async function collectTweets(send, profileUrl, limit, scrollRounds) {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: profileUrl });
  await new Promise((resolve) => setTimeout(resolve, 5000));

  for (let round = 0; round < scrollRounds; round += 1) {
    await send("Runtime.evaluate", {
      expression: `window.scrollTo(0, document.documentElement.scrollHeight);`,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const expression = `(async () => {
    const getText = (el) => el ? el.textContent || '' : '';

    const tweetArticles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const items = tweetArticles.map((article) => {
      try {
        const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
        const text = tweetTextEl ? tweetTextEl.textContent.trim() : '';

        const timeEl = article.querySelector('time');
        const time = timeEl ? timeEl.getAttribute('datetime') : null;

        const linkEl = article.querySelector('a[href*="/status/"]');
        const tweetUrl = linkEl ? (linkEl.href.startsWith('http') ? linkEl.href : 'https://twitter.com' + linkEl.href) : null;

        let tweetId = null;
        if (tweetUrl) {
          const match = tweetUrl.match(/\\/status\\/(\\d+)/);
          tweetId = match ? match[1] : null;
        }

        const authorEl = article.querySelector('[data-testid="User-Name"]');
        let authorHandle = null;
        let authorName = null;
        if (authorEl) {
          const links = authorEl.querySelectorAll('a');
          if (links.length >= 2) {
            authorName = getText(links[0]);
            authorHandle = getText(links[1]).replace('@', '');
          }
        }

        const stats = {};
        const replyBtn = article.querySelector('[data-testid="reply"]');
        const retweetBtn = article.querySelector('[data-testid="retweet"]');
        const likeBtn = article.querySelector('[data-testid="like"]');
        const viewEl = article.querySelector('a[href*="/analytics"]');

        if (replyBtn) stats.replies = getText(replyBtn);
        if (retweetBtn) stats.retweets = getText(retweetBtn);
        if (likeBtn) stats.likes = getText(likeBtn);
        if (viewEl) stats.views = getText(viewEl);

        return {
          tweet_id: tweetId,
          tweet_url: tweetUrl,
          text: text,
          author_handle: authorHandle,
          author_name: authorName,
          posted_at: time,
          posted_timestamp: time ? Math.floor(new Date(time).getTime() / 1000) : null,
          stats: stats
        };
      } catch (e) {
        return null;
      }
    }).filter((item) => item && item.tweet_id && item.text);

    const unique = [];
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.tweet_id)) continue;
      seen.add(item.tweet_id);
      unique.push(item);
    }

    return {
      items: unique
    };
  })()`;

  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = result.result.value || {};
  const unique = [];
  const seen = new Set();
  for (const item of value.items || []) {
    if (seen.has(item.tweet_id)) {
      continue;
    }
    seen.add(item.tweet_id);
    unique.push(item);
    if (unique.length >= limit) {
      break;
    }
  }

  return {
    items: unique,
  };
}

function filterTweetsByTime(tweets, after, before) {
  return tweets.filter((tweet) => {
    const timestamp = Number(tweet.posted_timestamp) || 0;
    if (after && (!timestamp || timestamp < after)) {
      return false;
    }
    if (before && (!timestamp || timestamp > before)) {
      return false;
    }
    return true;
  });
}

async function listTwitterUserTweets(input, options = {}) {
  const user = normalizeUserInput(input);
  const after = parseDateInput(options.postedAfter);
  const before = parseDateInput(options.postedBefore);
  const limit = Math.max(1, Number(options.limit) || 20);
  const scrollRounds = Math.max(1, Number(options.scrollRounds) || 5);
  const debugPort = await ensureTwitterBrowser();
  const target = await getTwitterPageTarget(Number(options.debugPort || debugPort || getChromeDebugPort()));
  const { page } = target;

  try {
    const listing = await callCdp(page.webSocketDebuggerUrl, async (send) => {
      const cards = await collectTweets(send, user.profile_url, limit, scrollRounds);
      return {
        items: cards.items,
      };
    });

    const filteredTweets = filterTweetsByTime(listing.items, after, before);

    return {
      user_ref: user.user_ref,
      handle: user.handle,
      profile_url: user.profile_url,
      filters: {
        posted_after: after ? new Date(after * 1000).toISOString() : null,
        posted_before: before ? new Date(before * 1000).toISOString() : null,
      },
      tweet_count: filteredTweets.length,
      tweets: filteredTweets,
    };
  } finally {
    if (target.created) {
      try {
        await requestJsonViaHttp("PUT", `http://127.0.0.1:${debugPort}/json/close/${page.id}`, 10000);
      } catch {
        // Best effort cleanup only.
      }
    }
  }
}

function parseArgs(argv) {
  const args = {
    input: null,
    pretty: false,
    limit: 20,
    scrollRounds: 5,
    debugPort: getChromeDebugPort(),
    postedAfter: null,
    postedBefore: null,
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
    } else if (token === "--posted-after") {
      args.postedAfter = nextValue;
    } else if (token === "--posted-before") {
      args.postedBefore = nextValue;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 1;
  }

  if (!args.input) {
    throw new Error(
      "Usage: node skills/pull-Twitter/scripts/list_twitter_user_tweets.js <username-or-url> [--posted-after 2026-03-01] [--posted-before 2026-03-31] [--limit 20] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await listTwitterUserTweets(args.input, {
      limit: args.limit,
      scrollRounds: args.scrollRounds,
      debugPort: args.debugPort,
      postedAfter: args.postedAfter,
      postedBefore: args.postedBefore,
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
  listTwitterUserTweets,
  normalizeUserInput,
  parseArgs,
};
