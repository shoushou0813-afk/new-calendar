export interface EventInput {
  title: string;
  category: string;
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm */
  doorsAt?: string | null;
  /** HH:mm */
  startsAt: string;
  /** HH:mm */
  endsAt?: string | null;
  sourceUrl?: string | null;
  sourceImagePath?: string | null;
  note?: string | null;
  hasAlarm?: boolean;
  timeConfirmed?: boolean;
}

export type WarningRule =
  | 'digit_drop'
  | 'late_night'
  | 'category_time_range'
  | 'duration'
  | 'far_future_reminder';

export interface Warning {
  rule: WarningRule;
  message: string;
  /** field the fix would apply to, when the warning offers a concrete correction */
  suggestedField?: 'startsAt';
  /** HH:mm, present when the warning offers a one-click fix */
  suggestedValue?: string;
  inputValue: string;
}

/** Matches the shape stored in events.warnings (jsonb) */
export interface WarningLogEntry {
  rule: WarningRule;
  detected_at: string;
  input_value: string;
  suggested_value: string | null;
  user_action: 'accepted' | 'dismissed';
}

export interface CategoryTimeProfile {
  /** [startHourInclusive, endHourInclusive] as fractional hours, or null when unrestricted */
  startRange: [number, number] | null;
  /** typical duration in hours, or null when there's no meaningful standard */
  typicalDurationHours: number | null;
}
