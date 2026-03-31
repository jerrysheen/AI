const fs = require('node:fs');
const path = require('node:path');

function loadUrl(urlFilePath) {
  const text = fs.readFileSync(urlFilePath, 'utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const url = lines.find(
    (line) => line.startsWith('https://script.google.com/macros/s/') && line.endsWith('/exec'),
  );

  if (!url) {
    throw new Error(`No Google Apps Script exec URL found in ${urlFilePath}`);
  }

  return url;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function pad(num) {
  return String(num).padStart(2, '0');
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLocalDateTime(date) {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseLocalDate(value) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  return new Date(value);
}

function getDayBounds(dateText) {
  const base = dateText ? parseLocalDate(dateText) : new Date();
  if (!(base instanceof Date) || Number.isNaN(base.getTime())) {
    throw new Error(`Invalid date value: ${dateText}`);
  }

  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59);
  return {
    date: formatLocalDate(start),
    start,
    end,
  };
}

function toComparableTime(value, fallback) {
  const parsed = parseLocalDate(value);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : fallback;
}

function getEventEdge(event, edge) {
  const directValue = event?.[edge];
  if (typeof directValue === 'string') {
    return directValue;
  }

  const nested = event?.[edge];
  if (nested && typeof nested === 'object') {
    if (typeof nested.dateTime === 'string') {
      return nested.dateTime;
    }
    if (typeof nested.date === 'string') {
      return `${nested.date}T00:00:00`;
    }
  }

  const camel = edge === 'start' ? 'startTime' : 'endTime';
  if (typeof event?.[camel] === 'string') {
    return event[camel];
  }

  return '';
}

function buildDailyBrief(events, tasks, options = {}) {
  const now = options.now || new Date();
  const dayBounds = getDayBounds(options.date);
  const nowTime = now.getTime();
  const groups = {
    ended: [],
    in_progress: [],
    upcoming: [],
  };

  for (const event of Array.isArray(events) ? events : []) {
    const startText = getEventEdge(event, 'start');
    const endText = getEventEdge(event, 'end');
    const startTime = toComparableTime(startText, dayBounds.start.getTime());
    const endTime = toComparableTime(endText, startTime);
    const bucket = endTime < nowTime ? 'ended' : startTime <= nowTime ? 'in_progress' : 'upcoming';

    groups[bucket].push({
      kind: 'event',
      id: event.id || '',
      title: event.title || event.summary || 'Untitled event',
      status: bucket,
      start: startText,
      end: endText,
      location: event.location || '',
      description: event.description || '',
      sortTime: bucket === 'ended' ? endTime : startTime,
      raw: event,
    });
  }

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const isCompleted =
      task?.status === 'completed' ||
      task?.completed === true ||
      typeof task?.completed === 'string' ||
      typeof task?.completedAt === 'string';
    const dueText = typeof task?.due === 'string' ? task.due : '';
    const bucket = isCompleted ? 'ended' : 'in_progress';

    groups[bucket].push({
      kind: 'task',
      id: task.id || '',
      title: task.title || 'Untitled task',
      status: bucket,
      due: dueText,
      notes: task.notes || '',
      taskStatus: task.status || '',
      sortTime: isCompleted ? nowTime : toComparableTime(dueText, dayBounds.start.getTime()),
      raw: task,
    });
  }

  groups.ended.sort((a, b) => b.sortTime - a.sortTime);
  groups.in_progress.sort((a, b) => a.sortTime - b.sortTime);
  groups.upcoming.sort((a, b) => a.sortTime - b.sortTime);

  return {
    success: true,
    date: dayBounds.date,
    now: formatLocalDateTime(now),
    counts: {
      ended: groups.ended.length,
      in_progress: groups.in_progress.length,
      upcoming: groups.upcoming.length,
      total: groups.ended.length + groups.in_progress.length + groups.upcoming.length,
    },
    groups,
    items: [...groups.ended, ...groups.in_progress, ...groups.upcoming],
  };
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  const options = {};

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value;
    i += 1;
  }

  if (!action) {
    throw new Error('Usage: node scripts/google-calendar.js <action> [--key value]');
  }

  return { action, options };
}

function buildContract() {
  return {
    skill: 'google-calandar',
    version: '1',
    output_mode: 'json',
    request_schema_file: 'skills/google-calandar/schemas/calendar-task-request.schema.json',
    execution_entrypoint: 'node skills/google-calandar/scripts/google-calendar.js execute --payload <json>',
    actions: {
      calendar: [
        {
          action: 'daily_brief',
          required: [],
          optional: ['date', 'calendarId', 'tasklistId', 'includeCompleted', 'includeHidden', 'showNotes'],
        },
        {
          action: 'list_events',
          required: [],
          optional: ['days', 'start', 'end', 'calendarId'],
        },
        {
          action: 'create_event',
          required: ['title', 'start', 'end'],
          optional: ['description', 'location', 'calendarId'],
        },
        {
          action: 'update_event',
          required: ['eventId'],
          optional: ['title', 'start', 'end', 'description', 'location'],
        },
        {
          action: 'delete_event',
          required: ['eventId'],
          optional: [],
        },
      ],
      tasks: [
        {
          action: 'list_tasklists',
          required: [],
          optional: [],
        },
        {
          action: 'list_tasks',
          required: [],
          optional: ['tasklistId', 'dueStart', 'dueEnd', 'includeCompleted', 'includeHidden', 'showNotes'],
        },
        {
          action: 'create_task',
          required: ['title'],
          optional: ['notes', 'due', 'tasklistId'],
        },
        {
          action: 'update_task',
          required: ['taskId'],
          optional: ['title', 'notes', 'due', 'tasklistId'],
        },
        {
          action: 'complete_task',
          required: ['taskId'],
          optional: ['tasklistId'],
        },
        {
          action: 'delete_task',
          required: ['taskId'],
          optional: ['tasklistId'],
        },
      ],
    },
    normalization_rules: [
      'Return exactly one JSON object.',
      'Choose one action only.',
      'Use daily_brief when the user asks broad questions like "what should I do today" or wants tasks and events together.',
      'For calendar time fields, use local ISO datetime: YYYY-MM-DDTHH:mm:ss.',
      'For list_events, prefer explicit start/end for natural ranges like today, tomorrow, this week, and this month instead of a rolling now+days window.',
      'A request for "today\'s schedule" should include the full local day from 00:00:00 through 23:59:59.',
      'For daily_brief, include both calendar events and tasks for that local day and classify returned items into ended, in_progress, and upcoming.',
      'For list_tasks, include completed tasks when the user asks for a full-day summary, progress check, or "what did I have today".',
      'For task due fields, prefer date-only YYYY-MM-DD unless the user explicitly gives a time.',
      'For quick capture, default to create_task when the user gives a short reminder without a concrete start/end time, and default to create_event when a concrete meeting time or time range is explicit.',
      'Do not invent eventId or taskId. If missing, list candidates first.',
    ],
  };
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data };
}

async function runDailyBrief(url, options) {
  const dayBounds = getDayBounds(options.date);
  const eventsUrl = new URL(url);
  eventsUrl.searchParams.set('action', 'list_events');
  eventsUrl.searchParams.set('start', formatLocalDateTime(dayBounds.start));
  eventsUrl.searchParams.set('end', formatLocalDateTime(dayBounds.end));
  if (options.calendarId) {
    eventsUrl.searchParams.set('calendarId', options.calendarId);
  }

  const tasksUrl = new URL(url);
  tasksUrl.searchParams.set('action', 'list_tasks');
  tasksUrl.searchParams.set('dueStart', dayBounds.date);
  tasksUrl.searchParams.set('dueEnd', dayBounds.date);
  tasksUrl.searchParams.set('includeCompleted', options.includeCompleted || 'true');
  if (options.tasklistId) {
    tasksUrl.searchParams.set('tasklistId', options.tasklistId);
  }
  if (options.includeHidden) {
    tasksUrl.searchParams.set('includeHidden', options.includeHidden);
  }
  if (options.showNotes) {
    tasksUrl.searchParams.set('showNotes', options.showNotes);
  }

  const [eventsResult, tasksResult] = await Promise.all([getJson(eventsUrl.toString()), getJson(tasksUrl.toString())]);
  if (!(eventsResult.status >= 200 && eventsResult.status < 300)) {
    return {
      status: eventsResult.status,
      data: {
        success: false,
        failed_action: 'list_events',
        response: eventsResult.data,
      },
      request: {
        method: 'LOCAL',
        action: 'daily_brief',
        upstream: [
          { method: 'GET', url: eventsUrl.toString() },
          { method: 'GET', url: tasksUrl.toString() },
        ],
      },
    };
  }
  if (!(tasksResult.status >= 200 && tasksResult.status < 300)) {
    return {
      status: tasksResult.status,
      data: {
        success: false,
        failed_action: 'list_tasks',
        response: tasksResult.data,
      },
      request: {
        method: 'LOCAL',
        action: 'daily_brief',
        upstream: [
          { method: 'GET', url: eventsUrl.toString() },
          { method: 'GET', url: tasksUrl.toString() },
        ],
      },
    };
  }

  return {
    status: 200,
    data: buildDailyBrief(eventsResult.data?.events, tasksResult.data?.tasks, { date: dayBounds.date }),
    request: {
      method: 'LOCAL',
      action: 'daily_brief',
      upstream: [
        { method: 'GET', url: eventsUrl.toString() },
        { method: 'GET', url: tasksUrl.toString() },
      ],
    },
  };
}

function buildRequest(url, action, options) {
  if (action === 'describe') {
    return { method: 'LOCAL', data: buildContract() };
  }

  if (action === 'execute') {
    if (!options.payload && !options.payloadFile) {
      throw new Error('execute requires --payload or --payloadFile');
    }

    let payloadText = options.payload;
    if (options.payloadFile) {
      payloadText = fs.readFileSync(options.payloadFile, 'utf8');
    }
    payloadText = stripBom(payloadText);

    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (error) {
      throw new Error(`Invalid JSON in execute payload: ${error.message}`);
    }

    if (!payload.action || typeof payload.action !== 'string') {
      throw new Error('execute payload must include string field "action"');
    }

    const executeOptions = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key !== 'action' && value !== undefined && value !== null) {
        executeOptions[key] = String(value);
      }
    }

    return buildRequest(url, payload.action, executeOptions);
  }

  if (action === 'list_events') {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('action', 'list_events');
    if (options.start || options.end) {
      if (!options.start || !options.end) {
        throw new Error('list_events requires both --start and --end when using an explicit range');
      }
      requestUrl.searchParams.set('start', options.start);
      requestUrl.searchParams.set('end', options.end);
    } else {
      const days = options.days || '7';
      requestUrl.searchParams.set('days', days);
    }
    if (options.calendarId) {
      requestUrl.searchParams.set('calendarId', options.calendarId);
    }
    return { method: 'GET', url: requestUrl.toString() };
  }

  if (action === 'list_tasklists') {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('action', 'list_tasklists');
    return { method: 'GET', url: requestUrl.toString() };
  }

  if (action === 'list_tasks') {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('action', 'list_tasks');
    if (options.tasklistId) {
      requestUrl.searchParams.set('tasklistId', options.tasklistId);
    }
    if ((options.dueStart && !options.dueEnd) || (!options.dueStart && options.dueEnd)) {
      throw new Error('list_tasks requires both --dueStart and --dueEnd when using a due-date range');
    }
    if (options.dueStart) {
      requestUrl.searchParams.set('dueStart', options.dueStart);
      requestUrl.searchParams.set('dueEnd', options.dueEnd);
    }
    for (const key of ['includeCompleted', 'includeHidden', 'showNotes']) {
      if (options[key]) {
        requestUrl.searchParams.set(key, options[key]);
      }
    }
    return { method: 'GET', url: requestUrl.toString() };
  }

  if (action === 'daily_brief') {
    return {
      method: 'LOCAL_DAILY_BRIEF',
      url,
      options,
    };
  }

  if (action === 'create_event') {
    if (!options.title || !options.start || !options.end) {
      throw new Error('create_event requires --title, --start, and --end');
    }

    return {
      method: 'POST',
      url,
      body: {
        action: 'create_event',
        title: options.title,
        start: options.start,
        end: options.end,
        description: options.description || '',
        location: options.location || '',
        ...(options.calendarId ? { calendarId: options.calendarId } : {}),
      },
    };
  }

  if (action === 'update_event') {
    if (!options.eventId) {
      throw new Error('update_event requires --eventId');
    }
    if ((options.start && !options.end) || (!options.start && options.end)) {
      throw new Error('update_event requires both --start and --end when changing time');
    }

    const body = {
      action: 'update_event',
      eventId: options.eventId,
    };

    for (const key of ['title', 'description', 'location', 'start', 'end']) {
      if (options[key]) {
        body[key] = options[key];
      }
    }

    return { method: 'POST', url, body };
  }

  if (action === 'delete_event') {
    if (!options.eventId) {
      throw new Error('delete_event requires --eventId');
    }

    return {
      method: 'POST',
      url,
      body: {
        action: 'delete_event',
        eventId: options.eventId,
      },
    };
  }

  if (action === 'create_task') {
    if (!options.title) {
      throw new Error('create_task requires --title');
    }

    return {
      method: 'POST',
      url,
      body: {
        action: 'create_task',
        title: options.title,
        ...(options.notes ? { notes: options.notes } : {}),
        ...(options.due ? { due: options.due } : {}),
        ...(options.tasklistId ? { tasklistId: options.tasklistId } : {}),
      },
    };
  }

  if (action === 'update_task') {
    if (!options.taskId) {
      throw new Error('update_task requires --taskId');
    }

    const body = {
      action: 'update_task',
      taskId: options.taskId,
    };

    for (const key of ['tasklistId', 'title', 'notes', 'due']) {
      if (options[key]) {
        body[key] = options[key];
      }
    }

    return { method: 'POST', url, body };
  }

  if (action === 'complete_task') {
    if (!options.taskId) {
      throw new Error('complete_task requires --taskId');
    }

    return {
      method: 'POST',
      url,
      body: {
        action: 'complete_task',
        taskId: options.taskId,
        ...(options.tasklistId ? { tasklistId: options.tasklistId } : {}),
      },
    };
  }

  if (action === 'delete_task') {
    if (!options.taskId) {
      throw new Error('delete_task requires --taskId');
    }

    return {
      method: 'POST',
      url,
      body: {
        action: 'delete_task',
        taskId: options.taskId,
        ...(options.tasklistId ? { tasklistId: options.tasklistId } : {}),
      },
    };
  }

  throw new Error(`Unsupported action: ${action}`);
}

async function main() {
  try {
    const skillDir = path.resolve(__dirname, '..');
    const url = loadUrl(path.join(skillDir, 'url.txt'));
    const { action, options } = parseArgs(process.argv.slice(2));
    const request = buildRequest(url, action, options);

    const response =
      request.method === 'LOCAL'
        ? { status: 200, data: request.data }
        : request.method === 'LOCAL_DAILY_BRIEF'
        ? await runDailyBrief(request.url, request.options)
        : request.method === 'GET'
        ? await getJson(request.url)
        : await postJson(request.url, request.body);

    console.log(
      JSON.stringify(
        {
          ok: response.status >= 200 && response.status < 300,
          action,
          status: response.status,
          request:
            request.method === 'LOCAL_DAILY_BRIEF'
              ? response.request
              : request.method === 'GET'
              ? { method: request.method, url: request.url }
              : { method: request.method, url: request.url, body: request.body },
          response: response.data,
        },
        null,
        2,
      ),
    );

    if (!(response.status >= 200 && response.status < 300)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

main();
