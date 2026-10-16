import { describe, expect, it } from 'vitest';
import { buildDayFlow } from './dayFlow';
import type { EventRow } from '../../types/event';
import type { PlanItem } from '../../types/task';

const ev = (id: string, title: string, starts_at: string, ends_at: string | null): EventRow =>
  ({ id, title, date: '2026-10-19', starts_at, ends_at, end_date: null, task_id: null } as unknown as EventRow);
const item = (task_id: string, start: string, end: string): PlanItem => ({ id: `${task_id}${start}`, task_id, title: task_id, start, end, reason: '', done: false });

describe('buildDayFlow', () => {
  it('予定を目印に、空き時間ごとにやることをまとめる', () => {
    const flow = buildDayFlow(
      '2026-10-19',
      [item('ES', '09:00', '09:50'), item('ES', '10:00', '10:30'), item('練習', '14:40', '15:30'), item('練習', '21:00', '21:50')],
      [ev('a', '授業(3限)', '13:00', '14:30'), ev('b', 'スタジオ練習', '18:00', '20:30'), ev('c', '【締切】ES', '00:00', null)],
    );
    expect(flow.map((b) => (b.kind === 'gap' ? `${b.label}: ${b.groups.map((g) => `${g.title}${g.minutes}`).join(',')}` : `[${b.start} ${b.title}]`))).toEqual([
      '授業の前に: ES80',
      '[13:00 授業(3限)]',
      '授業のあと〜スタジオ練習の前: 練習50',
      '[18:00 スタジオ練習]',
      'スタジオ練習のあと: 練習50',
    ]);
  });

  it('予定がない日は1つにまとめる', () => {
    const flow = buildDayFlow('2026-10-19', [item('ES', '09:00', '09:50')], []);
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ kind: 'gap', label: '今日やること', minutes: 50 });
  });
});
