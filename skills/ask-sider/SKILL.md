# ASK Sider

Use this skill only as a thin message forwarder to the logged-in Sider web app.

The upper layer must only:

- forward one plain-text prompt
- wait for one visible reply
- return that reply as-is

The upper layer must not:

- summarize the Sider reply
- reinterpret the Sider reply
- continue asking follow-up questions on its own
- rewrite the user's intent into a broader prompt
- switch to another tool because it dislikes the answer quality

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

- default: plain reply text, returned as-is
- `-AsJson`: JSON object with `status`, `sent_message`, `reply_text`, `page_url`, `note`, `send_confirmed`, `generation_observed`, `reply_observed`, `recovery_hint`

## Entry Points

- macOS/Linux shell: [ask-sider.sh](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/ask-sider.sh)
- PowerShell: [ask-sider.ps1](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/ask-sider.ps1)
- Node implementation: [ask-sider.js](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/ask-sider.js)
- One-time login bootstrap: [init-sider-profile.sh](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/init-sider-profile.sh)
- Windows bootstrap: [init-sider-profile.ps1](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/init-sider-profile.ps1)
- Config: [sider-chat.json](/Users/jerry/Desktop/AI/skills/ask-sider/config/sider-chat.json)
- Usage notes: [README.md](/Users/jerry/Desktop/AI/skills/ask-sider/docs/README.md)

## Procedure

1. Treat the user request as one plain-text prompt.
2. On macOS/Linux, use [ask-sider.sh](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/ask-sider.sh). On Windows, use [ask-sider.ps1](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/ask-sider.ps1).
3. If the dedicated Chrome profile is not initialized, run [init-sider-profile.sh](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/init-sider-profile.sh) on macOS/Linux or [init-sider-profile.ps1](/Users/jerry/Desktop/AI/skills/ask-sider/scripts/init-sider-profile.ps1) on Windows, then let the user complete login in that browser window.
4. Reuse the dedicated Chrome profile configured in [sider-chat.json](/Users/jerry/Desktop/AI/skills/ask-sider/config/sider-chat.json).
5. Reuse an existing Sider chat tab when present.
6. Send the prompt through the web UI.
7. Confirm whether the page actually accepted the message.
8. Wait until the visible `停止生成` state disappears.
9. Return the latest assistant message from the chat thread.

## Upper-Layer Contract

- Treat this skill as transport, not reasoning.
- Do not add your own framing before or after the returned Sider text unless the user explicitly asked for analysis of that text.
- If the reply is partial, noisy, off-topic, or low quality, report that fact plainly and stop.
- If the user wants another try, only resend a new user-approved prompt.
- Do not ask a second question automatically.
- Do not convert one user request into a multi-step research workflow.
- Do not mix Sider output with local conclusions and present them as one answer.

## Constraints

- Callers must use this skill serially per Chrome profile.
- Do not run multiple `ASK Sider` invocations in parallel against the same Sider session.
- Prefer the platform shell wrapper over invoking `ask-sider.js` directly.
- If the browser session is unavailable, initialize it first instead of silently switching to another tool or API.
- Do not let the upper layer "help" by expanding, summarizing, or steering the conversation.
- If `status` is `send_not_confirmed`, retrying the send is safe.
- If `status` is `reply_not_observed`, do not resend the prompt. Try a recovery read first.
- Treat visible reply text growth as the primary completion signal.
- Poll reply text on a short heartbeat and finish after several consecutive stable polls instead of waiting for a long fixed stall timeout.
- If visible reply text is still growing after `response_max_timeout_ms`, keep waiting instead of treating it as a hard failure.
- If visible reply text stops growing for `response_idle_timeout_ms`, return the currently visible reply instead of waiting forever.

## Examples

```bash
./skills/ask-sider/scripts/ask-sider.sh "请只回复 OK"
```

```bash
./skills/ask-sider/scripts/ask-sider.sh "请只回复 OK" --as-json
```

## Correct Caller Behavior

Allowed:

- user asks one question
- caller sends exactly that question
- caller returns Sider's visible reply

Not allowed:

- "Sider answered poorly, so I will ask a better question for the user"
- "I will summarize Sider first, then give my own improved answer"
- "I will use Sider as step 1, then continue with my own interview or research flow"

## Repository Layout

This skill is intentionally self-contained under `skills/ask-sider/` so it can be copied into another tool's runtime skill directory later.
