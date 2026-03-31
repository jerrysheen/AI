# ASK Sider

Use this skill when a task must send one prompt to the logged-in Sider web app and return the final visible reply from that browser session.

## When To Use

Use this skill when:

- the user explicitly wants to ask Sider
- the workflow must use the local logged-in Sider web session instead of a direct API
- the task can be expressed as one plain-text prompt followed by one final reply
- the caller wants a stable script entrypoint instead of manual browser interaction

## When Not To Use

Do not use this skill when:

- the user wants a direct OpenAI or other model API call
- the task requires multi-turn browser interaction beyond one send-and-wait cycle
- multiple prompts need to run in parallel against the same Sider session
- the task can be completed locally without opening or reusing the Sider web app

## Inputs

- one plain-text question
- optional config path

## Outputs

- default: plain reply text
- `-AsJson`: JSON object with `status`, `sent_message`, `reply_text`, `page_url`, `note`, `send_confirmed`, `generation_observed`, `reply_observed`, `recovery_hint`

## Entry Points

- PowerShell: [ask-sider.ps1](/F:/AI/skills/ask-sider/scripts/ask-sider.ps1)
- Node implementation: [ask-sider.js](/F:/AI/skills/ask-sider/scripts/ask-sider.js)
- One-time login bootstrap: [init-sider-profile.ps1](/F:/AI/skills/ask-sider/scripts/init-sider-profile.ps1)
- Config: [sider-chat.json](/F:/AI/skills/ask-sider/config/sider-chat.json)
- Usage notes: [README.md](/F:/AI/skills/ask-sider/docs/README.md)

## Procedure

1. Treat the user request as one plain-text prompt.
2. Use [ask-sider.ps1](/F:/AI/skills/ask-sider/scripts/ask-sider.ps1) as the default entrypoint.
3. If the dedicated Chrome profile is not initialized, run [init-sider-profile.ps1](/F:/AI/skills/ask-sider/scripts/init-sider-profile.ps1) once and let the user complete login in that browser window.
4. Reuse the dedicated Chrome profile configured in [sider-chat.json](/F:/AI/skills/ask-sider/config/sider-chat.json).
5. Reuse an existing Sider chat tab when present.
6. Send the prompt through the web UI.
7. Confirm whether the page actually accepted the message.
8. Wait until the visible `停止生成` state disappears.
9. Return the latest assistant message from the chat thread.

## Constraints

- Callers must use this skill serially per Chrome profile.
- Do not run multiple `ASK Sider` invocations in parallel against the same Sider session.
- Prefer the PowerShell wrapper unless a caller explicitly needs the Node entrypoint.
- If the browser session is unavailable, initialize it first instead of silently switching to another tool or API.
- If `status` is `send_not_confirmed`, retrying the send is safe.
- If `status` is `reply_not_observed`, do not resend the prompt. Try a recovery read first.
- Treat visible reply text growth as the primary completion signal.
- Poll reply text on a short heartbeat and finish after several consecutive stable polls instead of waiting for a long fixed stall timeout.
- If visible reply text is still growing after `response_max_timeout_ms`, keep waiting instead of treating it as a hard failure.
- If visible reply text stops growing for `response_idle_timeout_ms`, return the currently visible reply instead of waiting forever.

## Examples

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\ask-sider.ps1 "请只回复 OK"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\ask-sider\scripts\ask-sider.ps1 "请只回复 OK" -AsJson
```

## Repository Layout

This skill is intentionally self-contained under `skills/ask-sider/` so it can be copied into another tool's runtime skill directory later.
