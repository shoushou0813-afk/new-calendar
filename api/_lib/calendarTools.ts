/**
 * Claude のチャット(MCP)から使う、予定・タスクの操作。
 * どれも「今のデータ」を受け取って「変更(ops)と返事」を返す純粋関数なので、テストしやすく、同時書き込みのやり直しにも使える。
 */
import type { CloudDoc, CloudEvent, CloudOp } from './cloudDoc.js';

type Rec = Record<string, unknown>;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ToolResult {
  ops: CloudOp[];
  result: unknown;
}

/** 日本時間の今日(yyyy-MM-dd)。サーバーは UTC で動いているので明示する。 */
export function todayInTokyo(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fail(message: string): ToolResult {
  return { ops: [], result: { ok: false, error: message } };
}

/** チャットに返す予定の形(画像などの大きい項目や内部用の項目は省く) */
function eventSummary(e: CloudEvent): Rec {
  const allDay = e.starts_at === '00:00' && !e.ends_at;
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    start: allDay ? '終日' : e.starts_at,
    end: e.ends_at ?? null,
    category: e.category,
    note: e.note ?? null,
    has_image: Boolean(e.image),
  };
}

function taskSummary(t: Rec): Rec {
  const estimated = Number(t.estimated_minutes) || 0;
  const spent = Number(t.spent_minutes) || 0;
  return {
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    deadline_time: t.deadline_time ?? null,
    estimated_minutes: estimated,
    spent_minutes: spent,
    remaining_minutes: Math.max(0, estimated - spent),
    priority: t.priority,
    done: Boolean(t.done),
    note: t.note ?? null,
  };
}

export function listEvents(doc: CloudDoc, args: { from?: string; to?: string; query?: string }, now = new Date()): ToolResult {
  const from = args.from ?? todayInTokyo(now);
  const to = args.to ?? addDays(from, 13);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail('from / to は yyyy-MM-dd で指定してください。');
  const q = args.query?.trim();
  const events = Object.values(doc.events)
    .filter((e) => String(e.date) >= from && String(e.date) <= to)
    .filter((e) => !q || `${e.title} ${e.note ?? ''}`.includes(q))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.starts_at).localeCompare(String(b.starts_at)))
    .map(eventSummary);
  return { ops: [], result: { from, to, count: events.length, events } };
}

export interface AddEventArgs {
  title: string;
  date: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  category?: string;
  note?: string;
}

export function addEvent(_doc: CloudDoc, args: AddEventArgs, now = new Date(), id: string = crypto.randomUUID()): ToolResult {
  if (!args.title.trim()) return fail('title が空です。');
  if (!DATE_RE.test(args.date)) return fail('date は yyyy-MM-dd で指定してください。');
  const allDay = args.all_day || !args.start;
  if (!allDay && !TIME_RE.test(args.start!)) return fail('start は HH:mm(24時間)で指定してください。');
  if (args.end && !TIME_RE.test(args.end)) return fail('end は HH:mm(24時間)で指定してください。');
  if (!allDay && args.end && args.end <= args.start!) return fail('end は start より後にしてください(日をまたぐ予定は end を省略)。');
  const ts = now.toISOString();
  const record: CloudEvent = {
    id,
    title: args.title.trim(),
    category: args.category?.trim() || 'その他',
    date: args.date,
    doors_at: null,
    starts_at: allDay ? '00:00' : args.start!,
    ends_at: allDay ? null : (args.end ?? null),
    source_url: null,
    image: null,
    note: args.note?.trim() || null,
    has_alarm: false,
    // チャットで日時を確認して入れているので、アプリの「時刻ミス検知」の警告は出さない
    time_confirmed: true,
    warnings: [],
    memory_checked_at: null,
    miss_count: 0,
    task_id: null,
    created_at: ts,
    updated_at: ts,
  };
  return { ops: [{ op: 'put', collection: 'events', record }], result: { ok: true, added: eventSummary(record) } };
}

export interface UpdateEventArgs {
  id: string;
  title?: string;
  date?: string;
  start?: string;
  end?: string | null;
  category?: string;
  note?: string | null;
}

export function updateEvent(doc: CloudDoc, args: UpdateEventArgs, now = new Date()): ToolResult {
  const current = doc.events[args.id];
  if (!current) return fail('その id の予定が見つかりません。list_events で id を確かめてください。');
  if (args.date !== undefined && !DATE_RE.test(args.date)) return fail('date は yyyy-MM-dd で指定してください。');
  if (args.start !== undefined && !TIME_RE.test(args.start)) return fail('start は HH:mm で指定してください。');
  if (args.end && !TIME_RE.test(args.end)) return fail('end は HH:mm で指定してください。');
  const next: CloudEvent = {
    ...current,
    ...(args.title !== undefined ? { title: args.title.trim() } : {}),
    ...(args.date !== undefined ? { date: args.date } : {}),
    ...(args.start !== undefined ? { starts_at: args.start } : {}),
    ...(args.end !== undefined ? { ends_at: args.end } : {}),
    ...(args.category !== undefined ? { category: args.category } : {}),
    ...(args.note !== undefined ? { note: args.note } : {}),
    updated_at: now.toISOString(),
  };
  if (next.ends_at && String(next.ends_at) <= String(next.starts_at)) return fail('end は start より後にしてください。');
  return { ops: [{ op: 'put', collection: 'events', record: next }], result: { ok: true, updated: eventSummary(next) } };
}

export function deleteEvent(doc: CloudDoc, args: { id: string }): ToolResult {
  const current = doc.events[args.id];
  if (!current) return fail('その id の予定が見つかりません。');
  const ops: CloudOp[] = [{ op: 'delete', collection: 'events', key: args.id }];
  // Googleと同期済みの予定なら、次の同期でGoogleからも消えるよう記録する(アプリでの削除と同じ扱い)
  if (typeof current.google_event_id === 'string' && current.google_event_id) {
    ops.push({ op: 'put', collection: 'tombstones', key: current.google_event_id });
  }
  return { ops, result: { ok: true, deleted: eventSummary(current) } };
}

export function listTasks(doc: CloudDoc, args: { include_done?: boolean }): ToolResult {
  const tasks = Object.values(doc.tasks)
    .filter((t) => args.include_done || !t.done)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .map(taskSummary);
  return { ops: [], result: { count: tasks.length, tasks } };
}

export interface AddTaskArgs {
  title: string;
  deadline: string;
  deadline_time?: string;
  estimated_minutes: number;
  priority?: 'high' | 'normal' | 'low';
  note?: string;
}

export function addTask(_doc: CloudDoc, args: AddTaskArgs, now = new Date(), id: string = crypto.randomUUID()): ToolResult {
  if (!args.title.trim()) return fail('title が空です。');
  if (!DATE_RE.test(args.deadline)) return fail('deadline は yyyy-MM-dd で指定してください。');
  if (args.deadline_time && !TIME_RE.test(args.deadline_time)) return fail('deadline_time は HH:mm で指定してください。');
  if (!(args.estimated_minutes > 0)) return fail('estimated_minutes は 1 以上にしてください。');
  const ts = now.toISOString();
  const record = {
    id,
    title: args.title.trim(),
    deadline: args.deadline,
    deadline_time: args.deadline_time ?? null,
    estimated_minutes: Math.round(args.estimated_minutes),
    spent_minutes: 0,
    priority: args.priority ?? 'normal',
    note: args.note?.trim() || null,
    done: false,
    created_at: ts,
    updated_at: ts,
  };
  return { ops: [{ op: 'put', collection: 'tasks', record }], result: { ok: true, added: taskSummary(record) } };
}

export interface UpdateTaskArgs {
  id: string;
  title?: string;
  deadline?: string;
  deadline_time?: string | null;
  estimated_minutes?: number;
  spent_minutes?: number;
  priority?: 'high' | 'normal' | 'low';
  note?: string | null;
  done?: boolean;
}

export function updateTask(doc: CloudDoc, args: UpdateTaskArgs, now = new Date()): ToolResult {
  const current = doc.tasks[args.id];
  if (!current) return fail('その id のタスクが見つかりません。list_tasks で id を確かめてください。');
  if (args.deadline !== undefined && !DATE_RE.test(args.deadline)) return fail('deadline は yyyy-MM-dd で指定してください。');
  if (args.deadline_time && !TIME_RE.test(args.deadline_time)) return fail('deadline_time は HH:mm で指定してください。');
  const { id: _id, ...patch } = args;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: Rec & { id: string } = { ...current, ...defined, id: current.id, updated_at: now.toISOString() };
  const estimated = Number(next.estimated_minutes) || 0;
  next.spent_minutes = Math.min(Math.max(0, Number(next.spent_minutes) || 0), estimated);
  return { ops: [{ op: 'put', collection: 'tasks', record: next }], result: { ok: true, updated: taskSummary(next) } };
}

export function deleteTask(doc: CloudDoc, args: { id: string }): ToolResult {
  const current = doc.tasks[args.id];
  if (!current) return fail('その id のタスクが見つかりません。');
  return { ops: [{ op: 'delete', collection: 'tasks', key: args.id }], result: { ok: true, deleted: taskSummary(current) } };
}
