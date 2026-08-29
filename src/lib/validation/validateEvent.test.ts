import { describe, expect, it } from 'vitest';
import { validateEvent } from './validateEvent';
import { hasNoEvidence } from './rules';
import type { EventInput } from './types';

const NOW = new Date('2026-08-29T00:00:00+09:00');
const NEAR_DATE = '2026-09-15'; // well under 60 days out, so R6 never fires in these cases

function makeEvent(overrides: Partial<EventInput>): EventInput {
  return {
    title: 'テスト予定',
    category: 'ライブ',
    date: NEAR_DATE,
    startsAt: '19:00',
    endsAt: '21:00',
    sourceUrl: 'https://example.com/ticket',
    ...overrides,
  };
}

function rules(warnings: ReturnType<typeof validateEvent>) {
  return warnings.map((w) => w.rule);
}

describe('validateEvent — spec section 7 table', () => {
  it('ライブ / 2:00-3:00 -> R1(20:00を提案) + R2', () => {
    const event = makeEvent({ category: 'ライブ', startsAt: '02:00', endsAt: '03:00' });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).toEqual(expect.arrayContaining(['digit_drop', 'late_night']));
    const digitDrop = warnings.find((w) => w.rule === 'digit_drop');
    expect(digitDrop?.suggestedValue).toBe('20:00');
    expect(digitDrop?.message).toContain('深夜');
  });

  it('ライブ / 18:00-20:00 -> 警告なし', () => {
    const event = makeEvent({ category: 'ライブ', startsAt: '18:00', endsAt: '20:00' });
    expect(validateEvent(event, [], NOW)).toEqual([]);
  });

  it('仕事 / 9:00-18:00 -> 警告なし', () => {
    const event = makeEvent({ category: '仕事', startsAt: '09:00', endsAt: '18:00' });
    expect(validateEvent(event, [], NOW)).toEqual([]);
  });

  it('飲み会 / 19:00-23:00 -> 警告なし', () => {
    const event = makeEvent({ category: '飲み会', startsAt: '19:00', endsAt: '23:00' });
    expect(validateEvent(event, [], NOW)).toEqual([]);
  });

  it('ライブ / 18:00-18:30 -> R4(所要時間が短すぎる)', () => {
    const event = makeEvent({ category: 'ライブ', startsAt: '18:00', endsAt: '18:30' });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).toContain('duration');
    expect(warnings.find((w) => w.rule === 'duration')?.message).toContain('短すぎます');
  });

  it('ライブ / 3:00-5:00, time_confirmed=true -> 警告なし（確認済み）', () => {
    const event = makeEvent({ category: 'ライブ', startsAt: '03:00', endsAt: '05:00', timeConfirmed: true });
    expect(validateEvent(event, [], NOW)).toEqual([]);
  });

  it('病院 / 2:00-3:00 -> R1は該当なし（20:00も典型外）+ R2が発火', () => {
    const event = makeEvent({ category: '病院', startsAt: '02:00', endsAt: '03:00' });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).not.toContain('digit_drop');
    expect(rules(warnings)).toContain('late_night');
  });
});

describe('validateEvent — additional rule behavior', () => {
  it('does not suggest a fix when no candidate falls in the typical range (仕事 9:00)', () => {
    const event = makeEvent({ category: '仕事', startsAt: '09:00', endsAt: '17:00' });
    expect(validateEvent(event, [], NOW)).toEqual([]);
  });

  it('R3 fires with the historical range when no default exists but no digit-drop candidate applies', () => {
    // 13:00 is outside ライブ's default 17-22 range but has no valid digit-drop reading.
    const event = makeEvent({ category: 'ライブ', startsAt: '13:00', endsAt: '15:00' });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).toEqual(['category_time_range']);
  });

  it('R3 uses the 10-90 percentile of 5+ past events instead of raw min/max', () => {
    const history: EventInput[] = [
      makeEvent({ startsAt: '18:00', endsAt: '20:00' }),
      makeEvent({ startsAt: '18:30', endsAt: '20:30' }),
      makeEvent({ startsAt: '19:00', endsAt: '21:00' }),
      makeEvent({ startsAt: '19:30', endsAt: '21:30' }),
      makeEvent({ startsAt: '20:00', endsAt: '22:00' }),
      makeEvent({ startsAt: '01:00', endsAt: '02:00' }), // outlier, should not pull the range down
    ];
    const event = makeEvent({ startsAt: '18:15', endsAt: '20:15' });
    expect(validateEvent(event, history, NOW)).toEqual([]);
  });

  it('R4 also fires when duration is too long relative to the category standard', () => {
    const event = makeEvent({ category: '病院', startsAt: '09:00', endsAt: '18:00' });
    // typical 病院 duration default is 1h; 9h is > 3x
    const warnings = validateEvent(event, [], NOW);
    expect(warnings.find((w) => w.rule === 'duration')?.message).toContain('長すぎます');
  });

  it('旅行 has no typical range or duration, so odd hours pass silently', () => {
    const event = makeEvent({ category: '旅行', startsAt: '03:00', endsAt: '04:00' });
    const warnings = validateEvent(event, [], NOW);
    // late-night still applies universally, but no digit-drop or range/duration warning
    expect(rules(warnings)).toEqual(['late_night']);
  });

  it('R6 fires a reminder for events 60+ days out with no evidence attached', () => {
    const event = makeEvent({ date: '2026-12-01', startsAt: '19:00', endsAt: '21:00', sourceUrl: null, sourceImagePath: null, note: null });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).toContain('far_future_reminder');
  });

  it('R6 stays quiet when a source URL or image is already attached', () => {
    const event = makeEvent({ date: '2026-12-01', startsAt: '19:00', endsAt: '21:00', sourceUrl: 'https://example.com' });
    const warnings = validateEvent(event, [], NOW);
    expect(rules(warnings)).not.toContain('far_future_reminder');
  });

  it('R6 tightens thresholds so a borderline start time is flagged when far in the future', () => {
    // 17:15 sits just inside ライブ's 17-22 default range, but R6 narrows the range for
    // far-future events, so this should now trigger the range check.
    const near = makeEvent({ date: NEAR_DATE, startsAt: '17:15', endsAt: '19:15' });
    const far = makeEvent({ date: '2026-12-01', startsAt: '17:15', endsAt: '19:15', sourceUrl: null });

    expect(validateEvent(near, [], NOW)).toEqual([]);
    expect(rules(validateEvent(far, [], NOW))).toContain('category_time_range');
  });
});

describe('hasNoEvidence (R5)', () => {
  it('flags events with no url, image, or note', () => {
    const event = makeEvent({ sourceUrl: null, sourceImagePath: null, note: null });
    expect(hasNoEvidence(event)).toBe(true);
  });

  it('does not flag events with at least one piece of evidence', () => {
    expect(hasNoEvidence(makeEvent({ sourceUrl: 'https://example.com', sourceImagePath: null, note: null }))).toBe(false);
    expect(hasNoEvidence(makeEvent({ sourceUrl: null, sourceImagePath: null, note: 'メモ' }))).toBe(false);
  });

  it('is not part of the dialog warnings returned by validateEvent', () => {
    const event = makeEvent({ sourceUrl: null, sourceImagePath: null, note: null });
    expect(rules(validateEvent(event, [], NOW))).not.toContain('no_evidence' as never);
  });
});
