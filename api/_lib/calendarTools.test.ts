import { describe, expect, it } from 'vitest';
import { applyOps, emptyDoc } from './cloudDoc';
import { addEvent, addTask, deleteEvent, deleteTask, listEvents, listTasks, todayInTokyo, updateEvent, updateTask } from './calendarTools';

const now = new Date('2026-10-16T01:00:00Z'); // 日本時間 10:00

describe('calendarTools', () => {
  it('日本時間の今日', () => {
    expect(todayInTokyo(new Date('2026-10-15T16:30:00Z'))).toBe('2026-10-16');
  });

  it('予定の追加・一覧・更新・削除', () => {
    let doc = emptyDoc();
    const added = addEvent(doc, { title: 'スタジオ', date: '2026-10-21', start: '16:50', end: '22:10' }, now, 'e1');
    doc = applyOps(doc, added.ops);
    const allDay = addEvent(doc, { title: 'ライブ出演', date: '2026-11-01' }, now, 'e2');
    doc = applyOps(doc, allDay.ops);
    expect(doc.events.e2).toMatchObject({ starts_at: '00:00', ends_at: null, category: 'その他', time_confirmed: true });

    const listed = listEvents(doc, {}, now).result as { events: { id: string; start: string }[] };
    expect(listed.events.map((e) => [e.id, e.start])).toEqual([['e1', '16:50']]); // 2週間先まで
    const wide = listEvents(doc, { from: '2026-10-01', to: '2026-11-30', query: 'ライブ' }).result as { events: { id: string; start: string }[] };
    expect(wide.events.map((e) => [e.id, e.start])).toEqual([['e2', '終日']]);

    doc = applyOps(doc, updateEvent(doc, { id: 'e1', end: '21:00', note: 'メモ' }, now).ops);
    expect(doc.events.e1).toMatchObject({ ends_at: '21:00', note: 'メモ', updated_at: now.toISOString() });

    doc = applyOps(doc, deleteEvent(doc, { id: 'e1' }).ops);
    expect(doc.events.e1).toBeUndefined();
  });

  it('おかしな入力は変更せずにエラーを返す', () => {
    const doc = emptyDoc();
    for (const r of [
      addEvent(doc, { title: 'x', date: '10/21' }),
      addEvent(doc, { title: 'x', date: '2026-10-21', start: '25:00' }),
      addEvent(doc, { title: 'x', date: '2026-10-21', start: '18:00', end: '17:00' }),
      updateEvent(doc, { id: 'none', title: 'y' }),
      deleteTask(doc, { id: 'none' }),
      addTask(doc, { title: 'x', deadline: '2026-10-31', estimated_minutes: 0 }),
    ]) {
      expect(r.ops).toEqual([]);
      expect((r.result as { ok: boolean }).ok).toBe(false);
    }
  });

  it('Googleと同期済みの予定を消すと、Googleからも消す記録を残す', () => {
    const doc = emptyDoc();
    doc.events.g = { id: 'g', title: 'G', date: '2026-10-20', starts_at: '10:00', image: null, google_event_id: 'gid' };
    expect(deleteEvent(doc, { id: 'g' }).ops).toEqual([
      { op: 'delete', collection: 'events', key: 'g' },
      { op: 'put', collection: 'tombstones', key: 'gid' },
    ]);
  });

  it('タスクの追加・進捗・完了・一覧', () => {
    let doc = emptyDoc();
    doc = applyOps(doc, addTask(doc, { title: '個人練習', deadline: '2026-10-31', estimated_minutes: 1800, priority: 'high' }, now, 't1').ops);
    doc = applyOps(doc, updateTask(doc, { id: 't1', spent_minutes: 9999 }, now).ops);
    expect(doc.tasks.t1.spent_minutes).toBe(1800); // 見積もりを超えない
    doc = applyOps(doc, updateTask(doc, { id: 't1', done: true }, now).ops);
    expect((listTasks(doc, {}).result as { count: number }).count).toBe(0);
    expect((listTasks(doc, { include_done: true }).result as { count: number }).count).toBe(1);
  });
});
