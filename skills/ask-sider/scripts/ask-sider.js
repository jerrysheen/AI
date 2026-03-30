const fs = require('node:fs');
const path = require('node:path');

const MAIN_SELECTOR = 'main';
const INPUT_SELECTORS = [
  'textarea[placeholder="问任何问题，@ 模型，/ 提示"]',
  'textarea[aria-label="问任何问题，@ 模型，/ 提示"]',
  'textarea',
  '[role="textbox"][aria-label="问任何问题，@ 模型，/ 提示"]',
  '[role="textbox"]',
];
const SEND_SELECTORS = [
  '.send-btn[role="button"]',
  '[role="button"].send-btn',
  '.bottom-area [role="button"]',
  'button[aria-label*="发送"]',
  'button[title*="发送"]',
  'button',
];
const ASSISTANT_REPLY_SELECTORS = [
  '.message-inner .answer-markdown-box',
  '.answer-markdown-box',
];
const GENERATING_TEXT = '停止生成';

const IGNORED_TEXTS = new Set(
  [
    'Wisebase',
    'AI 暂存箱',
    'Demo: Research on LLMs',
    'Demo: NVIDIA Business Outlook',
    '所有文件',
    GENERATING_TEXT,
    '与GPT-5.1比较',
    '语音输入',
    '思考',
    '工具',
    '你好,',
    '我今天能帮你什么？',
    '试用 Nano Banana Pro',
    '最佳搭配 Gemini 3 Pro（思考）',
    'GPT-5.1 Think',
    '聊天',
    'Agents',
    'Deep Research',
    '网页创建者',
    'AI写作助手',
    'AI PPT',
  ].map(normalizeText),
);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeOrdered(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true});
      this.socket.addEventListener('error', reject, {once: true});
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'CDP error'));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  async close() {
    if (!this.socket) return;
    this.socket.close();
    await delay(50);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = {id, method, params};
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify(payload));
    });
  }
}

async function withTimeout(factory, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      factory(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveBrowserWsUrl(baseUrl, config) {
  try {
    const versionInfo = await fetchJson(`${baseUrl}/json/version`);
    if (versionInfo.webSocketDebuggerUrl) {
      return versionInfo.webSocketDebuggerUrl;
    }
  } catch {}

  const defaultPortFile = config.chrome.user_data_dir
    ? path.join(config.chrome.user_data_dir, 'DevToolsActivePort')
    : path.join(
        process.env.LOCALAPPDATA || '',
        'Google',
        'Chrome',
        'User Data',
        'DevToolsActivePort',
      );
  const portFile = config.chrome.devtools_active_port_path || defaultPortFile;
  if (!fs.existsSync(portFile)) {
    throw new Error(`Could not resolve browser websocket URL. Missing ${portFile}`);
  }
  const lines = fs
    .readFileSync(portFile, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
  }
  return `ws://127.0.0.1:${lines[0]}${lines[1]}`;
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {expression, awaitPromise: true, returnByValue: true},
    sessionId,
  );
  return result.result ? result.result.value : undefined;
}

async function waitForPageReady(client, sessionId, timeoutMs) {
  await withTimeout(async () => {
    while (true) {
      const readyState = await evaluate(client, sessionId, 'document.readyState');
      if (readyState === 'complete' || readyState === 'interactive') return;
      await delay(250);
    }
  }, timeoutMs, 'Page load');
}

async function waitForChatInput(client, sessionId, timeoutMs) {
  const expression = `(() => {
    const main = document.querySelector(${JSON.stringify(MAIN_SELECTOR)});
    if (!main) return false;
    const selectors = ${JSON.stringify(INPUT_SELECTORS)};
    const isVisible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    for (const selector of selectors) {
      const input = main.querySelector(selector);
      if (isVisible(input)) return true;
    }
    return false;
  })()`;

  await withTimeout(async () => {
    while (true) {
      if (await evaluate(client, sessionId, expression)) return;
      await delay(300);
    }
  }, timeoutMs, 'Chat input lookup');
}

async function getVisibleMainState(client, sessionId) {
  const payload = await evaluate(
    client,
    sessionId,
    `(() => {
      const main = document.querySelector(${JSON.stringify(MAIN_SELECTOR)});
      if (!main) return { leafTexts: [], mainText: '', isGenerating: false };
      const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const leafTexts = [...main.querySelectorAll('*')]
        .filter((el) => isVisible(el) && el.children.length === 0)
        .map((el) => (el.innerText || '').trim())
        .filter(Boolean);
      return {
        leafTexts,
        mainText: (main.innerText || '').trim(),
        isGenerating: (main.innerText || '').includes(${JSON.stringify(GENERATING_TEXT)}),
      };
    })()`,
  );
  return payload && typeof payload === 'object'
    ? {
        leafTexts: Array.isArray(payload.leafTexts) ? payload.leafTexts : [],
        mainText: typeof payload.mainText === 'string' ? payload.mainText : '',
        isGenerating: Boolean(payload.isGenerating),
      }
    : {leafTexts: [], mainText: '', isGenerating: false};
}

async function getAssistantReplies(client, sessionId) {
  const replies = await evaluate(
    client,
    sessionId,
    `(() => {
      const main = document.querySelector(${JSON.stringify(MAIN_SELECTOR)});
      if (!main) return [];
      const selectors = ${JSON.stringify(ASSISTANT_REPLY_SELECTORS)};
      const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const seen = new Set();
      const results = [];
      for (const selector of selectors) {
        for (const el of main.querySelectorAll(selector)) {
          if (!isVisible(el)) continue;
          const text = (el.innerText || '').trim();
          if (!text || seen.has(text)) continue;
          seen.add(text);
          results.push(text);
        }
      }
      return results;
    })()`,
  );
  return Array.isArray(replies)
    ? replies.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
}

async function sendMessage(client, sessionId, question) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const main = document.querySelector(${JSON.stringify(MAIN_SELECTOR)});
      if (!main) return { ok: false, reason: 'Main chat region not found' };
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      const sendSelectors = ${JSON.stringify(SEND_SELECTORS)};
      const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled && rect.width > 0 && rect.height > 0;
      };

      let input = null;
      for (const selector of inputSelectors) {
        const candidate = main.querySelector(selector);
        if (isVisible(candidate)) {
          input = candidate;
          break;
        }
      }
      if (!input) return { ok: false, reason: 'Sider input not found' };

      input.focus();
      if ('value' in HTMLTextAreaElement.prototype && input instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(input, ${JSON.stringify(question)});
        } else {
          input.value = ${JSON.stringify(question)};
        }
      } else if ('value' in input) {
        input.value = ${JSON.stringify(question)};
      } else {
        input.textContent = ${JSON.stringify(question)};
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      let trigger = null;
      for (const selector of sendSelectors) {
        const candidate = main.querySelector(selector);
        if (isVisible(candidate)) {
          trigger = candidate;
          break;
        }
      }

      if (trigger) {
        trigger.click();
        return { ok: true, method: 'button', selector: trigger.className || trigger.tagName };
      }

      const keyEvent = {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        which: 13,
        keyCode: 13,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
      input.dispatchEvent(new KeyboardEvent('keypress', keyEvent));
      input.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
      return { ok: true, method: 'enter' };
    })()`,
  );
}

async function waitForReplyText(client, sessionId, beforeState, question, timeoutMs) {
  const beforeSet = new Set(beforeState.leafTexts.map(normalizeText));
  const ignored = new Set([...IGNORED_TEXTS, normalizeText(question)]);
  const beforeReplyCount = beforeState.replyCount || 0;

  return withTimeout(async () => {
    let lastCandidate = '';
    while (true) {
      const [state, replies] = await Promise.all([
        getVisibleMainState(client, sessionId),
        getAssistantReplies(client, sessionId),
      ]);
      const additions = [];

      for (const rawValue of state.leafTexts) {
        const raw = rawValue.trim();
        const normalized = normalizeText(raw);
        if (!normalized || beforeSet.has(normalized) || ignored.has(normalized)) {
          continue;
        }
        if (/^GPT-\d|^Claude|^Gemini/i.test(raw)) continue;
        additions.push(raw);
      }

      if (additions.length > 0) {
        lastCandidate = dedupeOrdered(additions).join('\n');
      }

      if (replies.length > beforeReplyCount) {
        const latestReply = replies[replies.length - 1];
        if (normalizeText(latestReply)) {
          lastCandidate = latestReply;
        }
      }

      if (!state.isGenerating && lastCandidate) return lastCandidate;
      await delay(800);
    }
  }, timeoutMs, 'Assistant reply');
}

async function getLocationHref(client, sessionId) {
  return evaluate(client, sessionId, 'location.href');
}

async function findExistingChatTarget(client, siteUrl) {
  const result = await client.send('Target.getTargets');
  const targets = Array.isArray(result.targetInfos) ? result.targetInfos : [];
  const normalizedSiteUrl = String(siteUrl || '').trim();

  return (
    targets.find((target) => {
      if (target.type !== 'page') return false;
      if (!target.url) return false;
      return target.url === normalizedSiteUrl || target.url.startsWith(normalizedSiteUrl);
    }) || null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config || !args.question) {
    throw new Error('Usage: node ask-sider.js --config <path> --question <text>');
  }

  const configPath = path.resolve(args.config);
  const configText = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const config = JSON.parse(configText);
  const question = args.question;
  const baseUrl = `http://127.0.0.1:${config.chrome.remote_debug_port}`;
  const responseTimeoutMs = Number(config.site.response_timeout_ms || 30000);

  const browserWsUrl = await resolveBrowserWsUrl(baseUrl, config);
  const client = new CdpClient(browserWsUrl);
  await client.connect();

  let targetId = '';
  let sessionId = '';
  let createdTarget = false;

  try {
    const existingTarget = await findExistingChatTarget(client, config.site.url);
    if (existingTarget) {
      targetId = existingTarget.targetId;
    } else {
      const created = await client.send('Target.createTarget', {url: config.site.url});
      targetId = created.targetId;
      createdTarget = true;
    }

    const attached = await client.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    sessionId = attached.sessionId;

    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);

    if (createdTarget) {
      await waitForPageReady(client, sessionId, 20000);
    } else {
      const currentUrl = await getLocationHref(client, sessionId);
      if (currentUrl !== config.site.url && !currentUrl.startsWith(`${config.site.url}?`)) {
        await client.send('Page.navigate', {url: config.site.url}, sessionId);
      }
    }

    await waitForPageReady(client, sessionId, 20000);
    await waitForChatInput(client, sessionId, 20000);

    const [beforeState, beforeReplies] = await Promise.all([
      getVisibleMainState(client, sessionId),
      getAssistantReplies(client, sessionId),
    ]);
    const sendResult = await sendMessage(client, sessionId, question);
    if (!sendResult.ok) {
      throw new Error(sendResult.reason || 'Failed to send message');
    }

    const replyText = await waitForReplyText(
      client,
      sessionId,
      {
        ...beforeState,
        replyCount: beforeReplies.length,
      },
      question,
      responseTimeoutMs,
    );
    const pageUrl = await getLocationHref(client, sessionId);

    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'ok',
          sent_message: question,
          reply_text: replyText,
          page_url: pageUrl,
          note: '',
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (sessionId) {
      try {
        await client.send('Target.detachFromTarget', {sessionId});
      } catch {}
    }
    if (targetId) {
      try {
        if (createdTarget) {
          await client.send('Target.closeTarget', {targetId});
        }
      } catch {}
    }
    await client.close();
  }
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'error',
        sent_message: '',
        reply_text: '',
        page_url: '',
        note: error.message,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
