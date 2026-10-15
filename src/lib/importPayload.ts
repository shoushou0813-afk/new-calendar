import type { TaskDraft, TaskPriority } from '../types/task';

/**
 * 取り込みリンク/貼り付けの中身。
 * - .ics のテキストそのもの(予定だけ)
 * - JSON {"ics": "...", "tasks": [...]}(予定とタスクをまとめて渡す)
 */
export interface ImportPayload {
  ics: string;
  tasks: TaskDraft[];
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
  if (!trimmed.startsWith('{')) return { ics: text, tasks: [] };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error('取り込みデータを読み取れませんでした。');
  }
  const obj = (data ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(obj.tasks) ? obj.tasks.map(toTaskDraft).filter((t): t is TaskDraft => t !== null) : [];
  return { ics: typeof obj.ics === 'string' ? obj.ics : '', tasks };
}
