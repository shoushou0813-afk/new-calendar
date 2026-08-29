import { getDefaultProfile } from './categoryDefaults';
import type { CategoryTimeProfile, EventInput } from './types';
import { durationMinutes, parseTimeToMinutes } from './timeUtils';

const MIN_SAMPLE_SIZE = 5;

/** Linear-interpolation percentile, same convention as numpy's default. */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower];
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Derives a category's typical start-time range and duration from the user's own past
 * events, falling back to defaults when there isn't enough history yet (spec R3: need 5+).
 * Uses the 10th-90th percentile of start times rather than min/max so a single outlier
 * (e.g. one mistyped event) doesn't distort the "typical" range.
 */
export function computeCategoryProfile(category: string, history: EventInput[]): CategoryTimeProfile {
  const sameCategory = history.filter((e) => e.category === category);
  if (sameCategory.length < MIN_SAMPLE_SIZE) {
    return getDefaultProfile(category);
  }

  const startHours = sameCategory
    .map((e) => parseTimeToMinutes(e.startsAt) / 60)
    .sort((a, b) => a - b);
  const startRange: [number, number] = [percentile(startHours, 10), percentile(startHours, 90)];

  const durations = sameCategory
    .filter((e): e is EventInput & { endsAt: string } => Boolean(e.endsAt))
    .map((e) => durationMinutes(e.startsAt, e.endsAt) / 60);
  const typicalDurationHours = durations.length > 0 ? median(durations) : getDefaultProfile(category).typicalDurationHours;

  return { startRange, typicalDurationHours };
}
