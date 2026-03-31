# Sider CLI Wrapper

This wrapper sends a message to the logged-in Sider web app by talking directly to Chrome's remote debugging endpoint.

## Files

- `config/sider-chat.json`: site and browser behavior.
- `scripts/init-sider-profile.ps1`: one-time dedicated profile launcher.
- `scripts/ask-sider.js`: zero-dependency Node script that drives Chrome through the DevTools Protocol.
- `scripts/ask-sider.ps1`: normal entrypoint script.
- `schemas/sider-reply.schema.json`: output contract for JSON mode.

## One-Time Setup

Run this once to create and open the dedicated automation Chrome profile:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\init-sider-profile.ps1
```

Then in that Chrome window:

1. Log in to your Google / Sider account.
2. Confirm `https://sider.ai/zh-CN/chat` opens normally.
3. Close the browser when you are done.

The login state will stay in `F:\AI\.chrome-sider-profile`.

## Daily Usage

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\ask-sider.ps1 "帮我总结今天的工作计划"
```

Print structured JSON instead of plain reply text:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\ask-sider.ps1 "帮我总结今天的工作计划" -AsJson
```

Skip browser cleanup if you do not want the script to close existing browsers:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\ask-sider.ps1 "帮我总结今天的工作计划" -SkipBrowserCleanup
```

## Behavior

1. Optionally kills common browser processes.
2. Starts one dedicated Chrome with `F:\AI\.chrome-sider-profile`.
3. Enables remote debugging on port `9222`.
4. Runs `scripts/ask-sider.js`.
5. The Node script reuses an existing Sider chat tab when available, sends the message, confirms whether the page accepted the send, waits for a reply, and returns structured output.

## Notes

- This flow does not use `codex exec`.
- It also does not rely on your default Chrome profile.
- The default output is only the assistant reply text. Use `-AsJson` for the full payload.
- The helper uses DOM heuristics to find the chat box and extract the latest answer. If Sider changes its page structure, update `scripts/ask-sider.js`.
- This flow is designed for serial use per profile. Do not run multiple `ask-sider` calls in parallel against the same logged-in Sider session.
- In JSON mode, prefer branching on `status` and `recovery_hint` instead of treating every non-`ok` outcome as a resend.
- `send_not_confirmed` means the page never showed evidence that the message was accepted; resending is safe.
- `reply_not_observed` means the message was likely sent but reply extraction timed out or failed before any stable visible reply could be recovered; do not resend, recover by re-reading the page instead.
- `response_max_timeout_ms` is no longer a hard stop when reply text is still growing. After that timeout, the script keeps watching the visible reply and only stops when text has not grown for `response_idle_timeout_ms`.
- If generation still appears active but visible text has not grown for `response_idle_timeout_ms`, the script returns the partial visible reply with `status: "ok"` and a note explaining that it ended on stalled growth.
