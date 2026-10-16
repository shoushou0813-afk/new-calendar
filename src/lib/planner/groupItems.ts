import type { PlanItem } from '../../types/task';
import { toMinutes } from './freeSlots';

/** 同じタスクの作業をまとめた1行 */
export interface ItemGroup {
  key: string;
  task_id: string;
  title: string;
  /** 最初に始める時刻 / 最後に終わる時刻 */
  start: string;
  end: string;
  /** 実際の作業時間の合計(休憩を除く、分) */
  minutes: number;
  items: PlanItem[];
}

function minutesOf(item: PlanItem): number {
  return toMinutes(item.end) - toMinutes(item.start);
}

function makeGroup(items: PlanItem[]): ItemGroup {
  return {
    key: items.map((i) => i.id).join('|'),
    task_id: items[0].task_id,
    title: items[0].title,
    start: items[0].start,
    end: items[items.length - 1].end,
    minutes: items.reduce((s, i) => s + minutesOf(i), 0),
    items,
  };
}

/** 同じタスクの作業を、時刻に関係なく1つにまとめる(1週間・1ヶ月の一覧用) */
export function groupByTask(items: PlanItem[]): ItemGroup[] {
  const map = new Map<string, PlanItem[]>();
  for (const item of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    map.set(item.task_id, [...(map.get(item.task_id) ?? []), item]);
  }
  return [...map.values()].map(makeGroup);
}
