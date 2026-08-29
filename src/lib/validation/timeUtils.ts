import { addDays, differenceInCalendarDays, differenceInMinutes, parse, parseISO } from 'date-fns';

// Arbitrary fixed reference date used to parse bare "HH:mm" strings with date-fns.
const REFERENCE_DATE = new Date(2000, 0, 1);

export function parseTimeToMinutes(time: string): number {
  const parsed = parse(time, 'HH:mm', REFERENCE_DATE);
  return parsed.getHours() * 60 + parsed.getMinutes();
}

export function hourOf(time: string): number {
  return Math.floor(parseTimeToMinutes(time) / 60);
}

/** Duration in minutes, treating an end time <= start time as spanning into the next day. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  const start = parse(startsAt, 'HH:mm', REFERENCE_DATE);
  let end = parse(endsAt, 'HH:mm', REFERENCE_DATE);
  if (end <= start) end = addDays(end, 1);
  return differenceInMinutes(end, start);
}

export function daysUntil(dateStr: string, now: Date = new Date()): number {
  return differenceInCalendarDays(parseISO(dateStr), now);
}

export function formatMinutesAsDuration(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}時間` : `${hours.toFixed(1)}時間`;
}

export function formatHourFloat(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
