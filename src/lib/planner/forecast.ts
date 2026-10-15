import { addDays, format, parseISO } from 'date-fns';
import type { EventRow } from '../../types/event';
import type { DayPlan, PlanItem, Task } from '../../types/task';
import type { AppSettings } from '../settings';
import { toMinutes } from './freeSlots';
import { planLocally } from './localPlanner';
import { buildPlanningContext } from './planningContext';

export interface ForecastDay {
  date: string;
  /** その日にやること(終わったもの・完了済みタスクのものは除く) */
  items: PlanItem[];
  /** チェック済みの項目 */
  doneItems: PlanItem[];
  /** saved: 保存済みの計画 / forecast: 自動で出した見込み(まだ保存されていない) */
  source: 'saved' | 'forecast';
  plan: DayPlan;
  /** この日が締切の未完了タスク */
  deadlines: Task[];
}

function minutesOf(item: PlanItem): number {
  return toMinutes(item.end) - toMinutes(item.start);
}

/**
 * 開始日から days 日分の「やること」を出す。
 * 保存済みの計画がある日はそれを使い、ない日は自動割り当て(planLocally)で見込みを出す。
 * 前の日に予定どおり進んだ前提でタスクの残り時間を減らしながら、1日ずつ順に計算する。
 */
export function forecastDays(params: {
  startDate: string;
  days: number;
  now: Date;
  tasks: Task[];
  events: EventRow[];
  settings: AppSettings;
  savedPlans: Map<string, DayPlan>;
}): ForecastDay[] {
  const { startDate, days, now, events, settings, savedPlans } = params;
  // シミュレーション用のコピー(実際のタスクは書き換えない)
  const sim = params.tasks.map((t) => ({ ...t }));
  const realById = new Map(params.tasks.map((t) => [t.id, t]));
  const result: ForecastDay[] = [];

  for (let i = 0; i < days; i++) {
    const date = format(addDays(parseISO(startDate), i), 'yyyy-MM-dd');
    const saved = savedPlans.get(date);
    let plan: DayPlan;
    let source: ForecastDay['source'];

    if (saved) {
      plan = saved;
      source = 'saved';
    } else {
      const ctx = buildPlanningContext({ date, now, tasks: sim, events, settings });
      const planned = planLocally(ctx);
      // 見込みは毎回計算し直すので、チェックしたときに同じ項目だとわかるようIDを決め打ちにする
      const items = planned.items.map((item) => ({ ...item, id: `${date}-${item.task_id}-${item.start}` }));
      plan = { date, ...planned, items, generated_by: 'local', created_at: '' };
      source = 'forecast';
    }

    // 削除されたタスク・完了にしたタスクの項目は出さない
    const live = plan.items.filter((item) => {
      const task = realById.get(item.task_id);
      return task && !task.done;
    });
    const items = live.filter((item) => !item.done);
    const doneItems = plan.items.filter((item) => item.done && realById.has(item.task_id));

    // この日の予定どおり進む前提で、翌日以降の残り時間を減らす(チェック済みの分は実際の進捗に反映済み)
    for (const item of items) {
      const task = sim.find((t) => t.id === item.task_id);
      if (task) task.spent_minutes = Math.min(task.estimated_minutes, task.spent_minutes + minutesOf(item));
    }

    const deadlines = params.tasks.filter((t) => !t.done && t.deadline === date);
    result.push({ date, items, doneItems, source, plan, deadlines });
  }
  return result;
}
