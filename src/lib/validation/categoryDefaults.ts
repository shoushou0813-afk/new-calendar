import type { CategoryTimeProfile } from './types';

export const DEFAULT_CATEGORIES = ['ライブ', '仕事', '学校', '病院', '飲み会', '旅行', 'その他'] as const;

/**
 * Fallback profiles used until a user has 5+ past events in a category (see historyProfile.ts).
 * startRange: null means "no typical range" (旅行・その他 — too varied to judge).
 */
export const CATEGORY_DEFAULT_PROFILES: Record<string, CategoryTimeProfile> = {
  ライブ: { startRange: [17, 22], typicalDurationHours: 2 },
  仕事: { startRange: [8, 20], typicalDurationHours: 8 },
  学校: { startRange: [8, 19], typicalDurationHours: 6 },
  病院: { startRange: [8, 18], typicalDurationHours: 1 },
  飲み会: { startRange: [17, 23], typicalDurationHours: 2.5 },
  旅行: { startRange: null, typicalDurationHours: null },
  その他: { startRange: null, typicalDurationHours: null },
};

export const UNRESTRICTED_PROFILE: CategoryTimeProfile = { startRange: null, typicalDurationHours: null };

export function getDefaultProfile(category: string): CategoryTimeProfile {
  return CATEGORY_DEFAULT_PROFILES[category] ?? UNRESTRICTED_PROFILE;
}
