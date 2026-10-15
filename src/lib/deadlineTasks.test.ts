import { describe, expect, it } from 'vitest';
import type { EventRow } from '../types/event';
import type { Task } from '../types/task';
import { deadlineCandidates, estimateMinutes, isDeadlineEvent, taskTitleFromEvent } from './deadlineTasks';

function ev(title: string, date: string, starts_at = '00:00', ends_at: string | null = null, extra: Partial<EventRow> = {}): EventRow {
  return {
    id: crypto.randomUUID(), title, category: 'その他', date, doors_at: null, starts_at, ends_at, source_url: null, image: null,
    note: 'メモ', has_alarm: false, time_confirmed: false, warnings: [], memory_checked_at: null, miss_count: 0,
    created_at: '', updated_at: '', ...extra,
  };
}

describe('deadlineTasks', () => {
  it('締切の予定を見分ける', () => {
    expect(isDeadlineEvent({ title: '【締切】SCSK（IT）' })).toBe(true);
    expect(isDeadlineEvent({ title: '【締切 12:00】NTT東日本' })).toBe(true);
    expect(isDeadlineEvent({ title: '【予備締切】ドコモ' })).toBe(true);
    expect(isDeadlineEvent({ title: '【期限21:59】課題' })).toBe(true);
    expect(isDeadlineEvent({ title: 'ピアノレッスン' })).toBe(false);
    expect(isDeadlineEvent({ title: '【オンライン】金2 第8回' })).toBe(false);
  });

  it('タスク名と作業時間の目安', () => {
    expect(taskTitleFromEvent('【締切】キリン（デジタルICTほか）')).toBe('キリン（デジタルICTほか）');
    expect(taskTitleFromEvent('【予備締切】ドコモ ES提出')).toBe('ドコモ ES提出(予備)');
    expect(estimateMinutes('日鉄エンジニアリング（ES・SPI）')).toBe(180);
    expect(estimateMinutes('アビーム（ES）')).toBe(120);
    expect(estimateMinutes('適性検査A・B受検')).toBe(90);
    expect(estimateMinutes('SCSK（IT）')).toBe(60);
  });

  it('候補: 過去・作業ブロックは除外、時刻つきは終了時刻を締切に、予備と登録済みはチェックなし', () => {
    const existing: Task[] = [{
      id: 't', title: 'SCSK（IT）', deadline: '2026-10-26', deadline_time: null, estimated_minutes: 60, spent_minutes: 0,
      priority: 'normal', note: null, done: false, created_at: '', updated_at: '',
    }];
    const result = deadlineCandidates(
      [
        ev('【締切】過去の会社', '2026-10-10'),
        ev('【締切 12:00】NTT東日本（ES・適性）', '2026-10-16', '11:00', '12:00'),
        ev('【締切】SCSK（IT）', '2026-10-26'),
        ev('【予備締切】ドコモ ES提出', '2026-11-20', '12:00', '13:00'),
        ev('【作業】【締切】X', '2026-10-20', '09:00', '10:00', { task_id: 't' }),
        ev('ピアノレッスン', '2026-10-16', '19:00', '19:30'),
      ],
      existing,
      '2026-10-16',
    );
    expect(result.map((c) => c.draft.title)).toEqual(['NTT東日本（ES・適性）', 'SCSK（IT）', 'ドコモ ES提出(予備)']);
    expect(result[0].draft).toMatchObject({ deadline: '2026-10-16', deadline_time: '12:00', priority: 'high', estimated_minutes: 180 });
    expect(result[0].defaultChecked).toBe(true);
    expect(result[1]).toMatchObject({ alreadyAdded: true, defaultChecked: false });
    expect(result[1].draft.deadline_time).toBeNull();
    expect(result[2]).toMatchObject({ defaultChecked: false });
    expect(result[2].draft.priority).toBe('low');
  });
});
