import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { EventRow } from '../types/event';
import type { Task, TaskDraft, TaskPriority } from '../types/task';

/** タイトルに【締切】【締切 12:00】【予備締切】【期限…】などが付いた予定か */
export function isDeadlineEvent(e: Pick<EventRow, 'title'>): boolean {
  return /【[^】]*(締切|〆切|期限)[^】]*】/.test(e.title);
}

function isBackupDeadline(title: string): boolean {
  return /【[^】]*予備[^】]*】/.test(title);
}

/** 先頭の【締切…】を外して、タスク名として読みやすくする */
export function taskTitleFromEvent(title: string): string {
  const stripped = title.replace(/^\s*【[^】]*(締切|〆切|期限)[^】]*】\s*/, '').trim() || title;
  return isBackupDeadline(title) ? `${stripped}(予備)` : stripped;
}

/** タイトルから作業時間(分)の目安を決める。あとで1件ずつ変更できる。 */
export function estimateMinutes(title: string): number {
  const es = /ES|エントリーシート|書類|レポート|課題/.test(title);
  const test = /適性|SPI|テスト|受検|Web\s*テスト/.test(title);
  if (es && test) return 180;
  if (es) return 120;
  if (test) return 90;
  return 60;
}

export interface DeadlineCandidate {
  event: EventRow;
  draft: TaskDraft;
  /** 同じ名前・締切のタスクがすでにある */
  alreadyAdded: boolean;
  /** 最初からチェックを入れておくか(登録済み・予備締切は外す) */
  defaultChecked: boolean;
}

/** 今日以降の締切予定から、タスクにする候補を作る */
export function deadlineCandidates(events: EventRow[], tasks: Task[], today: string): DeadlineCandidate[] {
  const existing = new Set(tasks.map((t) => `${t.title}|${t.deadline}`));
  return events
    .filter((e) => isDeadlineEvent(e) && !e.task_id && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.starts_at.localeCompare(b.starts_at))
    .map((event) => {
      const title = taskTitleFromEvent(event.title);
      // 時刻つきの締切は「終了時刻」を締切とみなす(例: 11:00〜12:00 の予定 → 12:00 締切)。
      // 終日の締切(0:00開始・終了なし)は締切日の終わりまで。
      const allDay = event.starts_at === '00:00' && !event.ends_at;
      const deadlineTime = allDay ? null : (event.ends_at ?? event.starts_at);
      const daysLeft = differenceInCalendarDays(parseISO(event.date), parseISO(today));
      const backup = isBackupDeadline(event.title);
      const priority: TaskPriority = backup ? 'low' : daysLeft <= 3 ? 'high' : 'normal';
      const alreadyAdded = existing.has(`${title}|${event.date}`);
      return {
        event,
        alreadyAdded,
        defaultChecked: !alreadyAdded && !backup,
        draft: {
          title,
          deadline: event.date,
          deadline_time: deadlineTime,
          estimated_minutes: estimateMinutes(event.title),
          spent_minutes: 0,
          priority,
          note: event.note,
          done: false,
        },
      };
    });
}
