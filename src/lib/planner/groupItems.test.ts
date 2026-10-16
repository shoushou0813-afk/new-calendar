import { describe, expect, it } from 'vitest';
import { groupByTask, groupTimeLabel, mergeRuns } from './groupItems';
import type { PlanItem } from '../../types/task';

const item = (task_id: string, start: string, end: string): PlanItem => ({
  id: `${task_id}-${start}`,
  task_id,
  title: task_id,
  start,
  end,
  reason: '',
  done: false,
});

describe('groupItems', () => {
  const items = [item('a', '09:00', '09:50'), item('a', '10:00', '10:50'), item('b', '11:00', '11:50'), item('a', '15:00', '15:50')];

  it('休憩をはさんで続く同じタスクを1行にまとめる', () => {
    const runs = mergeRuns(items, 10);
    expect(runs.map((r) => [r.task_id, r.start, r.end, r.minutes])).toEqual([
      ['a', '09:00', '10:50', 100],
      ['b', '11:00', '11:50', 50],
      ['a', '15:00', '15:50', 50],
    ]);
  });

  it('1週間の一覧ではタスクごとに1つにまとめる', () => {
    const groups = groupByTask(items);
    expect(groups.map((g) => [g.task_id, g.minutes, g.items.length])).toEqual([
      ['a', 150, 3],
      ['b', 50, 1],
    ]);
    expect(groupTimeLabel(groups[0], 10)).toBe('09:00〜 ほか1回');
    expect(groupTimeLabel(groups[1], 10)).toBe('11:00〜11:50');
  });
});
