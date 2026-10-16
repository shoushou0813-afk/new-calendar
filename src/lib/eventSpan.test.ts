import { describe, expect, it } from 'vitest';
import { eventDays, eventEndDate, eventOccursOn, eventSliceOn } from './eventSpan';

const overnight = { date: '2026-11-08', starts_at: '17:00', ends_at: '00:04', end_date: '2026-11-09' };
const threeDays = { date: '2026-10-24', starts_at: '10:00', ends_at: '11:00', end_date: '2026-10-26' };
const sameDay = { date: '2026-10-20', starts_at: '10:00', ends_at: '11:00' };

describe('eventSpan', () => {
  it('終わる日とかかっている日', () => {
    expect(eventEndDate(sameDay)).toBe('2026-10-20');
    expect(eventEndDate({ ...sameDay, end_date: '2026-10-19' })).toBe('2026-10-20'); // 前の日は無視
    expect(eventDays(threeDays)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(eventOccursOn(overnight, '2026-11-09')).toBe(true);
    expect(eventOccursOn(overnight, '2026-11-10')).toBe(false);
  });

  it('その日の中で占める時間帯', () => {
    expect(eventSliceOn(overnight, '2026-11-08')).toMatchObject({ starts_at: '17:00', ends_at: '24:00', continues: true, continued: false });
    expect(eventSliceOn(overnight, '2026-11-09')).toMatchObject({ starts_at: '00:00', ends_at: '00:04', continued: true, continues: false });
    expect(eventSliceOn(threeDays, '2026-10-25')).toMatchObject({ starts_at: '00:00', ends_at: '24:00' });
    expect(eventSliceOn(sameDay, '2026-10-20')).toMatchObject({ starts_at: '10:00', ends_at: '11:00', continued: false, continues: false });
  });

  it('24時ちょうどに終わる予定は日をまたがない', () => {
    const shift = { date: '2026-10-01', starts_at: '20:00', ends_at: '00:00', end_date: '2026-10-02' };
    expect(eventEndDate(shift)).toBe('2026-10-01');
    expect(eventOccursOn(shift, '2026-10-02')).toBe(false);
    expect(eventDays(shift)).toEqual(['2026-10-01']);
    expect(eventSliceOn(shift, '2026-10-01')).toMatchObject({ starts_at: '20:00', ends_at: '24:00', continues: false });
  });
});
