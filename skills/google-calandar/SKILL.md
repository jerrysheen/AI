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
- `node scripts/google-calendar.js daily_brief`
- `node scripts/google-calendar.js execute --payload '{"action":"list_tasklists"}'`
- `node scripts/google-calendar.js execute --payloadFile .\tmp\calendar-request.json`

Supported commands:

- `daily_brief [--date "2026-04-02"] [--calendarId "..."] [--tasklistId "..."] [--includeCompleted "true"] [--includeHidden "false"] [--showNotes "true"]`
- `list_events --days 7 [--calendarId "..."]`
- `list_events --start "2026-04-02T00:00:00" --end "2026-04-02T23:59:59" [--calendarId "..."]`
- `create_event --title "团队会议" --start "2026-04-02T14:00:00" --end "2026-04-02T15:00:00" [--description "讨论Q2计划"] [--location "会议室A"] [--calendarId "..."]`
- `update_event --eventId "<id>" [--title ...] [--start ... --end ...] [--description ...] [--location ...]`
- `delete_event --eventId "<id>"`
- `list_tasklists`
- `list_tasks [--tasklistId "..."] [--dueStart "2026-04-02" --dueEnd "2026-04-02"] [--includeCompleted "true"] [--includeHidden "false"] [--showNotes "true"]`
- `create_task --title "提交周报" [--notes "补充本周总结"] [--due "2026-04-05"] [--tasklistId "..."]`
- `update_task --taskId "<id>" [--tasklistId "..."] [--title ...] [--notes ...] [--due ...]`
- `complete_task --taskId "<id>" [--tasklistId "..."]`
- `delete_task --taskId "<id>" [--tasklistId "..."]`

When the user gives a natural-language request, infer these fields before calling the script:

- For broad "today" queries like "查看 google calendar 我今天要干嘛":
- Prefer `daily_brief` so tasks and events come back together.
- Do not hide past items. The full day should be included, then grouped into `ended`, `in_progress`, and `upcoming` based on the current time.
- Avoid splitting the answer into separate "calendar" and "tasks" sections unless the user explicitly asks for that.
- For calendar events:
- `title`: Required for `create_event`.
- `start` and `end`: Use ISO local datetime like `2026-04-02T14:00:00`.
- `description` and `location`: Optional.
- `days`: Optional for `list_events`, default to `7`.
- For natural calendar windows like "today", "tomorrow", "this week", and "this month", prefer `start` plus `end` instead of `days`.
- "今天的日程" should cover the full local day from `00:00:00` through `23:59:59`, including already-finished and upcoming events.
- `eventId`: Required for `update_event` and `delete_event`.
- For tasks:
- `title`: Required for `create_task`.
- `notes`: Optional. Keep task capture lightweight; if the user gives a short reminder, prefer a concise `title` and only use `notes` for extra detail.
- `due`: Optional. Prefer date form like `2026-04-05` unless a time-specific due date is explicitly needed.
- `taskId`: Required for `update_task`, `complete_task`, and `delete_task`.
- `tasklistId`: Optional. Omit to use the default task list.
- `dueStart` and `dueEnd`: Optional for `list_tasks`. Use them for "today", "tomorrow", and other date-bounded task views.
- `includeCompleted`: Optional for `list_tasks`. Set it to `true` when the user wants a complete daily view or progress review instead of only pending work.
- `showNotes`: Optional for `list_tasks`. Set it to `true` when details matter more than a compact list.
- If the user gives a quick reminder without a concrete start/end time, prefer `create_task`.
- If the user gives a concrete meeting time, appointment time, or explicit range, prefer `create_event`.

If the user wants to modify or delete an event but no `eventId` is known, list candidate events first and then operate on the matching item.

If the user wants to modify or complete a task but no `taskId` is known, list tasklists or tasks first and then operate on the matching item.
