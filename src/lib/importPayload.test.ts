import { describe, expect, it } from 'vitest';
import { parseImportPayload } from './importPayload';

describe('parseImportPayload', () => {
  it('.ics テキストはそのまま予定として扱う', () => {
    expect(parseImportPayload('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual({ ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', tasks: [] });
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

  it('壊れた JSON はエラー', () => {
    expect(() => parseImportPayload('{oops')).toThrow();
  });
});
