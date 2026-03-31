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
- Do not invent `eventId` or `taskId`.
- If an update/delete request has no id, list candidates first.
- For calendar event times, use `YYYY-MM-DDTHH:mm:ss`.
- For task due dates, prefer `YYYY-MM-DD`.

Examples:

```json
{"action":"create_event","title":"团队会议","start":"2026-04-02T14:00:00","end":"2026-04-02T15:00:00","description":"讨论Q2计划","location":"会议室A"}
```

```json
{"action":"create_task","title":"提交周报","notes":"周五下班前完成","due":"2026-04-05"}
```

```json
{"action":"list_tasks"}
```
