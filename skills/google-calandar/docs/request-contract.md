# Request Contract

Use this skill in two phases:

1. Normalize the user's request into exactly one JSON object that matches [calendar-task-request.schema.json](/F:/AI/skills/google-calandar/schemas/calendar-task-request.schema.json).
2. Execute that object with:

```powershell
node .\skills\google-calandar\scripts\google-calendar.js execute --payload '{"action":"create_task","title":"提交周报","due":"2026-04-05"}'
```

Or write the JSON to a file and execute it with:

```powershell
node .\skills\google-calandar\scripts\google-calendar.js execute --payloadFile .\tmp\calendar-request.json
```

Normalization rules:

- Return exactly one action.
- Do not wrap the JSON in markdown fences.
- For broad questions like "我今天要干嘛", "看看我今天的 Google Calendar", "今天有什么安排", or "今天我要做什么", return exactly `{"action":"daily_brief"}`.
- Do not make the upper layer compute, infer, or pass a date for "today". `google-calendar.js` is responsible for using the current UTC day.
- Do not invent `eventId` or `taskId`.
- If an update/delete request has no id, list candidates first.
- For calendar event times and list ranges, use ISO datetime. For UTC day boundaries, use `YYYY-MM-DDTHH:mm:ssZ`.
- For natural ranges like "today", "tomorrow", "this week", and "this month", prefer explicit `start` and `end` over `days`.
- "今天的日程" must mean the full UTC day, from `00:00:00Z` to `23:59:59Z`, not "from now onward".
- `daily_brief` should combine events and tasks for the same UTC day. Do not hide past items; classify the returned items into `ended`, `in_progress`, and `upcoming`.
- For task due dates, prefer `YYYY-MM-DD`.
- For `list_tasks`, use `includeCompleted: true` when the user wants a full-day summary, progress review, or asks what they had today.
- For quick task capture, keep `title` short and action-oriented. Only add `notes` when the user gave extra detail that would otherwise be lost.
- When the user gives a short reminder without a concrete start/end time, prefer `create_task`.
- When the user gives a concrete meeting time or a clear start/end range, prefer `create_event`.

Examples:

```json
{"action":"daily_brief"}
```

```json
{"action":"list_events","start":"2026-04-02T00:00:00Z","end":"2026-04-02T23:59:59Z"}
```

```json
{"action":"create_event","title":"团队会议","start":"2026-04-02T14:00:00","end":"2026-04-02T15:00:00","description":"讨论Q2计划","location":"会议室A"}
```

```json
{"action":"list_tasks","dueStart":"2026-04-02","dueEnd":"2026-04-02","includeCompleted":true}
```

```json
{"action":"create_task","title":"提交周报","notes":"周五下班前完成","due":"2026-04-05"}
```

```json
{"action":"list_tasks"}
```
