import type { EventRow } from '../../types/event';

/** 分単位の時間帯。0 = その日の 0:00。 */
export interface Slot {
  start: number;
  end: number;
}

/** 終了時刻のない予定は、この長さだけ埋まっているとみなす */
const DEFAULT_EVENT_MINUTES = 60;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** その日の予定が埋めている時間帯(重なりはまとめる)。 */
export function busySlots(dayEvents: Pick<EventRow, 'doors_at' | 'starts_at' | 'ends_at'>[]): Slot[] {
  const raw = dayEvents.map((e) => {
    const start = Math.min(toMinutes(e.starts_at), e.doors_at ? toMinutes(e.doors_at) : Infinity);
    let end = e.ends_at ? toMinutes(e.ends_at) : toMinutes(e.starts_at) + DEFAULT_EVENT_MINUTES;
    if (end <= start) end = start + DEFAULT_EVENT_MINUTES;
    return { start, end: Math.min(end, 24 * 60) };
  });
  return mergeSlots(raw);
}

export function mergeSlots(slots: Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const merged: Slot[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * 作業時間帯 [workStart, workEnd) から予定で埋まっている時間を引いた空き時間。
 * notBefore を渡すと、それより前は使わない(今日の「もう過ぎた時間」を除くため)。
 * 15分未満の細切れは作業に使えないので捨てる。
 */
export function freeSlots(
  dayEvents: Pick<EventRow, 'doors_at' | 'starts_at' | 'ends_at'>[],
  workStart: string,
  workEnd: string,
  notBefore = 0,
  minSlotMinutes = 15,
): Slot[] {
  const start = Math.max(toMinutes(workStart), roundUpTo(notBefore, 5));
  const end = toMinutes(workEnd);
  if (start >= end) return [];

  const result: Slot[] = [];
  let cursor = start;
  for (const busy of busySlots(dayEvents)) {
    if (busy.end <= cursor) continue;
    if (busy.start >= end) break;
    if (busy.start > cursor) result.push({ start: cursor, end: Math.min(busy.start, end) });
    cursor = Math.max(cursor, busy.end);
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result.filter((s) => s.end - s.start >= minSlotMinutes);
}

export function totalMinutes(slots: Slot[]): number {
  return slots.reduce((sum, s) => sum + (s.end - s.start), 0);
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}
