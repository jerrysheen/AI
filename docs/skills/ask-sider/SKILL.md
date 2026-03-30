# ASK Sider

`ASK Sider` is the repository's reusable local automation skill for sending one prompt to the logged-in Sider web app and waiting for the final reply.

## Stable entrypoints

- PowerShell: [scripts/sider/ask-sider.ps1](/F:/AI/scripts/sider/ask-sider.ps1)
- Node implementation: [scripts/sider/ask-sider.js](/F:/AI/scripts/sider/ask-sider.js)
- One-time login bootstrap: [scripts/sider/init-sider-profile.ps1](/F:/AI/scripts/sider/init-sider-profile.ps1)
- Config: [config/sider-chat.json](/F:/AI/config/sider-chat.json)

## Contract

Input:

- one plain-text question
- optional config path

Output:

- default: plain reply text
- `-AsJson`: JSON object with `status`, `sent_message`, `reply_text`, `page_url`, `note`

## Example

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sider\ask-sider.ps1 "请只回复 OK"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sider\ask-sider.ps1 "请只回复 OK" -AsJson
```

## Expected behavior

1. Reuse the dedicated Chrome profile configured in `config/sider-chat.json`.
2. Reuse an existing Sider chat tab when present.
3. Send the question through the web UI.
4. Wait until the visible `停止生成` state disappears.
5. Return the latest assistant message from the chat thread.

## Concurrency rule

- Callers must use this skill serially per Chrome profile.
- Do not run multiple `ASK Sider` invocations in parallel against the same Sider session, or replies may be matched to the wrong request.

## Compatibility

Legacy wrappers remain at `scripts\ask-sider.ps1`, `scripts\ask-sider.js`, and `scripts\init-sider-profile.ps1` so older callers do not break.
