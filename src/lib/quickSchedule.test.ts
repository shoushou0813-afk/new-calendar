import { describe, expect, it } from 'vitest';
import { parseQuickSchedule } from './quickSchedule';

describe('parseQuickSchedule', () => {
  it('1行ずつの流れを、次の行の時刻を終わりにして予定にする', () => {
    const text = `7:50 起きれない
8:20 朝飯
9:00 陳列
10:00 陳列
11:00 巡回
15:00 巡回終わり
16:00 商談
19:00 帰社
19:30 めし
21:00 帰宅
22:00 ダスごし
23:00 ふろ
24:00 ねる`;
    const { items, skipped } = parseQuickSchedule(text, '2026-10-19');
    expect(skipped).toEqual([]);
    expect(items[0]).toEqual({ date: '2026-10-19', start: '07:50', end: '08:20', title: '起きれない' });
    expect(items[4]).toEqual({ date: '2026-10-19', start: '11:00', end: '15:00', title: '巡回' });
    // 23:00 ふろ は 24:00(日付が変わる)で終わるので、終わりの時刻は持たない
    expect(items[11]).toEqual({ date: '2026-10-19', start: '23:00', end: null, title: 'ふろ' });
    // 24:00 は翌日の 0:00
    expect(items[12]).toEqual({ date: '2026-10-20', start: '00:00', end: null, title: 'ねる' });
  });

  it('いろいろな時刻の書き方と、読めない行', () => {
    const { items, skipped } = parseQuickSchedule('９：３０　バイト\n13時 昼\n14時30分 会議\n15:00-16:30 歯医者\nメモだけの行', '2026-10-20');
    expect(items.map((i) => [i.start, i.end, i.title])).toEqual([
      ['09:30', '13:00', 'バイト'],
      ['13:00', '14:30', '昼'],
      ['14:30', '15:00', '会議'],
      ['15:00', '16:30', '歯医者'],
    ]);
    expect(skipped).toEqual(['メモだけの行']);
  });
});
