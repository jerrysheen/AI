---
name: pull-Twitter
description: Fetch tweets from Twitter/X without login using Nitter RSS and Chrome CDP. Trigger this skill when the user provides a Twitter/X username, @handle, or tweet URL and wants to read tweet content, including longform articles/notes.
---

# Pull Twitter Tweets (No Login Required, with Article Support)

Use this skill when the user wants Twitter/X tweets without requiring login, including support for longform articles/notes.

Primary entrypoints:

- `node skills/pull-Twitter/scripts/fetch_twitter_enhanced.js "<username-or-handle-or-tweet-url>" --limit 20 --pretty`

Workflow:

1. Accept a Twitter/X username, `@handle`, or full tweet URL.
2. First try the public RSS feed from a Nitter instance (privacy-focused Twitter frontend).
3. Detect tweet type: normal short tweet, longform article/note, video tweet, or link-only tweet.
4. For longform articles/notes or link-only tweets, automatically use Chrome CDP to fetch the complete article content.
5. Return the tweet data as structured JSON, with enriched content when available.

Output contract:

- `source` identifies the data source ("nitter_rss" or "hybrid_nitter_chrome").
- `instance` records which Nitter instance was used.
- `chrome_used` indicates whether Chrome CDP was used for enrichment.
- `input_type` is either "user" (timeline) or "tweet" (single tweet).
- For user timelines: `user_ref`, `handle`, `channel_title`, `tweet_count`, `tweets`.
- For single tweets: `found` (boolean), `tweet` (if found).
- Each tweet includes `tweet_id`, `tweet_url`, `text`, `author_handle`, `published_at`, `published_timestamp`.
- Type detection: `is_article`, `has_video`, `is_short_content`, `is_only_link`, `needs_chrome`, `enriched_by_chrome`.
