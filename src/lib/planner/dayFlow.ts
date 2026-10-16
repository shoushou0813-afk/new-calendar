import type { EventRow } from '../../types/event';
import type { PlanItem } from '../../types/task';
import { isDeadlineEvent } from '../deadlineTasks';
import { eventOccursOn, eventSliceOn } from '../eventSpan';
import { toMinutes } from './freeSlots';
import { groupByTask, type ItemGroup } from './groupItems';

/**
 * 大まかな1日の流れ。決まっている予定(授業・バイトなど)を目印にして、
 * その間の空き時間を「授業の前に」「授業のあと〜スタジオ練習の前」のようにまとめ、そこでやることを並べる。
 */
export type FlowBlock =
  | { kind: 'event'; key: string; title: string; start: string; end: string | null }
  | { kind: 'gap'; key: string; label: string; minutes: number; groups: ItemGroup[] };

function shortTitle(title: string): string {
  return title.replace(/^\s*【[^】]*】\s*/, '').replace(/\s*[(（].*?[)）]\s*$/, '').trim() || title;
}

export function buildDayFlow(date: string, items: PlanItem[], events: EventRow[]): FlowBlock[] {
  const anchors = events
    .filter((e) => eventOccursOn(e, date) && !e.task_id && !isDeadlineEvent(e))
    .map((e) => ({ e, slice: eventSliceOn(e, date) }))
    // 終日の予定は流れの目印にしない(見出しに出す)
    .filter(({ e, slice }) => !(e.starts_at === '00:00' && !e.ends_at && !slice.continued))
    .map(({ e, slice }) => {
      const start = slice.continued ? '00:00' : slice.starts_at;
      const end = slice.ends_at && slice.ends_at !== '24:00' ? slice.ends_at : slice.continues ? '24:00' : null;
      return { key: e.id, title: e.title, start, end, startMin: toMinutes(start), endMin: end ? toMinutes(end) : toMinutes(start) + 60 };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const blocks: FlowBlock[] = [];
  const addGap = (key: string, label: string, from: number, to: number) => {
    const inGap = items.filter((i) => toMinutes(i.start) >= from && toMinutes(i.start) < to);
    if (inGap.length === 0) return;
    const groups = groupByTask(inGap);
    blocks.push({ kind: 'gap', key, label, minutes: groups.reduce((s, g) => s + g.minutes, 0), groups });
  };

  if (anchors.length === 0) {
    addGap('all', '今日やること', 0, 24 * 60 + 1);
    return blocks;
  }
  let prevEnd = 0;
  let prev: (typeof anchors)[number] | null = null;
  for (const a of anchors) {
    const label = prev ? `${shortTitle(prev.title)}のあと〜${shortTitle(a.title)}の前` : `${shortTitle(a.title)}の前に`;
    addGap(`before-${a.key}`, label, prevEnd, a.startMin);
    blocks.push({ kind: 'event', key: a.key, title: a.title, start: a.start, end: a.end });
    prevEnd = Math.max(prevEnd, a.endMin);
    prev = a;
  }
  addGap('after', `${shortTitle(prev!.title)}のあと`, prevEnd, 24 * 60 + 1);
  return blocks;
}
