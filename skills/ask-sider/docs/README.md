# Sider CLI Wrapper

This wrapper sends a message to the logged-in Sider web app by talking directly to Chrome's remote debugging endpoint.

## Files

- `config/sider-chat.json`: site and browser behavior.
- `scripts/runtime_shim.js`: resolves shared runtime defaults and cross-platform Chrome paths.
- `scripts/init-sider-profile.sh`: one-time dedicated profile launcher for macOS/Linux.
- `scripts/init-sider-profile.ps1`: one-time dedicated profile launcher for Windows.
- `scripts/ask-sider.js`: Node script that drives Chrome through the DevTools Protocol.
- `scripts/ask-sider.sh`: normal entrypoint on macOS/Linux.
- `scripts/ask-sider.ps1`: normal entrypoint on Windows.
- `schemas/sider-reply.schema.json`: output contract for JSON mode.

## One-Time Setup

Run this once to create and open the dedicated automation Chrome profile:

```bash
./skills/ask-sider/scripts/init-sider-profile.sh
```

Then in that Chrome window:

1. Log in to your Google / Sider account.
2. Confirm `https://sider.ai/zh-CN/chat` opens normally.
3. Close the browser when you are done.

The login state will stay in the profile resolved from `AI_CHROME_PROFILE_DIR`, which defaults to `.chrome-sider-profile` under the repository root.

## Daily Usage

```bash
./skills/ask-sider/scripts/ask-sider.sh "帮我总结今天的工作计划"
```

Print structured JSON instead of plain reply text:

```bash
./skills/ask-sider/scripts/ask-sider.sh "帮我总结今天的工作计划" --as-json
```

Skip browser cleanup if you do not want the script to close existing browsers:

```bash
./skills/ask-sider/scripts/ask-sider.sh "帮我总结今天的工作计划" --skip-browser-cleanup
```

## Behavior

1. Resolves Chrome path, profile dir, and debug port from shared runtime config or `.env`.
2. Starts one dedicated Chrome with the resolved profile directory when the debug port is not already available.
3. Enables remote debugging on the configured port.
4. Installs the local `ws` dependency on first run if needed.
5. Runs `scripts/ask-sider.js`.
6. The Node script reuses an existing Sider chat tab when available, sends the message, confirms whether the page accepted the send, waits for a reply, and returns structured output.

## Notes

- This flow does not use `codex exec`.
- It does not rely on your default Chrome profile.
- On macOS, the default Chrome binary path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` unless `AI_CHROME_PATH` overrides it.
- The default output is only the assistant reply text. Use `-AsJson` for the full payload.
- The helper uses DOM heuristics to find the chat box and extract the latest answer. If Sider changes its page structure, update `scripts/ask-sider.js`.
- This flow is designed for serial use per profile. Do not run multiple `ask-sider` calls in parallel against the same logged-in Sider session.
- In JSON mode, prefer branching on `status` and `recovery_hint` instead of treating every non-`ok` outcome as a resend.
- `send_not_confirmed` means the page never showed evidence that the message was accepted; resending is safe.
- `reply_not_observed` means the message was likely sent but reply extraction timed out or failed before any stable visible reply could be recovered; do not resend, recover by re-reading the page instead.
- Reply completion is determined primarily by text growth, not by the presence or absence of a `停止生成` label. Once a visible reply exists, the script polls every `response_poll_interval_ms` and ends after `response_stable_checks` consecutive polls with no text growth.
- `response_max_timeout_ms` is no longer a hard stop when reply text is still growing. After that timeout, the script keeps watching the visible reply and only stops when text has not grown for `response_idle_timeout_ms`.
- By default, the completion heartbeat is `2s * 4` stable polls, so normal replies should finish about 8 seconds after visible text stops changing.
- If visible text stops growing for the configured stable polls, the script returns the current visible reply with `status: "ok"`. If the page still appears to be generating, the note explains that the result ended on stalled growth and may be partial.
