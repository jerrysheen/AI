# Sider Chat Automation Flow

This file records the browser flow validated against `https://sider.ai/zh-CN/chat` with the repository's custom Chrome profile.

## Verified UI flow

1. Launch Chrome with the dedicated profile from `config/sider-chat.json`.
2. Attach to the existing Chrome instance through the DevTools remote debugging port.
3. Reuse an existing `https://sider.ai/zh-CN/chat` tab when present; only open a new tab if no chat page exists.
4. Wait until `main` exists and the chat input is visible.
5. Locate the input with:
   - `textarea[placeholder="问任何问题，@ 模型，/ 提示"]`
   - fallback: `textarea`
6. Fill the question into the textarea and dispatch `input` + `change`.
7. Locate the send trigger near the input.
   - Verified stable selector: `.send-btn[role="button"]`
   - This is not a native `button`; it is a `div` with `role="button"`.
8. Click the send trigger.
9. Detect generation in progress by the visible text `停止生成`.
10. Read the assistant reply from the latest visible `.answer-markdown-box`.
11. Wait until `停止生成` disappears, then return the latest reply text.

## DOM notes observed during MCP run

- Chat input:
  - tag: `TEXTAREA`
  - placeholder: `问任何问题，@ 模型，/ 提示`
  - class includes `chatBox-input`
- Send control:
  - tag: `DIV`
  - role: `button`
  - class includes `send-btn`
- Assistant reply body:
  - container selector: `.message-inner .answer-markdown-box`
  - for a simple test prompt `请只回复：MCP_TEST_OK`, the extracted reply was exactly `MCP_TEST_OK`
- Completion signal:
  - while the model is generating, `main.innerText` contains `停止生成`
  - when generation ends, that text disappears and the reply body remains in `.answer-markdown-box`

## Implementation notes

- `scripts/ask-sider.js` now prefers the verified selectors above instead of relying mainly on generic leaf-text diffs.
- A leaf-text diff is still kept as a fallback in case Sider adjusts its message DOM.
- The script reuses an existing chat tab instead of always creating and later closing a second tab.
- The script assumes the dedicated Chrome profile is already logged in once and can be reused for future runs.
