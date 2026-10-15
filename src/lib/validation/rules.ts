import type { CategoryTimeProfile, EventInput, Warning } from './types';
import { daysUntil, durationMinutes, formatHourFloat, formatMinutesAsDuration, hourOf, parseTimeToMinutes } from './timeUtils';

export const FAR_FUTURE_DAYS = 60;

function inRange(hour: number, range: [number, number] | null): boolean {
  if (!range) return false;
  const [lo, hi] = range;
  return hour >= lo && hour <= hi;
}

/**
 * R1 (digit_drop): the classic "20:00 typed as 2:00" slip. For a single-digit hour we try
 * the two ways that typo happens - a dropped trailing zero (2 -> 20) or an AM/PM mixup
 * (2 -> 14) - and only warn when the corrected hour actually lands in the category's
 * typical range, so we never propose a nonsense "fix".
 */
export function digitDropCandidateHour(hour: number): number | null {
  if (hour < 0 || hour > 9) return null;
  const times10 = hour * 10;
  if (times10 < 24) return times10;
  const plus12 = hour + 12;
  return plus12 < 24 ? plus12 : null;
}

export function checkDigitDrop(event: EventInput, profile: CategoryTimeProfile): Warning | null {
  const hour = hourOf(event.startsAt);
  if (hour < 0 || hour > 9) return null;
  const candidateHour = digitDropCandidateHour(hour);
  if (candidateHour === null || !inRange(candidateHour, profile.startRange)) return null;

  const minute = parseTimeToMinutes(event.startsAt) % 60;
  const suggestedValue = `${String(candidateHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const isLateNight = hour <= 4;
  const prefix = isLateNight ? '深夜' : '';
  return {
    rule: 'digit_drop',
    message: `${prefix}${event.startsAt}開始になっています。${suggestedValue}の打ち間違いではありませんか？`,
    suggestedField: 'startsAt',
    suggestedValue,
    inputValue: event.startsAt,
  };
}

/** R2 (late_night): flags any 0:00-4:59 start. Always spells out "深夜" so a bare "2:00" isn't skimmed past. */
export function checkLateNight(event: EventInput): Warning | null {
  const hour = hourOf(event.startsAt);
  if (hour < 0 || hour > 4) return null;
  return {
    rule: 'late_night',
    message: `この予定は深夜${event.startsAt}スタートになっています。合っていますか？`,
    inputValue: event.startsAt,
  };
}

/** R3 (category_time_range): start time falls outside the category's typical window. */
export function checkCategoryTimeRange(event: EventInput, profile: CategoryTimeProfile): Warning | null {
  if (!profile.startRange) return null;
  const hour = parseTimeToMinutes(event.startsAt) / 60;
  if (inRange(hour, profile.startRange)) return null;
  const [lo, hi] = profile.startRange;
  return {
    rule: 'category_time_range',
    message: `過去の「${event.category}」の予定は${formatHourFloat(lo)}〜${formatHourFloat(hi)}の間に始まっています。この予定だけ${event.startsAt}になっています。`,
    inputValue: event.startsAt,
  };
}

/** R4 (duration): ends_at - starts_at is under 0.5x or over 3x the category's typical duration. */
export function checkDuration(
  event: EventInput,
  profile: CategoryTimeProfile,
  bounds: { min: number; max: number } = { min: 0.5, max: 3 },
): Warning | null {
  if (!event.endsAt || profile.typicalDurationHours == null) return null;
  const actualMinutes = durationMinutes(event.startsAt, event.endsAt);
  const typicalMinutes = profile.typicalDurationHours * 60;
  const ratio = actualMinutes / typicalMinutes;
  if (ratio >= bounds.min && ratio <= bounds.max) return null;

  const tooShort = ratio < bounds.min;
  const verb = tooShort ? '短すぎます' : '長すぎます';
  return {
    rule: 'duration',
    message: `所要時間が${formatMinutesAsDuration(actualMinutes)}と${verb}。通常の「${event.category}」は${formatMinutesAsDuration(typicalMinutes)}程度です。時刻を確認してください。`,
    inputValue: event.endsAt,
  };
}

export function isFarFuture(dateStr: string, now?: Date): boolean {
  return daysUntil(dateStr, now) >= FAR_FUTURE_DAYS;
}

/** R6 (far_future_reminder): registered long before the event, when mistakes go unnoticed longest. */
export function checkFarFutureReminder(event: EventInput, now?: Date): Warning | null {
  if (!isFarFuture(event.date, now)) return null;
  if (event.sourceUrl || event.sourceImagePath) return null;

  const days = daysUntil(event.date, now);
  const label = days >= 90 ? `${Math.round(days / 30)}ヶ月` : `${days}日`;
  return {
    rule: 'far_future_reminder',
    message: `${label}先の予定です。案内のURLやスクショを添付しておくと、後で確認できます。`,
    inputValue: event.date,
  };
}

/**
 * R6 also tightens R1/R3/R4's thresholds for far-future events, since mistakes made long
 * before the event tend to sit unnoticed the longest. Narrowing the "acceptable" range by
 * ~15% on each side means more borderline times/durations get flagged.
 */
export function widenSensitivity(profile: CategoryTimeProfile): CategoryTimeProfile {
  if (!profile.startRange) return profile;
  const [lo, hi] = profile.startRange;
  const pad = (hi - lo) * 0.15;
  return { startRange: [lo + pad, hi - pad], typicalDurationHours: profile.typicalDurationHours };
}

export const STRICT_DURATION_BOUNDS = { min: 0.6, max: 2.5 };

/** R5 (no evidence): silently flags events with nothing to verify the time against. Not a dialog warning. */
export function hasNoEvidence(event: EventInput): boolean {
  return !event.sourceUrl && !event.sourceImagePath && !event.note;
}
