import { describe, expect, it } from 'vitest';
import type { DayPlan, Task } from '../../types/task';
import { DEFAULT_SETTINGS } from '../settings';
import { forecastDays } from './forecast';

const settings = { ...DEFAULT_SETTINGS, workStart: '09:00', workEnd: '12:00', maxBlockMinutes: 50, breakMinutes: 10 };

function task(id: string, deadline: string, estimated: number, extra: Partial<Task> = {}): Task {
  return {
    id, title: id, deadline, deadline_time: null, estimated_minutes: estimated, spent_minutes: 0, priority: 'normal',
    note: null, done: false, created_at: '', updated_at: '', ...extra,
  };
}

const now = new Date(2026, 9, 20, 7, 0);

describe('forecastDays', () => {
  it('前の日に進んだ分を引きながら、毎日のやることを出す', () => {
    // 3日後締切・300分 → 1日あたり100分ずつ
    const days = forecastDays({
      startDate: '2026-10-20', days: 4, now, tasks: [task('a', '2026-10-22', 300)], events: [], settings, savedPlans: new Map(),
    });
    const total = (i: number) => days[i].items.reduce((s, it) => s + (Number(it.end.slice(0, 2)) * 60 + Number(it.end.slice(3)) - (Number(it.start.slice(0, 2)) * 60 + Number(it.start.slice(3)))), 0);
    expect(days.map((d) => d.source)).toEqual(['forecast', 'forecast', 'forecast', 'forecast']);
    expect(total(0) + total(1) + total(2)).toBe(300);
    expect(total(3)).toBe(0);
    expect(days[2].deadlines.map((t) => t.id)).toEqual(['a']);
  });

  it('保存済みの計画がある日はそれを使い、チェック済み・完了タスクの項目は一覧から外す', () => {
    const saved: DayPlan = {
      date: '2026-10-20', summary: '', warnings: [], generated_by: 'ai', created_at: '',
      items: [
        { id: '1', task_id: 'a', title: 'a', start: '09:00', end: '09:50', reason: '', done: true },
        { id: '2', task_id: 'a', title: 'a', start: '10:00', end: '10:50', reason: '', done: false },
        { id: '3', task_id: 'b', title: 'b', start: '11:00', end: '11:30', reason: '', done: false },
      ],
    };
    const days = forecastDays({
      startDate: '2026-10-20', days: 1, now,
      tasks: [task('a', '2026-10-25', 200, { spent_minutes: 50 }), task('b', '2026-10-25', 30, { done: true })],
      events: [], settings, savedPlans: new Map([['2026-10-20', saved]]),
    });
    expect(days[0].source).toBe('saved');
    expect(days[0].items.map((i) => i.id)).toEqual(['2']);
    expect(days[0].doneItems.map((i) => i.id)).toEqual(['1']);
  });

  it('見込みの項目IDは計算し直しても変わらない', () => {
    const args = { startDate: '2026-10-20', days: 2, now, tasks: [task('a', '2026-10-22', 120)], events: [], settings, savedPlans: new Map() };
    expect(forecastDays(args)[0].items.map((i) => i.id)).toEqual(forecastDays(args)[0].items.map((i) => i.id));
  });
});
