import { describe, expect, it } from 'vitest';
import { parseIcs } from './icsImport';

describe('parseIcs', () => {
  it('parses a basic timed event with floating (non-UTC) time', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1@example.com',
      'SUMMARY:バンドライブ',
      'DTSTART:20260901T190000',
      'DTEND:20260901T210000',
      'URL:https://example.com/ticket',
      'DESCRIPTION:会場は渋谷です',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcs(ics);
    expect(events).toEqual([
      {
        title: 'バンドライブ',
        date: '2026-09-01',
        startsAt: '19:00',
        endsAt: '21:00',
        sourceUrl: 'https://example.com/ticket',
        note: '会場は渋谷です',
      },
    ]);
  });

  it('converts a UTC (Z-suffixed) DTSTART to the runtime local time zone', () => {
    const ics = ['BEGIN:VEVENT', 'SUMMARY:UTC Event', 'DTSTART:20260901T100000Z', 'END:VEVENT'].join('\n');

    const expectedLocal = new Date(Date.UTC(2026, 8, 1, 10, 0));
    const expectedDate = `${expectedLocal.getFullYear()}-${String(expectedLocal.getMonth() + 1).padStart(2, '0')}-${String(expectedLocal.getDate()).padStart(2, '0')}`;
    const expectedTime = `${String(expectedLocal.getHours()).padStart(2, '0')}:${String(expectedLocal.getMinutes()).padStart(2, '0')}`;

    const events = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe(expectedDate);
    expect(events[0].startsAt).toBe(expectedTime);
  });

  it('parses an all-day event with a default 00:00 start and no end time', () => {
    const ics = ['BEGIN:VEVENT', 'SUMMARY:旅行', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261203', 'END:VEVENT'].join('\n');

    const events = parseIcs(ics);
    expect(events).toEqual([{ title: '旅行', date: '2026-12-01', startsAt: '00:00', endsAt: null, sourceUrl: null, note: null }]);
  });

  it('drops the end time when DTEND falls on a different day than DTSTART', () => {
    const ics = ['BEGIN:VEVENT', 'SUMMARY:夜通しイベント', 'DTSTART:20260901T230000', 'DTEND:20260902T020000', 'END:VEVENT'].join('\n');

    const events = parseIcs(ics);
    expect(events[0].endsAt).toBeNull();
  });

  it('unescapes commas, semicolons, backslashes, and newlines in text fields', () => {
    const ics = ['BEGIN:VEVENT', 'SUMMARY:打ち合わせ\\, 資料確認', 'DTSTART:20260901T090000', 'DESCRIPTION:1行目\\n2行目\\;注記', 'END:VEVENT'].join(
      '\n',
    );

    const events = parseIcs(ics);
    expect(events[0].title).toBe('打ち合わせ, 資料確認');
    expect(events[0].note).toBe('1行目\n2行目;注記');
  });

  it('un-folds continuation lines per RFC 5545', () => {
    const ics = ['BEGIN:VEVENT', 'SUMMARY:長いタイトルの予定です\r\n が続きます', 'DTSTART:20260901T090000', 'END:VEVENT'].join('\n');

    const events = parseIcs(ics);
    expect(events[0].title).toBe('長いタイトルの予定ですが続きます');
  });

  it('parses multiple VEVENT blocks and ignores events with no DTSTART', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:予定A',
      'DTSTART:20260901T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:予定B（開始日時なし）',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:予定C',
      'DTSTART:20260902T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');

    const events = parseIcs(ics);
    expect(events.map((e) => e.title)).toEqual(['予定A', '予定C']);
  });

  it('defaults an untitled event to a placeholder title', () => {
    const ics = ['BEGIN:VEVENT', 'DTSTART:20260901T090000', 'END:VEVENT'].join('\n');
    const events = parseIcs(ics);
    expect(events[0].title).toBe('(無題の予定)');
  });

  it('returns an empty array for text with no VEVENT blocks', () => {
    expect(parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toEqual([]);
  });
});
