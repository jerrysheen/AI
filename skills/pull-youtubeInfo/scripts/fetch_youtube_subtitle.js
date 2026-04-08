#!/usr/bin/env node

const cp = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { getChromeDebugPort } = require("./runtime_shim");
const DEFAULT_TASK_TIMEOUT_MS = 60000;
const FINALIZATION_GRACE_MS = 15000;

function extractVideoId(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A YouTube URL or video id is required.");
  }

  if (/^[A-Za-z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.replace(/^\/+/, "").split("/")[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }

    if (url.hostname.includes("youtube.com")) {
      const direct = url.searchParams.get("v");
      if (/^[A-Za-z0-9_-]{11}$/.test(direct || "")) {
        return direct;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const candidate = parts[1] || "";
      if ((parts[0] === "shorts" || parts[0] === "embed") && /^[A-Za-z0-9_-]{11}$/.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall through to final error.
  }

  throw new Error(`Unable to extract YouTube video id from input: ${input}`);
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
      // Try the next location.
    }
  }

  throw new Error("WebSocket runtime is unavailable. Install or reuse the existing ws dependency first.");
}

async function callCdp(wsUrl, actions) {
  const WebSocketImpl = resolveWebSocketConstructor();
  const socket = new WebSocketImpl(wsUrl);
  const pending = new Map();
  let nextId = 0;
  const eventListeners = new Set();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) {
      for (const listener of eventListeners) {
        listener(message);
      }
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
    return await actions(send, {
      onEvent(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
    });
  } finally {
    for (const { reject } of pending.values()) {
      reject(new Error("CDP socket closed before reply was received."));
    }
    pending.clear();
    socket.close();
  }
}

async function getYouTubePageTarget(debugPort) {
  const newPage = await requestJsonViaHttp(
    "PUT",
    `http://127.0.0.1:${debugPort}/json/new?https://www.youtube.com`,
    15000
  );
  if (!newPage || !newPage.webSocketDebuggerUrl) {
    throw new Error("Could not open a new YouTube page in Chrome.");
  }

  return {
    page: newPage,
    created: true,
  };
}

function createTimeoutError(timeoutMs) {
  const seconds = Math.floor(timeoutMs / 1000);
  return new Error(
    `Transcript fetch exceeded ${seconds}s and was stopped. This video currently cannot be fetched for subtitles.`
  );
}

async function withTimeout(taskPromise, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      taskPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function ensureBrowser(debugPort) {
  try {
    const scriptPath = path.resolve(__dirname, "ensure_youtube_browser.js");
    const result = cp.spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        AI_CHROME_DEBUG_PORT: String(debugPort || getChromeDebugPort()),
      },
    });

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      throw new Error(stderr || "Failed to ensure YouTube browser session.");
    }

    const resolvedPort = Number(String(result.stdout || "").trim());
    return Number.isFinite(resolvedPort) ? resolvedPort : debugPort;
  } catch (error) {
    throw new Error(
      `Could not start or connect to the YouTube Chrome session: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function normalizeTrack(track) {
  return {
    base_url: track.baseUrl || null,
    language_code: track.languageCode || null,
    name:
      track.name?.simpleText ||
      (Array.isArray(track.name?.runs) ? track.name.runs.map((item) => item.text).join("") : null),
    kind: track.kind || null,
    vss_id: track.vssId || null,
    is_translatable: Boolean(track.isTranslatable),
  };
}

function parseJson3Events(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const segments = [];

  for (const event of events) {
    const startMs = Number(event?.tStartMs);
    const durationMs = Number(event?.dDurationMs || 0);
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    const text = segs.map((item) => item?.utf8 || "").join("").replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }

    segments.push({
      start: Number.isFinite(startMs) ? startMs / 1000 : null,
      duration: Number.isFinite(durationMs) ? durationMs / 1000 : null,
      text,
    });
  }

  return {
    segments,
    fullText: segments.map((item) => item.text).join("\n").trim(),
  };
}

function parseTranscriptPanelResponse(payload) {
  const segments = [];

  function visit(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const segment = value.transcriptSegmentViewModel;
    if (segment && segment.simpleText) {
      segments.push({
        start: segment.startMs ? Number(segment.startMs) / 1000 : null,
        timestamp: segment.timestamp || null,
        text: String(segment.simpleText).trim(),
      });
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(payload);

  return {
    segments: segments.filter((item) => item.text),
    fullText: segments
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n")
      .trim(),
  };
}

function normalizeDomTranscriptSegments(items) {
  const ignoredTexts = new Set(["未找到任何结果", "No results found"]);
  const seen = new Set();
  const segments = [];

  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item?.text || "").replace(/\s+/g, " ").trim();
    const timestamp = item?.timestamp || null;
    if (!text || ignoredTexts.has(text)) {
      continue;
    }

    const key = `${timestamp || ""}\u0000${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    segments.push({
      start: item?.start ?? null,
      timestamp,
      text,
    });
  }

  return {
    segments,
    fullText: segments.map((item) => item.text).join("\n").trim(),
  };
}

async function fetchYouTubeSubtitle(input, options = {}) {
  const debugPort = ensureBrowser(Number(options.debugPort || getChromeDebugPort()));
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TASK_TIMEOUT_MS);
  const videoId = extractVideoId(input);
  const target = await getYouTubePageTarget(debugPort);
  const { page } = target;

  const result = {
    video_id: videoId,
    title: null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    requested_subtitle_lang: options.preferLang || "",
    subtitle_lang: null,
    subtitle_name: null,
    available_subtitles: [],
    has_auto_subtitle: false,
    transcript_source: null,
    full_text: "",
    segments: [],
    error: null,
  };

  try {
    const payload = await withTimeout(callCdp(page.webSocketDebuggerUrl, async (send, cdp) => {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Network.enable");
      await send("Page.navigate", { url: result.url });
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const panelBodies = [];
      const removeListener = cdp.onEvent((message) => {
        if (message.method !== "Network.responseReceived") {
          return;
        }

        const url = String(message.params?.response?.url || "");
        if (!url.includes("/youtubei/v1/get_panel")) {
          return;
        }
        panelBodies.push(message.params.requestId);
      });

      const expression = `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const pollIntervalMs = 5000;
        const settleIdleMs = 10000;
        // Reserve time for initial page settle, CDP round-trips, and response body collection.
        const deadlineMs = Date.now() + Math.max(15000, ${JSON.stringify(timeoutMs)} - 15000);
        const clickFirst = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              element.click();
              return true;
            }
          }
          return false;
        };
        const adSkipSelectors = [
          '.ytp-ad-skip-button',
          '.ytp-ad-skip-button-modern',
          'button.ytp-skip-ad-button',
          '.ytp-skip-ad-button',
          '.ytp-ad-skip-button-slot button'
        ];
        const adDismissSelectors = [
          '.ytp-ad-overlay-close-button',
          '.ytp-ad-overlay-close-container button',
          'button[aria-label*="Close ad"]',
          'button[aria-label*="关闭广告"]'
        ];
        const isAdBlocking = () => Boolean(document.querySelector(
          '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-module, .ytp-ad-overlay-container, .video-ads'
        ));
        const ensureNoAdBlocking = async (maxRounds = 12) => {
          let rounds = 0;
          for (; rounds < maxRounds; rounds += 1) {
            const adShowing = isAdBlocking();
            const skipVisible = adSkipSelectors.some((selector) => document.querySelector(selector));
            const dismissVisible = adDismissSelectors.some((selector) => document.querySelector(selector));
            const skipped = clickFirst(adSkipSelectors);
            const dismissed = clickFirst(adDismissSelectors);
            if (!adShowing && !skipVisible && !dismissVisible && !skipped && !dismissed) {
              break;
            }
            await wait(skipped || dismissed ? 1200 : 2000);
          }
          return rounds;
        };
        const preferredLang = ${JSON.stringify(options.preferLang || "")};
        const readPlayerResponse = () => {
          const raw = window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.player_response;
          let playerResponse = raw;
          if (typeof playerResponse === 'string') {
            try {
              playerResponse = JSON.parse(playerResponse);
            } catch {}
          }
          if (!playerResponse && typeof window.ytplayer?.config?.args?.raw_player_response === 'string') {
            try {
              playerResponse = JSON.parse(window.ytplayer.config.args.raw_player_response);
            } catch {}
          }
          return playerResponse || null;
        };
        const pickTrack = (tracks) => {
          if (preferredLang) {
            const match = tracks.find((item) => item?.languageCode === preferredLang);
            if (match) {
              return match;
            }
          }
          return tracks.find((item) => item?.kind === 'asr') || tracks[0] || null;
        };
        const fetchDirectTranscript = async (selected) => {
          if (!selected?.baseUrl) {
            return { transcriptPayload: null, transcriptStatus: null, transcriptError: null };
          }
          const transcriptUrl = selected.baseUrl + '&fmt=json3';
          try {
            const response = await fetch(transcriptUrl, { credentials: 'include' });
            const text = await response.text();
            return {
              transcriptPayload: text || null,
              transcriptStatus: response.status,
              transcriptError: null,
            };
          } catch (error) {
            return {
              transcriptPayload: null,
              transcriptStatus: null,
              transcriptError: error instanceof Error ? error.message : String(error),
            };
          }
        };
        const tryOpenTranscriptUi = async () => {
          let transcriptTab = [...document.querySelectorAll('[role="tab"], button, [role="button"]')].find((element) => {
            const text = (element.innerText || element.textContent || '').trim();
            return /转写文稿|文字稿|transcript/i.test(text);
          });
          if (!transcriptTab) {
            const chapterButton = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
              const text = (element.innerText || element.textContent || '').trim();
              return /章节|chapter|在此视频中/i.test(text);
            });
            if (chapterButton) {
              chapterButton.click();
              await wait(800);
            }
            transcriptTab = [...document.querySelectorAll('[role="tab"], button, [role="button"]')].find((element) => {
              const text = (element.innerText || element.textContent || '').trim();
              return /转写文稿|文字稿|transcript/i.test(text);
            });
          }
          if (!transcriptTab) {
            const menuButton = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
              const label = (element.getAttribute('aria-label') || '').trim();
              const text = (element.innerText || element.textContent || '').trim();
              return /更多操作|more actions/i.test(label) || /更多操作|more actions/i.test(text);
            });
            if (menuButton) {
              menuButton.click();
              await wait(800);
              transcriptTab = [...document.querySelectorAll('[role="menuitem"], [role="tab"], button, [role="button"]')].find((element) => {
                const text = (element.innerText || element.textContent || '').trim();
                return /显示转写文稿|显示文字稿|show transcript/i.test(text);
              });
            }
          }
          if (transcriptTab) {
            transcriptTab.click();
            await wait(2500);
          }
          return Boolean(transcriptTab);
        };
        const collectDomTranscriptSegments = async () => {
          const transcriptPanel =
            document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]') ||
            document.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
          const transcriptScroller =
            transcriptPanel?.querySelector('#segments-container') ||
            transcriptPanel?.querySelector('#body.ytd-engagement-panel-section-list-renderer') ||
            transcriptPanel?.querySelector('#content') ||
            transcriptPanel;
          if (transcriptScroller) {
            for (let index = 0; index < 6; index += 1) {
              transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
              await wait(350);
            }
            transcriptScroller.scrollTop = 0;
            await wait(350);
          }
          return [...document.querySelectorAll(
            'ytd-transcript-segment-renderer, ytd-transcript-search-panel-renderer ytd-transcript-segment-list-renderer > *'
          )]
            .map((element) => {
              const timestamp =
                element.querySelector('.segment-timestamp')?.textContent?.trim() ||
                element.querySelector('#timestamp')?.textContent?.trim() ||
                element.querySelector('[class*="timestamp"]')?.textContent?.trim() ||
                null;
              const text =
                element.querySelector('.segment-text')?.textContent?.trim() ||
                element.querySelector('#segment-text')?.textContent?.trim() ||
                element.querySelector('[class*="segment-text"]')?.textContent?.trim() ||
                element.textContent?.trim() ||
                '';
              return {
                timestamp,
                text,
              };
            })
            .filter((item) => item.text && item.text !== item.timestamp);
        };

        let adHandlingRounds = 0;
        let attemptCount = 0;
        let lastPlayerResponse = null;
        let lastTracks = [];
        let lastSelected = null;
        let lastDomTranscriptSegments = [];
        let lastTranscriptPayload = null;
        let lastTranscriptStatus = null;
        let lastTranscriptError = null;
        let lastTranscriptTabFound = false;
        let observedTranscriptSignal = false;
        let observedTranscriptContent = false;
        let lastContentFingerprint = '';
        let lastContentChangeAt = 0;

        const buildContentFingerprint = (transcriptPayload, domTranscriptSegments) => {
          const payloadLength = transcriptPayload ? transcriptPayload.length : 0;
          const domCount = Array.isArray(domTranscriptSegments) ? domTranscriptSegments.length : 0;
          const domTail = domCount
            ? domTranscriptSegments
                .slice(Math.max(0, domCount - 3))
                .map((item) => (item.timestamp || '') + ':' + (item.text || ''))
                .join('|')
            : '';
          return String(payloadLength) + '::' + String(domCount) + '::' + domTail;
        };

        while (Date.now() < deadlineMs) {
          attemptCount += 1;
          adHandlingRounds += await ensureNoAdBlocking(attemptCount === 1 ? 12 : 4);

          const video = document.querySelector('video');
          if (video) {
            video.muted = true;
            try {
              video.pause();
            } catch {}
          }

          const playerResponse = readPlayerResponse();
          const tracklist = playerResponse?.captions?.playerCaptionsTracklistRenderer || null;
          const tracks = Array.isArray(tracklist?.captionTracks) ? tracklist.captionTracks : [];
          const selected = pickTrack(tracks);
          const directResult = await fetchDirectTranscript(selected);

          lastPlayerResponse = playerResponse;
          lastTracks = tracks;
          lastSelected = selected;
          lastTranscriptPayload = directResult.transcriptPayload;
          lastTranscriptStatus = directResult.transcriptStatus;
          lastTranscriptError = directResult.transcriptError;
          observedTranscriptSignal = observedTranscriptSignal || Boolean(selected);

          let transcriptTabFound = lastTranscriptTabFound;
          let domTranscriptSegments = lastDomTranscriptSegments;

          if (!directResult.transcriptPayload) {
            adHandlingRounds += await ensureNoAdBlocking(4);
            transcriptTabFound = await tryOpenTranscriptUi();
            lastTranscriptTabFound = transcriptTabFound;
            adHandlingRounds += await ensureNoAdBlocking(3);

            domTranscriptSegments = await collectDomTranscriptSegments();
            lastDomTranscriptSegments = domTranscriptSegments;
          } else {
            lastTranscriptTabFound = false;
            lastDomTranscriptSegments = [];
            domTranscriptSegments = [];
          }

          const hasContent = Boolean(directResult.transcriptPayload) || domTranscriptSegments.length > 0;
          if (hasContent) {
            observedTranscriptSignal = true;
            observedTranscriptContent = true;
            const fingerprint = buildContentFingerprint(directResult.transcriptPayload, domTranscriptSegments);
            if (fingerprint && fingerprint !== lastContentFingerprint) {
              lastContentFingerprint = fingerprint;
              lastContentChangeAt = Date.now();
            }
          }

          if (observedTranscriptContent && lastContentChangeAt && Date.now() - lastContentChangeAt >= settleIdleMs) {
            return {
              title: playerResponse?.videoDetails?.title || document.title || null,
              isAdShowing: isAdBlocking(),
              adHandlingRounds,
              attemptCount,
              tracks,
              selected,
              domTranscriptSegments,
              transcriptPayload: directResult.transcriptPayload,
              transcriptStatus: directResult.transcriptStatus,
              transcriptError: directResult.transcriptError,
              transcriptTabFound,
              skippedUiFallback: !domTranscriptSegments.length
            };
          }

          if (Date.now() + pollIntervalMs >= deadlineMs) {
            break;
          }
          await wait(pollIntervalMs);
        }

        return {
          title: lastPlayerResponse?.videoDetails?.title || document.title || null,
          isAdShowing: isAdBlocking(),
          adHandlingRounds,
          attemptCount,
          tracks: lastTracks,
          selected: lastSelected,
          domTranscriptSegments: lastDomTranscriptSegments,
          transcriptPayload: lastTranscriptPayload,
          transcriptStatus: lastTranscriptStatus,
          transcriptError: lastTranscriptError,
          transcriptTabFound: lastTranscriptTabFound,
          skippedUiFallback: observedTranscriptContent && !lastDomTranscriptSegments.length,
          observedTranscriptSignal,
          observedTranscriptContent
        };
      })()`;

      const evaluation = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const value = evaluation.result.value;
      removeListener();

      let panelPayload = null;
      for (const requestId of panelBodies) {
        try {
          const body = await send("Network.getResponseBody", { requestId });
          if (body?.body && body.body.includes("transcriptSegmentViewModel")) {
            panelPayload = body.body;
            break;
          }
        } catch {
          // Ignore failed body retrieval and continue.
        }
      }

      return {
        ...value,
        panelPayload,
      };
    }), timeoutMs + FINALIZATION_GRACE_MS);

    result.title = payload?.title || result.title;
    result.available_subtitles = Array.isArray(payload?.tracks) ? payload.tracks.map(normalizeTrack) : [];
    result.has_auto_subtitle = result.available_subtitles.some((item) => item.kind === "asr");

    if (payload?.selected) {
      result.subtitle_lang = payload.selected.languageCode || null;
      result.subtitle_name =
        payload.selected.name?.simpleText ||
        (Array.isArray(payload.selected.name?.runs)
          ? payload.selected.name.runs.map((item) => item.text).join("")
          : null);
    }

    if (!payload?.selected) {
      result.error = "No subtitle track was available for the requested video within the polling window.";
      return result;
    }

    let transcript = { fullText: "", segments: [] };

    if (payload?.panelPayload) {
      try {
        transcript = parseTranscriptPanelResponse(JSON.parse(payload.panelPayload));
      } catch {
        // Fall back to timedtext parsing below.
      }
    }

    if (!transcript.fullText && Array.isArray(payload?.domTranscriptSegments) && payload.domTranscriptSegments.length) {
      transcript = normalizeDomTranscriptSegments(payload.domTranscriptSegments);
    }

    if (!transcript.fullText && payload?.transcriptPayload) {
      try {
        transcript = parseJson3Events(JSON.parse(payload.transcriptPayload));
      } catch {
        // Keep the empty transcript result below.
      }
    }

    result.full_text = transcript.fullText;
    result.segments = transcript.segments;
    result.transcript_source = transcript.fullText ? "subtitle" : null;

    if (!result.full_text) {
      result.error = payload?.transcriptTabFound
        ? "Transcript polling timed out after opening the transcript panel, but no subtitle text could be parsed from panel or timedtext responses."
        : payload?.transcriptError
          ? `Transcript polling timed out. The last subtitle request failed: ${payload.transcriptError}`
          : `Transcript polling timed out. Subtitle track was found, but the subtitle body stayed empty (status ${payload?.transcriptStatus || "unknown"}).`;
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
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
    preferLang: "",
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
      "Usage: node skills/pull-youtubeInfo/scripts/fetch_youtube_subtitle.js <youtube-url-or-id> [--prefer-lang yue] [--debug-port 9222] [--pretty]"
    );
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const data = await fetchYouTubeSubtitle(args.input, {
      preferLang: args.preferLang,
      debugPort: args.debugPort,
    });
    process.stdout.write(`${JSON.stringify(data, null, args.pretty ? 2 : 0)}\n`);
    process.exitCode = data.error ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractVideoId,
  fetchYouTubeSubtitle,
  parseArgs,
  parseJson3Events,
  parseTranscriptPanelResponse,
  DEFAULT_TASK_TIMEOUT_MS,
};
