import { describe, expect, it } from 'vitest';
import { parseImportPayload } from './importPayload';

describe('parseImportPayload', () => {
  it('.ics テキストはそのまま予定として扱う', () => {
    expect(parseImportPayload('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual({
      ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
      tasks: [],
      removeEvents: [],
      removeTasks: [],
    });
  });

  it('JSON なら予定とタスクを取り出し、不正なタスクは捨てる', () => {
    const p = parseImportPayload(
      JSON.stringify({
        ics: 'BEGIN:VCALENDAR',
        tasks: [
          { title: 'ライブ練習', deadline: '2026-10-31', estimated_minutes: 1800, priority: 'high', note: '4曲' },
          { title: '', deadline: '2026-10-31', estimated_minutes: 60 },
          { title: '締切なし', estimated_minutes: 60 },
          { title: '時間0', deadline: '2026-10-31', estimated_minutes: 0 },
        ],
      }),
    );
    expect(p.ics).toBe('BEGIN:VCALENDAR');
    expect(p.tasks).toEqual([
      { title: 'ライブ練習', deadline: '2026-10-31', deadline_time: null, estimated_minutes: 1800, spent_minutes: 0, priority: 'high', note: '4曲', done: false },
    ]);
  });

  it('削除の指定を読み取り、形式の合わないものは捨てる', () => {
    const p = parseImportPayload(
      JSON.stringify({
        removeEvents: [{ date: '2026-10-30', starts_at: '19:00', title: 'ピアノレッスン' }, { date: 'x', starts_at: '19:00', title: 'a' }],
        removeTasks: [{ title: 'ピアノの練習(10/30のレッスンまで)', deadline: '2026-10-30' }, { title: '', deadline: '2026-10-30' }],
      }),
    );
    expect(p.removeEvents).toEqual([{ date: '2026-10-30', starts_at: '19:00', title: 'ピアノレッスン' }]);
    expect(p.removeTasks).toEqual([{ title: 'ピアノの練習(10/30のレッスンまで)', deadline: '2026-10-30' }]);
  });

  it('壊れた JSON はエラー', () => {
    expect(() => parseImportPayload('{oops')).toThrow();
  });
});
