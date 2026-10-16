import type { EventInput } from './validation';
import type { EventDraft, EventRow } from '../types/event';
import { differenceInCalendarDays, parseISO } from 'date-fns';

/** DB rows are snake_case; the validation module works in camelCase (EventInput). */
export function toEventInput(row: EventRow | EventDraft): EventInput {
  return {
    title: row.title,
    category: row.category,
    date: row.date,
    doorsAt: row.doors_at,
    startsAt: row.starts_at,
    // 2日以上またぐ予定は、時刻だけでは長さが分からないので終了時刻を渡さない(所要時間チェックの対象外)
    endsAt: row.end_date && differenceInCalendarDays(parseISO(row.end_date), parseISO(row.date)) > 1 ? null : row.ends_at,
    sourceUrl: row.source_url,
    sourceImagePath: row.image ? 'local-image' : null,
    note: row.note,
    hasAlarm: row.has_alarm,
    timeConfirmed: row.time_confirmed,
  };
}
