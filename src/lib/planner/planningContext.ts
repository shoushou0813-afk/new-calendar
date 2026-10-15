import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { EventRow } from '../../types/event';
import type { Task } from '../../types/task';
import { isDeadlineEvent } from '../deadlineTasks';
import type { AppSettings } from '../settings';
import { freeSlots, toMinutes, totalMinutes, type Slot } from './freeSlots';

export interface TaskPlanningInfo {
  task: Task;
  /** 残りの作業時間(分) */
  remaining: number;
  /** 計画日から締切日まで何日あるか(締切日が計画日なら0、過ぎていれば負) */
  daysUntilDeadline: number;
  overdue: boolean;
  /** 締切に間に合わせるために「この日にやらないと絶対に間に合わない」分数 */
  mandatoryToday: number;
  /** 毎日同じペースで進めた場合の1日あたりの分数 */
  paceToday: number;
  /** 空き時間が足りず、締切までにどうしても終わらない分数(0なら間に合う) */
  shortage: number;
}

export interface PlanningContext {
  /** 計画する日 yyyy-MM-dd */
  date: string;
  /** 計画日の空き時間(分単位) */
  slots: Slot[];
  /** 計画日から最後の締切日までの各日の空き時間(分) */
  dailyFreeMinutes: { date: string; freeMinutes: number }[];
  /** 計画日の予定(AIに渡す用) */
  dayEvents: EventRow[];
  tasks: TaskPlanningInfo[];
  settings: AppSettings;
}

/** 休憩を挟むので、空き時間のうち実際に作業に使えるのはこの割合 */
function workRatio(settings: AppSettings): number {
  return settings.maxBlockMinutes / (settings.maxBlockMinutes + settings.breakMinutes);
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * プランナー(ローカル版・AI版共通)の入力をまとめる。
 *
 * 締切に間に合うかは「遅延スケジューリング」で判定する:締切の遅いタスクから順に、締切日から
 * さかのぼって空き時間に詰めていき、それでも計画日にはみ出した分が「今日やらないと間に合わない分」
 * (mandatoryToday)になる。複数のタスクで空き時間を取り合う状況も正しく扱える。
 */
export function buildPlanningContext(params: {
  date: string;
  now: Date;
  tasks: Task[];
  events: EventRow[];
  settings: AppSettings;
}): PlanningContext {
  const { date, now, events, settings } = params;
  const planDate = parseISO(date);
  const isToday = format(now, 'yyyy-MM-dd') === date;
  const isPast = differenceInCalendarDays(planDate, now) < 0;

  // AIが入れた作業ブロックと、締切を示すだけの予定(【締切】…)は、空き時間を埋めるものとして扱わない
  const eventsOn = (d: string) => events.filter((e) => e.date === d && !e.task_id && !isDeadlineEvent(e));
  const slotsFor = (d: string, notBefore: number) => freeSlots(eventsOn(d), settings.workStart, settings.workEnd, notBefore);

  const activeTasks = params.tasks.filter((t) => !t.done && t.estimated_minutes - t.spent_minutes > 0);
  const lastDeadline = activeTasks.reduce((max, t) => (t.deadline > max ? t.deadline : max), date);
  const horizon = Math.max(0, differenceInCalendarDays(parseISO(lastDeadline), planDate));

  const ratio = workRatio(settings);
  const dayDates: string[] = [];
  const daySlots: Slot[][] = [];
  for (let i = 0; i <= horizon; i++) {
    const d = format(addDays(planDate, i), 'yyyy-MM-dd');
    dayDates.push(d);
    const notBefore = i === 0 && isToday ? minutesOfDay(now) : 0;
    daySlots.push(isPast ? [] : slotsFor(d, notBefore));
  }
  const remainingCap = daySlots.map((s) => Math.floor(totalMinutes(s) * ratio));

  const infos: TaskPlanningInfo[] = activeTasks.map((task) => {
    const daysUntilDeadline = differenceInCalendarDays(parseISO(task.deadline), planDate);
    return {
      task,
      remaining: task.estimated_minutes - task.spent_minutes,
      daysUntilDeadline,
      overdue: daysUntilDeadline < 0,
      mandatoryToday: 0,
      paceToday: 0,
      shortage: 0,
    };
  });

  // 遅延スケジューリング(締切の遅い順に、締切日からさかのぼって詰める)
  const byDeadlineDesc = [...infos].sort(
    (a, b) => b.task.deadline.localeCompare(a.task.deadline) || (b.task.deadline_time ?? '99').localeCompare(a.task.deadline_time ?? '99'),
  );
  for (const info of byDeadlineDesc) {
    let need = info.remaining;
    const lastIdx = Math.max(0, info.daysUntilDeadline);
    for (let i = lastIdx; i >= 0 && need > 0; i--) {
      let available = remainingCap[i];
      // 締切時刻があるなら、締切日はその時刻より前しか使えない
      if (i === info.daysUntilDeadline && info.task.deadline_time) {
        const cutoff = toMinutes(info.task.deadline_time);
        const before = daySlots[i].reduce((sum, s) => sum + Math.max(0, Math.min(s.end, cutoff) - s.start), 0);
        available = Math.min(available, Math.floor(before * ratio));
      }
      const take = Math.min(need, available);
      remainingCap[i] -= take;
      need -= take;
      if (i === 0) info.mandatoryToday += take;
    }
    info.shortage = need;
    if (info.overdue) info.mandatoryToday = info.remaining;
  }

  for (const info of infos) {
    if (info.overdue || info.daysUntilDeadline === 0) {
      info.paceToday = info.remaining;
      continue;
    }
    // 空き時間のある日数で均等割り(予定で埋まっている日は数えない)
    const workableDays = dayDates
      .slice(0, info.daysUntilDeadline + 1)
      .filter((_, i) => totalMinutes(daySlots[i]) > 0).length;
    info.paceToday = workableDays > 0 ? Math.ceil(info.remaining / workableDays) : info.remaining;
  }

  return {
    date,
    slots: daySlots[0] ?? [],
    dailyFreeMinutes: dayDates.map((d, i) => ({ date: d, freeMinutes: totalMinutes(daySlots[i]) })),
    dayEvents: eventsOn(date),
    tasks: infos,
    settings,
  };
}
