import type { Warning, WarningLogEntry } from './validation';

/** Appends one log entry per warning the user just acted on (spec 3: events.warnings). */
export function appendWarningLog(
  existing: WarningLogEntry[],
  warnings: Warning[],
  userAction: WarningLogEntry['user_action'],
  detectedAt: string = new Date().toISOString(),
): WarningLogEntry[] {
  const entries: WarningLogEntry[] = warnings.map((w) => ({
    rule: w.rule,
    detected_at: detectedAt,
    input_value: w.inputValue,
    suggested_value: w.suggestedValue ?? null,
    user_action: userAction,
  }));
  return [...existing, ...entries];
}
