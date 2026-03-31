---
name: google-calandar
description: Verify connectivity to a Google Calendar and Google Tasks Google Apps Script web app, then call it safely for calendar and task operations. Use when Codex needs to read the deployment URL from url.txt, validate GET/POST reachability, list calendars or tasklists, or create/update/delete calendar events and Google Tasks through that endpoint.
---

# Google Calendar Web App

Read `url.txt` first.

Use [request-contract.md](/F:/AI/skills/google-calandar/docs/request-contract.md) and [calendar-task-request.schema.json](/F:/AI/skills/google-calandar/schemas/calendar-task-request.schema.json) when another model must convert natural language into a valid request object.

Accept either of these formats in `url.txt`:

- First line is the deployment ID and another line is the full `/exec` URL.
- A line contains only the full `https://script.google.com/macros/s/.../exec` URL.

For first-step connectivity validation:

1. Run `node scripts/test-connectivity.js`.
2. Treat `GET 200` as transport success.
3. Treat `POST 200` with `{"error":"unknown action"}` as expected when using the safe probe payload `{"action":"ping"}`.

Use the safe probe before any mutation request. Do not create calendar events during connectivity checks.

For calendar and task operations, use `node scripts/google-calendar.js`.

Model-facing helper commands:

- `node scripts/google-calendar.js describe`
- `node scripts/google-calendar.js execute --payload '{"action":"list_tasklists"}'`
- `node scripts/google-calendar.js execute --payloadFile .\tmp\calendar-request.json`

Supported commands:

- `list_events --days 7 [--calendarId "..."]`
- `create_event --title "团队会议" --start "2026-04-02T14:00:00" --end "2026-04-02T15:00:00" [--description "讨论Q2计划"] [--location "会议室A"] [--calendarId "..."]`
- `update_event --eventId "<id>" [--title ...] [--start ... --end ...] [--description ...] [--location ...]`
- `delete_event --eventId "<id>"`
- `list_tasklists`
- `list_tasks [--tasklistId "..."]`
- `create_task --title "提交周报" [--notes "补充本周总结"] [--due "2026-04-05"] [--tasklistId "..."]`
- `update_task --taskId "<id>" [--tasklistId "..."] [--title ...] [--notes ...] [--due ...]`
- `complete_task --taskId "<id>" [--tasklistId "..."]`
- `delete_task --taskId "<id>" [--tasklistId "..."]`

When the user gives a natural-language request, infer these fields before calling the script:

- For calendar events:
- `title`: Required for `create_event`.
- `start` and `end`: Use ISO local datetime like `2026-04-02T14:00:00`.
- `description` and `location`: Optional.
- `days`: Optional for `list_events`, default to `7`.
- `eventId`: Required for `update_event` and `delete_event`.
- For tasks:
- `title`: Required for `create_task`.
- `notes`: Optional.
- `due`: Optional. Prefer date form like `2026-04-05` unless a time-specific due date is explicitly needed.
- `taskId`: Required for `update_task`, `complete_task`, and `delete_task`.
- `tasklistId`: Optional. Omit to use the default task list.

If the user wants to modify or delete an event but no `eventId` is known, list candidate events first and then operate on the matching item.

If the user wants to modify or complete a task but no `taskId` is known, list tasklists or tasks first and then operate on the matching item.
