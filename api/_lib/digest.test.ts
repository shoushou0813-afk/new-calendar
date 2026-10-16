import { describe, expect, it } from 'vitest';
import { applyOps, emptyDoc, type CloudOp } from './cloudDoc';
import { dailyDigest, digestsFor, weeklyDigest } from './digest';

const ev = (id: string, title: string, date: string, starts_at: string, ends_at: string | null, extra = {}): CloudOp => ({
  op: 'put',
  collection: 'events',
  record: { id, title, date, starts_at, ends_at, image: null, ...extra },
});

const doc = applyOps(emptyDoc(), [
  ev('1', '授業', '2026-10-19', '13:00', '14:30'),
  ev('2', 'スタジオ練習', '2026-10-19', '18:00', '21:00'),
  ev('3', '祝日', '2026-10-21', '00:00', null),
  ev('4', '【作業】ES', '2026-10-19', '10:00', '11:00', { task_id: 't' }),
  ev('5', '夜勤', '2026-10-18', '22:00', '05:00', { end_date: '2026-10-19' }),
  { op: 'put', collection: 'tasks', record: { id: 't', title: '日鉄 ES', deadline: '2026-10-19', deadline_time: null, done: false } },
]);

describe('digest', () => {
  it('明日の予定を時刻順に並べ、作業ブロックは出さない', () => {
    const d = dailyDigest(doc, '2026-10-19');
    expect(d.title).toBe('明日 10/19(月) の予定 4件');
    expect(d.body).toBe('前日から 夜勤\n13:00 授業\n18:00 スタジオ練習\n締切: 日鉄 ES');
  });

  it('来週のまとめは日ごとに1行', () => {
    const w = weeklyDigest(doc, '2026-10-19');
    expect(w.title).toBe('来週 10/19(月)〜10/25(日): 予定4件・締切1件');
    expect(w.body).toBe('10/19(月) 夜勤、授業、スタジオ練習、〆日鉄 ES\n10/21(水) 祝日');
  });

  it('日曜の夜だけ来週のまとめも送る', () => {
    expect(digestsFor(doc, '2026-10-18').map((d) => d.tag)).toEqual(['daily-2026-10-19', 'weekly-2026-10-19']);
    expect(digestsFor(doc, '2026-10-19').map((d) => d.tag)).toEqual(['daily-2026-10-20']);
  });
});
