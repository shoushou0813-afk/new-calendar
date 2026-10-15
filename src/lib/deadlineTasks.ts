import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
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

/**
 * 練習・準備が必要な予定か。
 * - lesson: 「〜レッスン」→ レッスンまでに練習する
 * - exam:   「本番」「試験」「検定」など → 前の日までに勉強する
 * 締切の予定や、テストセンター(会場予約の話)は対象外。
 */
export function practiceKind(e: Pick<EventRow, 'title'>): 'lesson' | 'exam' | null {
  if (isDeadlineEvent(e)) return null;
  if (/レッスン/.test(e.title)) return 'lesson';
  if (/本番|試験|検定|模試|(?<!Web)テスト(?!センター)/.test(e.title)) return 'exam';
  return null;
}

function practiceTitle(title: string, kind: 'lesson' | 'exam', date: string): string {
  const md = format(parseISO(date), 'M/d');
  if (kind === 'lesson') {
    const subject = title.replace(/レッスン/g, '').trim() || title;
    return `${subject}の練習(${md}のレッスンまで)`;
  }
  const subject = title.replace(/本番/g, '').trim() || title;
  return `${subject}の勉強(${md}まで)`;
}

export interface DeadlineCandidate {
  /** submit: 提出(【締切】の予定) / practice: 練習・準備(レッスン・試験など) */
  kind: 'submit' | 'practice';
  event: EventRow;
  draft: TaskDraft;
  /** 同じ名前・締切のタスクがすでにある */
  alreadyAdded: boolean;
  /** 最初からチェックを入れておくか(登録済み・予備締切は外す) */
  defaultChecked: boolean;
}

/** 今日以降の締切予定と、練習・準備が必要な予定から、タスクにする候補を作る */
export function deadlineCandidates(events: EventRow[], tasks: Task[], today: string): DeadlineCandidate[] {
  return [...submitCandidates(events, tasks, today), ...practiceCandidates(events, tasks, today)].sort(
    (a, b) =>
      a.draft.deadline.localeCompare(b.draft.deadline) || (a.draft.deadline_time ?? '99').localeCompare(b.draft.deadline_time ?? '99'),
  );
}

function practiceCandidates(events: EventRow[], tasks: Task[], today: string): DeadlineCandidate[] {
  const existing = new Set(tasks.map((t) => `${t.title}|${t.deadline}`));
  return events
    .filter((e) => !e.task_id && e.date >= today && practiceKind(e) !== null)
    .map((event) => {
      const kind = practiceKind(event)!;
      // レッスンは開始時刻まで、試験・本番は前の日の終わりまでに終わらせる
      const deadline = kind === 'lesson' ? event.date : format(addDays(parseISO(event.date), -1), 'yyyy-MM-dd');
      const usable = deadline >= today ? deadline : event.date;
      const title = practiceTitle(event.title, kind, event.date);
      const daysLeft = differenceInCalendarDays(parseISO(usable), parseISO(today));
      const alreadyAdded = existing.has(`${title}|${usable}`);
      return {
        kind: 'practice' as const,
        event,
        alreadyAdded,
        defaultChecked: !alreadyAdded,
        draft: {
          title,
          deadline: usable,
          deadline_time: kind === 'lesson' && event.starts_at !== '00:00' ? event.starts_at : null,
          estimated_minutes: kind === 'lesson' ? 90 : /本番|検定/.test(event.title) ? 300 : 180,
          spent_minutes: 0,
          priority: daysLeft <= 3 ? ('high' as const) : ('normal' as const),
          note: event.note,
          done: false,
        },
      };
    });
}

function submitCandidates(events: EventRow[], tasks: Task[], today: string): DeadlineCandidate[] {
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
        kind: 'submit' as const,
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
