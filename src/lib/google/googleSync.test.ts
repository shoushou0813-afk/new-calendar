import { describe, expect, it } from 'vitest';
import type { EventRow } from '../../types/event';
import { computeSyncPlan, googleToFields, localToGoogle } from './googleSync';

function row(extra: Partial<EventRow>): EventRow {
  return {
    id: crypto.randomUUID(),
    title: '予定',
    category: 'その他',
    date: '2026-10-20',
    doors_at: null,
    starts_at: '10:00',
    ends_at: '11:00',
    source_url: null,
    image: null,
    note: null,
    has_alarm: false,
    time_confirmed: false,
    warnings: [],
    memory_checked_at: null,
    miss_count: 0,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

const window = { from: '2026-09-15', to: '2027-04-01' };

describe('googleToFields / localToGoogle', () => {
  it('終日予定は 00:00 開始・終了なし', () => {
    expect(googleToFields({ id: 'x', summary: '旅行', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })).toMatchObject({
      date: '2026-10-20',
      starts_at: '00:00',
      ends_at: null,
    });
  });

  it('日をまたぐ予定と、複数日の終日予定', () => {
    expect(
      googleToFields({ id: 'x', start: { dateTime: '2026-11-08T17:00:00+09:00' }, end: { dateTime: '2026-11-09T00:04:00+09:00' } }),
    ).toMatchObject({ date: '2026-11-08', starts_at: '17:00', ends_at: '00:04', end_date: '2026-11-09' });
    expect(
      googleToFields({ id: 'x', start: { dateTime: '2026-11-08T17:00:00+09:00' }, end: { dateTime: '2026-11-09T00:00:00+09:00' } }),
    ).toMatchObject({ ends_at: '23:59', end_date: null });
    expect(googleToFields({ id: 'x', start: { date: '2026-10-24' }, end: { date: '2026-10-26' } })).toMatchObject({
      date: '2026-10-24',
      end_date: '2026-10-25',
    });
    expect(localToGoogle(row({ date: '2026-11-08', starts_at: '17:00', ends_at: '00:04', end_date: '2026-11-09' }), 'Asia/Tokyo')).toMatchObject({
      start: { dateTime: '2026-11-08T17:00:00' },
      end: { dateTime: '2026-11-09T00:04:00' },
    });
    expect(localToGoogle(row({ date: '2026-10-24', starts_at: '00:00', ends_at: null, end_date: '2026-10-25' }), 'Asia/Tokyo')).toMatchObject({
      start: { date: '2026-10-24' },
      end: { date: '2026-10-26' },
    });
  });

  it('終了時刻なしのローカル予定は1時間の予定として送る', () => {
    const g = localToGoogle(row({ starts_at: '23:30', ends_at: null }), 'Asia/Tokyo');
    expect(g.start).toEqual({ dateTime: '2026-10-20T23:30:00', timeZone: 'Asia/Tokyo' });
    expect(g.end).toEqual({ dateTime: '2026-10-21T00:30:00', timeZone: 'Asia/Tokyo' });
  });
});

describe('computeSyncPlan', () => {
  it('Googleにだけある予定は取り込み、ローカルにだけある予定は送る', () => {
    const localOnly = row({});
    const plan = computeSyncPlan({
      local: [localOnly],
      remote: [{ id: 'g1', summary: 'G', start: { dateTime: '2026-10-21T09:00:00+09:00' }, updated: '2026-10-02T00:00:00.000Z' }],
      tombstones: [],
      ...window,
    });
    expect(plan.createLocal.map((g) => g.id)).toEqual(['g1']);
    expect(plan.pushCreate).toEqual([localOnly]);
  });

  it('同期期間外のローカル予定は送らない', () => {
    const plan = computeSyncPlan({ local: [row({ date: '2025-01-01' })], remote: [], tombstones: [], ...window });
    expect(plan.pushCreate).toEqual([]);
  });

  it('片方だけで編集されていれば、そちらを採用する', () => {
    const synced = '2026-10-05T00:00:00.000Z';
    const editedLocally = row({ google_event_id: 'g1', google_synced_at: synced, updated_at: '2026-10-06T00:00:00.000Z' });
    const editedRemotely = row({ google_event_id: 'g2', google_synced_at: synced, updated_at: synced });
    const untouched = row({ google_event_id: 'g3', google_synced_at: synced, updated_at: synced });
    const plan = computeSyncPlan({
      local: [editedLocally, editedRemotely, untouched],
      remote: [
        { id: 'g1', updated: '2026-10-04T00:00:00.000Z', start: { dateTime: '2026-10-20T10:00:00+09:00' } },
        { id: 'g2', updated: '2026-10-07T00:00:00.000Z', start: { dateTime: '2026-10-20T12:00:00+09:00' } },
        { id: 'g3', updated: '2026-10-04T00:00:00.000Z', start: { dateTime: '2026-10-20T10:00:00+09:00' } },
      ],
      tombstones: [],
      ...window,
    });
    expect(plan.pushUpdate).toEqual([editedLocally]);
    expect(plan.updateLocal.map((u) => u.local)).toEqual([editedRemotely]);
  });

  it('両方で編集されていたら新しいほうを採用する', () => {
    const synced = '2026-10-05T00:00:00.000Z';
    const local = row({ google_event_id: 'g1', google_synced_at: synced, updated_at: '2026-10-06T00:00:00.000Z' });
    const plan = computeSyncPlan({
      local: [local],
      remote: [{ id: 'g1', updated: '2026-10-08T00:00:00.000Z', start: { dateTime: '2026-10-20T10:00:00+09:00' } }],
      tombstones: [],
      ...window,
    });
    expect(plan.pushUpdate).toEqual([]);
    expect(plan.updateLocal).toHaveLength(1);
  });

  it('削除はどちら側からも伝わる', () => {
    const synced = row({ google_event_id: 'g1', google_synced_at: '2026-10-05T00:00:00.000Z' });
    const plan = computeSyncPlan({
      local: [synced],
      remote: [
        { id: 'g1', status: 'cancelled' },
        { id: 'g2', status: 'confirmed', start: { dateTime: '2026-10-20T10:00:00+09:00' } },
        { id: 'g3', status: 'cancelled' },
      ],
      tombstones: ['g2', 'g3'],
      ...window,
    });
    expect(plan.deleteLocal).toEqual([synced]);
    expect(plan.pushDelete).toEqual(['g2']);
    expect(plan.clearTombstones).toEqual(['g3']);
    expect(plan.createLocal).toEqual([]);
  });
});
