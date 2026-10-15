import type { PlanItem } from '../../types/task';
import { toHHmm, type Slot } from './freeSlots';
import type { PlanningContext, TaskPlanningInfo } from './planningContext';

export interface PlanResult {
  items: PlanItem[];
  summary: string;
  warnings: string[];
}

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;
const MIN_CHUNK = 15;

function roundUp5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

function compareTasks(a: TaskPlanningInfo, b: TaskPlanningInfo): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    a.task.deadline.localeCompare(b.task.deadline) ||
    PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority]
  );
}

/**
 * AIを使わない計画。締切に間に合わせるのに必要な分(mandatoryToday)を先に確保し、
 * 残りの空き時間で毎日のペース(paceToday)まで前倒しで進める。
 */
export function planLocally(ctx: PlanningContext): PlanResult {
  const { settings } = ctx;
  const ordered = [...ctx.tasks].sort(compareTasks);
  const capacity = ctx.slots.reduce((sum, s) => sum + (s.end - s.start), 0);
  const ratio = settings.maxBlockMinutes / (settings.maxBlockMinutes + settings.breakMinutes);
  let budget = Math.floor(capacity * ratio);

  // 1周目:間に合わせるのに必須の分、2周目:ペース配分のための上乗せ分
  const minutesFor = new Map<string, number>();
  for (const info of ordered) {
    const want = Math.min(roundUp5(info.mandatoryToday), info.remaining);
    const give = Math.min(want, budget);
    minutesFor.set(info.task.id, give);
    budget -= give;
  }
  for (const info of ordered) {
    const current = minutesFor.get(info.task.id) ?? 0;
    const target = Math.min(roundUp5(Math.max(info.paceToday, info.mandatoryToday)), info.remaining);
    const extra = Math.min(Math.max(0, target - current), budget);
    if (extra < MIN_CHUNK && current + extra < info.remaining) continue;
    minutesFor.set(info.task.id, current + extra);
    budget -= extra;
  }

  const items = layout(ctx.slots, ordered, minutesFor, settings.maxBlockMinutes, settings.breakMinutes);

  const placed = new Map<string, number>();
  for (const item of items) {
    placed.set(item.task_id, (placed.get(item.task_id) ?? 0) + duration(item));
  }

  const warnings: string[] = [];
  for (const info of ordered) {
    const got = placed.get(info.task.id) ?? 0;
    if (info.overdue) warnings.push(`「${info.task.title}」は締切(${info.task.deadline})を過ぎています。`);
    else if (info.shortage > 0)
      warnings.push(`「${info.task.title}」は空き時間が約${info.shortage}分足りず、このままだと締切に間に合いません。予定を減らすか見積もりを見直してください。`);
    if (!info.overdue && got < info.mandatoryToday)
      warnings.push(`「${info.task.title}」は今日あと${info.mandatoryToday - got}分やらないと間に合いませんが、今日の空き時間に入りきりませんでした。`);
  }

  const total = items.reduce((sum, i) => sum + duration(i), 0);
  const summary =
    items.length === 0
      ? ctx.tasks.length === 0
        ? '締切のあるタスクがありません。'
        : 'この日に入れられる作業はありません(空き時間がないか、ほかの日で間に合います)。'
      : `${items.length}コマ・合計${Math.floor(total / 60)}時間${total % 60}分の作業を、締切の近い順に空き時間へ割り当てました。`;

  return { items, summary, warnings };
}

function duration(item: PlanItem): number {
  const [sh, sm] = item.start.split(':').map(Number);
  const [eh, em] = item.end.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function layout(
  slots: Slot[],
  ordered: TaskPlanningInfo[],
  minutesFor: Map<string, number>,
  maxBlock: number,
  breakMinutes: number,
): PlanItem[] {
  const items: PlanItem[] = [];
  const free = slots.map((s) => ({ ...s }));
  let slotIdx = 0;

  for (const info of ordered) {
    let left = minutesFor.get(info.task.id) ?? 0;
    while (left > 0 && slotIdx < free.length) {
      const slot = free[slotIdx];
      const room = slot.end - slot.start;
      if (room < Math.min(MIN_CHUNK, left)) {
        slotIdx++;
        continue;
      }
      const chunk = Math.min(left, maxBlock, room);
      items.push({
        id: crypto.randomUUID(),
        task_id: info.task.id,
        title: info.task.title,
        start: toHHmm(slot.start),
        end: toHHmm(slot.start + chunk),
        reason: reasonFor(info),
        done: false,
      });
      left -= chunk;
      slot.start += chunk + breakMinutes;
    }
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

function reasonFor(info: TaskPlanningInfo): string {
  if (info.overdue) return '締切を過ぎているため最優先';
  if (info.daysUntilDeadline === 0) return '今日が締切';
  if (info.mandatoryToday > 0) return `締切まで${info.daysUntilDeadline}日。今日進めないと間に合わない`;
  return `締切まで${info.daysUntilDeadline}日。毎日少しずつ進めるペース配分`;
}
