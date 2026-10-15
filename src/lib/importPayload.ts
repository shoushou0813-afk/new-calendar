import type { TaskDraft, TaskPriority } from '../types/task';

/**
 * 取り込みリンク/貼り付けの中身。
 * - .ics のテキストそのもの(予定だけ)
 * - JSON {"ics": "...", "tasks": [...], "removeEvents": [...], "removeTasks": [...]}
 *   (予定とタスクの追加に加えて、登録済みの予定・タスクの削除もまとめて渡す)
 */
export interface ImportPayload {
  ics: string;
  tasks: TaskDraft[];
  /** 消す予定(日付・開始時刻・タイトルが一致するもの) */
  removeEvents: { date: string; starts_at: string; title: string }[];
  /** 消すタスク(名前と締切日が一致するもの) */
  removeTasks: { title: string; deadline: string }[];
}

const PRIORITIES: TaskPriority[] = ['high', 'normal', 'low'];

function toTaskDraft(raw: unknown): TaskDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const deadline = typeof r.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) ? r.deadline : null;
  const estimated = typeof r.estimated_minutes === 'number' && r.estimated_minutes > 0 ? Math.round(r.estimated_minutes) : null;
  if (!title || !deadline || !estimated) return null;
  const time = typeof r.deadline_time === 'string' && /^\d{2}:\d{2}$/.test(r.deadline_time) ? r.deadline_time : null;
  const spent = typeof r.spent_minutes === 'number' && r.spent_minutes > 0 ? Math.min(Math.round(r.spent_minutes), estimated) : 0;
  return {
    title,
    deadline,
    deadline_time: time,
    estimated_minutes: estimated,
    spent_minutes: spent,
    priority: PRIORITIES.includes(r.priority as TaskPriority) ? (r.priority as TaskPriority) : 'normal',
    note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
    done: false,
  };
}

export function parseImportPayload(text: string): ImportPayload {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return { ics: text, tasks: [], removeEvents: [], removeTasks: [] };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error('取り込みデータを読み取れませんでした。');
  }
  const obj = (data ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(obj.tasks) ? obj.tasks.map(toTaskDraft).filter((t): t is TaskDraft => t !== null) : [];
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : []);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const removeEvents = list(obj.removeEvents)
    .map((r) => ({ date: str(r.date), starts_at: str(r.starts_at), title: str(r.title) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}$/.test(r.starts_at) && r.title);
  const removeTasks = list(obj.removeTasks)
    .map((r) => ({ title: str(r.title), deadline: str(r.deadline) }))
    .filter((r) => r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline));
  return { ics: typeof obj.ics === 'string' ? obj.ics : '', tasks, removeEvents, removeTasks };
}
