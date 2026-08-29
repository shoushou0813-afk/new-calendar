import { computeCategoryProfile } from './historyProfile';
import {
  STRICT_DURATION_BOUNDS,
  checkCategoryTimeRange,
  checkDigitDrop,
  checkDuration,
  checkFarFutureReminder,
  checkLateNight,
  isFarFuture,
  widenSensitivity,
} from './rules';
import type { EventInput, Warning } from './types';

/**
 * Pure validation entry point (spec 5/6): evaluates rules R1-R4 and R6 against an event and
 * the user's own history in that category, returning warnings to show in a dialog at save
 * time. Never throws and never blocks the save - callers decide what to do with the result.
 *
 * R1 and R3 both describe "the start time looks wrong"; when R1 finds a specific typo it's
 * likely to be, that's more useful than R3's generic "outside your usual range" so R3 is
 * skipped in that case. R2 (late night) is independent and can fire alongside either.
 */
export function validateEvent(event: EventInput, userHistory: EventInput[] = [], now?: Date): Warning[] {
  if (event.timeConfirmed) return [];

  const warnings: Warning[] = [];
  const farFuture = isFarFuture(event.date, now);
  const baseProfile = computeCategoryProfile(event.category, userHistory);
  const effectiveProfile = farFuture ? widenSensitivity(baseProfile) : baseProfile;

  const digitDropWarning = checkDigitDrop(event, effectiveProfile);
  if (digitDropWarning) warnings.push(digitDropWarning);

  const lateNightWarning = checkLateNight(event);
  if (lateNightWarning) warnings.push(lateNightWarning);

  if (!digitDropWarning) {
    const rangeWarning = checkCategoryTimeRange(event, effectiveProfile);
    if (rangeWarning) warnings.push(rangeWarning);
  }

  const durationWarning = checkDuration(event, effectiveProfile, farFuture ? STRICT_DURATION_BOUNDS : undefined);
  if (durationWarning) warnings.push(durationWarning);

  const farFutureWarning = checkFarFutureReminder(event, now);
  if (farFutureWarning) warnings.push(farFutureWarning);

  return warnings;
}

export type { EventInput, Warning, WarningLogEntry, WarningRule, CategoryTimeProfile } from './types';
export { hasNoEvidence } from './rules';
export { DEFAULT_CATEGORIES } from './categoryDefaults';
export { computeCategoryProfile } from './historyProfile';
