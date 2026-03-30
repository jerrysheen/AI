# Sider Scripts

This directory contains the reusable Sider automation skill for the repository.

## ASK Sider

- `ask-sider.ps1`: standard PowerShell entrypoint for callers.
- `ask-sider.js`: DevTools Protocol implementation that reuses the dedicated Sider Chrome session.
- `init-sider-profile.ps1`: one-time profile bootstrap for login and cookie persistence.

## Recommended entrypoints

Use these paths for new integrations:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sider\ask-sider.ps1 "请帮我总结这段文本"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sider\init-sider-profile.ps1
```

Legacy root-level wrappers under `scripts\` are kept for compatibility, but new callers should target `scripts\sider\`.

## Concurrency

Run one request at a time per Sider profile. This automation reuses one logged-in chat page, so parallel calls can interfere with each other.
