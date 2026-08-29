import type { EventInput } from './validation';
import type { EventDraft, EventRow } from '../types/event';

/** DB rows are snake_case; the validation module works in camelCase (EventInput). */
export function toEventInput(row: EventRow | EventDraft): EventInput {
  return {
    title: row.title,
    category: row.category,
    date: row.date,
    doorsAt: row.doors_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sourceUrl: row.source_url,
    sourceImagePath: row.source_image_path,
    note: row.note,
    hasAlarm: row.has_alarm,
    timeConfirmed: row.time_confirmed,
  };
}
