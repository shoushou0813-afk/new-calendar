import { describe, expect, it } from 'vitest';
import type { EventRow } from '../../types/event';
import type { Task } from '../../types/task';
import { DEFAULT_SETTINGS, type AppSettings } from '../settings';
import { sanitize } from './aiPlanner';
import { freeSlots, toMinutes } from './freeSlots';
import { planLocally } from './localPlanner';
import { buildPlanningContext } from './planningContext';

const settings: AppSettings = { ...DEFAULT_SETTINGS, workStart: '09:00', workEnd: '18:00', maxBlockMinutes: 50, breakMinutes: 10 };

function ev(date: string, starts_at: string, ends_at: string | null, extra: Partial<EventRow> = {}): EventRow {
  return {
    id: crypto.randomUUID(),
    title: '予定',
    category: 'その他',
    date,
    doors_at: null,
    starts_at,
    ends_at,
    source_url: null,
    image: null,
    note: null,
    has_alarm: false,
    time_confirmed: false,
    warnings: [],
    memory_checked_at: null,
    miss_count: 0,
    created_at: '',
    updated_at: '',
    ...extra,
  };
}

function task(id: string, deadline: string, estimated: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    deadline,
    deadline_time: null,
    estimated_minutes: estimated,
    spent_minutes: 0,
    priority: 'normal',
    note: null,
    done: false,
    created_at: '',
    updated_at: '',
    ...extra,
  };
}

// 2026-10-20 07:00(作業開始前)を「今」とする
const morning = new Date(2026, 9, 20, 7, 0);

describe('freeSlots', () => {
  it('作業時間帯から予定を引く', () => {
    const slots = freeSlots([ev('2026-10-20', '10:00', '12:00'), ev('2026-10-20', '11:30', '13:00')], '09:00', '18:00');
    expect(slots).toEqual([
      { start: toMinutes('09:00'), end: toMinutes('10:00') },
      { start: toMinutes('13:00'), end: toMinutes('18:00') },
    ]);
  });

  it('終了時刻なしの予定は1時間ぶん埋める / 過ぎた時間は使わない', () => {
    const slots = freeSlots([ev('2026-10-20', '15:00', null)], '09:00', '18:00', toMinutes('14:02'));
    expect(slots).toEqual([
      { start: toMinutes('14:05'), end: toMinutes('15:00') },
      { start: toMinutes('16:00'), end: toMinutes('18:00') },
    ]);
  });

  it('15分未満の細切れは捨てる', () => {
    expect(freeSlots([ev('2026-10-20', '09:10', '18:00')], '09:00', '18:00')).toEqual([]);
  });
});

describe('buildPlanningContext', () => {
  it('締切に余裕があれば今日の必須分は0、ペースは均等割り', () => {
    const ctx = buildPlanningContext({ date: '2026-10-20', now: morning, tasks: [task('a', '2026-10-24', 300)], events: [], settings });
    const info = ctx.tasks[0];
    expect(info.mandatoryToday).toBe(0);
    expect(info.paceToday).toBe(60); // 5日で300分
    expect(info.shortage).toBe(0);
  });

  it('明日が予定で埋まっていれば、その分を今日やる必要がある', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [task('a', '2026-10-21', 600)],
      events: [ev('2026-10-21', '09:00', '18:00')],
      settings,
    });
    expect(ctx.tasks[0].mandatoryToday).toBe(450); // 9時間 × 50/60
    expect(ctx.tasks[0].shortage).toBe(150);
  });

  it('複数タスクが空き時間を取り合う場合も考慮する', () => {
    // 明日締切のb(450分)が明日を全部使うので、明後日締切のaも今日やらないといけない
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [task('a', '2026-10-22', 900), task('b', '2026-10-21', 450)],
      events: [],
      settings,
    });
    const a = ctx.tasks.find((t) => t.task.id === 'a')!;
    const b = ctx.tasks.find((t) => t.task.id === 'b')!;
    expect(a.mandatoryToday + b.mandatoryToday).toBeGreaterThan(0);
    expect(a.shortage + b.shortage).toBe(0);
  });

  it('【締切】の予定は空き時間を埋めない(締切の目印なので)', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [],
      events: [ev('2026-10-20', '11:00', '12:00', { title: '【締切 12:00】ES提出' })],
      settings,
    });
    expect(ctx.slots).toEqual([{ start: toMinutes('09:00'), end: toMinutes('18:00') }]);
  });

  it('AIが入れた作業ブロック(task_id付き)は空き時間の計算に含めない', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [],
      events: [ev('2026-10-20', '09:00', '12:00', { task_id: 'a' })],
      settings,
    });
    expect(ctx.slots).toEqual([{ start: toMinutes('09:00'), end: toMinutes('18:00') }]);
  });
});

describe('planLocally', () => {
  it('締切の近い順に、休憩を挟んで空き時間へ並べる', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [task('later', '2026-10-30', 110), task('today', '2026-10-20', 100)],
      events: [ev('2026-10-20', '12:00', '13:00')],
      settings,
    });
    const result = planLocally(ctx);
    expect(result.items[0]).toMatchObject({ task_id: 'today', start: '09:00', end: '09:50' });
    expect(result.items[1]).toMatchObject({ task_id: 'today', start: '10:00', end: '10:50' });
    for (const item of result.items) {
      const overlapsLunch = toMinutes(item.start) < toMinutes('13:00') && toMinutes(item.end) > toMinutes('12:00');
      expect(overlapsLunch).toBe(false);
    }
    expect(result.warnings).toEqual([]);
  });

  it('今日の締切時刻がある作業は、その時刻までに終わる枠にだけ入れる', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [task('es', '2026-10-20', 180, { deadline_time: '12:00' }), task('other', '2026-10-20', 60)],
      events: [],
      settings,
    });
    const result = planLocally(ctx);
    const es = result.items.filter((i) => i.task_id === 'es');
    expect(es.length).toBeGreaterThan(0);
    for (const item of es) expect(toMinutes(item.end)).toBeLessThanOrEqual(toMinutes('12:00'));
    // 締切時刻のあるほうを先に置く
    expect(result.items[0].task_id).toBe('es');
    // 12時までに180分は入りきらないので警告が出る
    expect(result.warnings.some((w) => w.includes('es'))).toBe(true);
    // 12時以降の枠は他のタスクに使える
    expect(result.items.some((i) => i.task_id === 'other' && toMinutes(i.start) >= toMinutes('12:00'))).toBe(true);
  });

  it('今日の締切時刻を過ぎたタスクは「締切を過ぎた」扱いになる', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: new Date(2026, 9, 20, 13, 0),
      tasks: [task('es', '2026-10-20', 60, { deadline_time: '12:00' })],
      events: [],
      settings,
    });
    expect(ctx.tasks[0].overdue).toBe(true);
  });

  it('間に合わないタスクは警告する', () => {
    const ctx = buildPlanningContext({ date: '2026-10-20', now: morning, tasks: [task('big', '2026-10-20', 1000)], events: [], settings });
    const result = planLocally(ctx);
    expect(result.warnings.some((w) => w.includes('間に合いません'))).toBe(true);
  });
});

describe('sanitize (AI出力の検証)', () => {
  it('空き時間外・重なり・存在しないタスクを除外する', () => {
    const ctx = buildPlanningContext({
      date: '2026-10-20',
      now: morning,
      tasks: [task('a', '2026-10-22', 120)],
      events: [ev('2026-10-20', '12:00', '13:00')],
      settings,
    });
    const result = sanitize(
      {
        summary: 's',
        warnings: [],
        items: [
          { task_id: 'a', start: '09:00', end: '09:50', reason: 'ok' },
          { task_id: 'a', start: '09:30', end: '10:00', reason: '重なり' },
          { task_id: 'a', start: '11:30', end: '12:30', reason: '予定と重なる' },
          { task_id: 'zzz', start: '14:00', end: '14:30', reason: '存在しない' },
          { task_id: 'a', start: '25:00', end: '26:00', reason: '不正な時刻' },
        ],
      },
      ctx,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ task_id: 'a', title: 'a', start: '09:00' });
    expect(result.warnings[0]).toContain('4件');
  });
});
