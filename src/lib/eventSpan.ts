import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { EventRow } from '../types/event';

/**
 * 日をまたぐ予定の扱い。予定は date(始まる日)+ starts_at から、end_date(終わる日)+ ends_at まで続く。
 * end_date が無ければ同じ日に終わる。
 */
type Spanning = Pick<EventRow, 'date' | 'starts_at' | 'ends_at'> & { end_date?: string | null; doors_at?: string | null };

/**
 * 「翌日の 0:00 に終わる」予定(20:00〜24:00 など)は、日をまたがずその日の終わりまでの予定として扱う。
 */
export function endsAtMidnight(e: Spanning): boolean {
  return !!e.end_date && e.ends_at === '00:00' && e.end_date === format(addDays(parseISO(e.date), 1), 'yyyy-MM-dd') && e.starts_at !== '00:00';
}

/** 予定が終わる日(同じ日に終わるなら date) */
export function eventEndDate(e: Spanning): string {
  if (endsAtMidnight(e)) return e.date;
  return e.end_date && e.end_date > e.date ? e.end_date : e.date;
}

/** 表示用の終了時刻(24時ちょうどに終わる予定は「24:00」) */
export function displayEnd(e: Spanning): string | null {
  return endsAtMidnight(e) ? '24:00' : e.ends_at;
}

export function isMultiDay(e: Spanning): boolean {
  return eventEndDate(e) !== e.date;
}

/** その日に予定がかかっているか */
export function eventOccursOn(e: Spanning, day: string): boolean {
  return day >= e.date && day <= eventEndDate(e);
}

/** 予定がかかっている日の一覧(長すぎる予定は62日で打ち切る) */
export function eventDays(e: Spanning): string[] {
  const days = Math.min(differenceInCalendarDays(parseISO(eventEndDate(e)), parseISO(e.date)), 61);
  return Array.from({ length: days + 1 }, (_, i) => format(addDays(parseISO(e.date), i), 'yyyy-MM-dd'));
}

/**
 * その日の中で予定が占める時間帯。日をまたぐ予定は、初日は開始〜24:00、途中の日は 0:00〜24:00、
 * 最後の日は 0:00〜終了時刻 になる。「24:00」は1日の終わりを表す。
 */
export function eventSliceOn(e: Spanning, day: string): { doors_at: string | null; starts_at: string; ends_at: string | null; continued: boolean; continues: boolean } {
  if (!isMultiDay(e)) return { doors_at: e.doors_at ?? null, starts_at: e.starts_at, ends_at: displayEnd(e), continued: false, continues: false };
  const first = day === e.date;
  const last = day === eventEndDate(e);
  return {
    doors_at: first ? (e.doors_at ?? null) : null,
    starts_at: first ? e.starts_at : '00:00',
    ends_at: last ? (e.ends_at ?? '24:00') : '24:00',
    continued: !first,
    continues: !last,
  };
}
