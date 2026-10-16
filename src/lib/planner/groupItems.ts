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

/**
 * 時刻順に並べて、同じタスクが休憩(maxGap 分以内)をはさんで続いている所を1つにまとめる。
 * 1日の流れ(時刻順の表示)用。
 */
export function mergeRuns(items: PlanItem[], maxGap: number): ItemGroup[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const groups: PlanItem[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.task_id === item.task_id && toMinutes(item.start) - toMinutes(prev.end) <= maxGap) last.push(item);
    else groups.push([item]);
  }
  return groups.map(makeGroup);
}

/** 同じタスクの作業を、時刻に関係なく1つにまとめる(1週間・1ヶ月の一覧用) */
export function groupByTask(items: PlanItem[]): ItemGroup[] {
  const map = new Map<string, PlanItem[]>();
  for (const item of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    map.set(item.task_id, [...(map.get(item.task_id) ?? []), item]);
  }
  return [...map.values()].map(makeGroup);
}

/** 「9:00〜12:50」または、間があいているなら「9:00〜 ほか2回」 */
export function groupTimeLabel(group: ItemGroup, maxGap: number): string {
  const runs = mergeRuns(group.items, maxGap);
  if (runs.length === 1) return `${group.start}〜${group.end}`;
  return `${group.start}〜 ほか${runs.length - 1}回`;
}

