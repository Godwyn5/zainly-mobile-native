/* eslint-disable @typescript-eslint/no-require-imports */

const { localDateStr, msUntilNextMidnight } = require('../useLocalDate');

// ─── Pure function tests: localDateStr ───────────────────────────────────────

describe('localDateStr (pure function)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('produces zero-padded YYYY-MM-DD for a normal date', () => {
    expect(localDateStr(new Date(2026, 7, 5, 14, 30))).toBe('2026-08-05');
  });

  it('zero-pads single-digit month and day', () => {
    expect(localDateStr(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('handles December 31 (end of year)', () => {
    expect(localDateStr(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('handles January 1 (start of year)', () => {
    expect(localDateStr(new Date(2027, 0, 1, 0, 1))).toBe('2027-01-01');
  });

  it('handles February 29 on a leap year', () => {
    expect(localDateStr(new Date(2028, 1, 29, 12, 0))).toBe('2028-02-29');
  });

  it('defaults to new Date() when no argument is given', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 5, 10, 0));
    expect(localDateStr()).toBe('2026-08-05');
    jest.useRealTimers();
  });

  it('never passes through UTC — uses local getFullYear/getMonth/getDate', () => {
    // Construct a date where UTC date differs from local date in most timezones.
    // new Date(2026, 7, 5, 1, 0) is Aug 5 at 01:00 local time.
    // In UTC+2, that's Aug 4 23:00 UTC — toISOString().slice(0,10) would give "2026-08-04".
    // localDateStr must give "2026-08-05" (local date).
    const d = new Date(2026, 7, 5, 1, 0);
    const localResult = localDateStr(d);
    const utcResult = d.toISOString().slice(0, 10);
    // The local result must always be the local date.
    expect(localResult).toBe('2026-08-05');
    // If the timezone causes a difference, verify localDateStr is NOT the UTC date.
    if (utcResult !== '2026-08-05') {
      expect(localResult).not.toBe(utcResult);
    }
  });
});

// ─── Pure function tests: msUntilNextMidnight ────────────────────────────────

describe('msUntilNextMidnight', () => {
  it('returns correct ms when at 23:59:30 (30 seconds to midnight)', () => {
    const from = new Date(2026, 7, 5, 23, 59, 30, 0);
    expect(msUntilNextMidnight(from)).toBe(30_000);
  });

  it('returns full 24h when exactly at midnight', () => {
    const from = new Date(2026, 7, 5, 0, 0, 0, 0);
    expect(msUntilNextMidnight(from)).toBe(24 * 60 * 60 * 1000);
  });

  it('returns correct ms at noon (12 hours to midnight)', () => {
    const from = new Date(2026, 7, 5, 12, 0, 0, 0);
    expect(msUntilNextMidnight(from)).toBe(12 * 60 * 60 * 1000);
  });

  it('crosses month boundary correctly (Aug 31 → Sep 1)', () => {
    const from = new Date(2026, 7, 31, 23, 30, 0, 0);
    const ms = msUntilNextMidnight(from);
    expect(ms).toBe(30 * 60 * 1000);
    const target = new Date(from.getTime() + ms);
    expect(target.getMonth()).toBe(8); // September (0-indexed)
    expect(target.getDate()).toBe(1);
  });

  it('crosses year boundary correctly (Dec 31 → Jan 1)', () => {
    const from = new Date(2026, 11, 31, 23, 45, 0, 0);
    const ms = msUntilNextMidnight(from);
    expect(ms).toBe(15 * 60 * 1000);
    const target = new Date(from.getTime() + ms);
    expect(target.getFullYear()).toBe(2027);
    expect(target.getMonth()).toBe(0);
    expect(target.getDate()).toBe(1);
  });

  it('crosses Feb 29 on a leap year (Feb 28 → Feb 29)', () => {
    const from = new Date(2028, 1, 28, 23, 0, 0, 0);
    const ms = msUntilNextMidnight(from);
    expect(ms).toBe(60 * 60 * 1000);
    const target = new Date(from.getTime() + ms);
    expect(target.getMonth()).toBe(1);
    expect(target.getDate()).toBe(29);
  });

  it('crosses Feb 28 on a non-leap year (Feb 28 → Mar 1)', () => {
    const from = new Date(2026, 1, 28, 23, 0, 0, 0);
    const ms = msUntilNextMidnight(from);
    expect(ms).toBe(60 * 60 * 1000);
    const target = new Date(from.getTime() + ms);
    expect(target.getMonth()).toBe(2); // March
    expect(target.getDate()).toBe(1);
  });
});

// ─── Simulated midnight scenarios (deterministic, no React rendering) ────────
//
// These tests simulate the exact logic the hook uses:
//   1. Compute today = localDateStr()
//   2. Schedule timer at msUntilNextMidnight()
//   3. When timer fires or AppState returns 'active', recompute today
//   4. Only update if the string changed
//
// We test the temporal logic without rendering React components,
// since @testing-library/react-hooks is not available in this project.

describe('Simulated midnight refresh logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('date is correct at mount before midnight', () => {
    jest.setSystemTime(new Date(2026, 7, 5, 23, 55, 0, 0));
    const today = localDateStr();
    expect(today).toBe('2026-08-05');
  });

  it('date changes after midnight when timer fires (app stays active)', () => {
    jest.setSystemTime(new Date(2026, 7, 5, 23, 55, 0, 0));
    let today = localDateStr();
    expect(today).toBe('2026-08-05');

    // Simulate the timer firing at midnight
    jest.setSystemTime(new Date(2026, 7, 6, 0, 0, 1, 0));
    const next = localDateStr();
    expect(next).not.toBe(today);
    expect(next).toBe('2026-08-06');
    today = next;
  });

  it('date changes when app returns to foreground after midnight', () => {
    // Mount at 23:50
    jest.setSystemTime(new Date(2026, 7, 5, 23, 50, 0, 0));
    let today = localDateStr();
    expect(today).toBe('2026-08-05');

    // App goes to background, time passes past midnight
    jest.setSystemTime(new Date(2026, 7, 6, 0, 10, 0, 0));

    // App returns to foreground — hook calls localDateStr() again
    const next = localDateStr();
    expect(next).not.toBe(today);
    expect(next).toBe('2026-08-06');
  });

  it('date does NOT change when app returns to foreground on the same day', () => {
    jest.setSystemTime(new Date(2026, 7, 5, 10, 0, 0, 0));
    const today = localDateStr();

    // Brief background → foreground, same day
    jest.setSystemTime(new Date(2026, 7, 5, 10, 5, 0, 0));
    const next = localDateStr();
    expect(next).toBe(today);
  });

  it('handles month boundary (Aug 31 → Sep 1) via timer', () => {
    jest.setSystemTime(new Date(2026, 7, 31, 23, 50, 0, 0));
    let today = localDateStr();
    expect(today).toBe('2026-08-31');

    jest.setSystemTime(new Date(2026, 8, 1, 0, 0, 1, 0));
    const next = localDateStr();
    expect(next).toBe('2026-09-01');
  });

  it('handles year boundary (Dec 31 → Jan 1) via timer', () => {
    jest.setSystemTime(new Date(2026, 11, 31, 23, 50, 0, 0));
    let today = localDateStr();
    expect(today).toBe('2026-12-31');

    jest.setSystemTime(new Date(2027, 0, 1, 0, 0, 1, 0));
    const next = localDateStr();
    expect(next).toBe('2027-01-01');
  });

  it('timer is rescheduled correctly for consecutive days', () => {
    // Day 1: Aug 5 at 23:55
    jest.setSystemTime(new Date(2026, 7, 5, 23, 55, 0, 0));
    const ms1 = msUntilNextMidnight();
    expect(ms1).toBe(5 * 60 * 1000); // 5 minutes to midnight

    // After first midnight
    jest.setSystemTime(new Date(2026, 7, 6, 0, 0, 1, 0));
    const ms2 = msUntilNextMidnight();
    expect(ms2).toBe(24 * 60 * 60 * 1000 - 1000); // ~24h to next midnight

    // After second midnight
    jest.setSystemTime(new Date(2026, 7, 7, 0, 0, 1, 0));
    const ms3 = msUntilNextMidnight();
    expect(ms3).toBe(24 * 60 * 60 * 1000 - 1000);
  });

  it('sessionDoneToday pattern: true before midnight, false after', () => {
    // Simulate the pattern from dailyPlan.ts:
    //   sessionDoneToday = progress.last_session_date === today
    jest.setSystemTime(new Date(2026, 7, 5, 23, 50, 0, 0));
    const lastSessionDate = localDateStr();
    expect(lastSessionDate === localDateStr()).toBe(true); // sessionDoneToday = true

    // Advance past midnight
    jest.setSystemTime(new Date(2026, 7, 6, 0, 0, 1, 0));
    const todayAfterMidnight = localDateStr();
    expect(todayAfterMidnight === lastSessionDate).toBe(false); // sessionDoneToday = false
    expect(todayAfterMidnight).toBe('2026-08-06');
  });

  it('timer ms is always positive and less than or equal to 24h', () => {
    // Test at various times of day
    const times = [
      new Date(2026, 7, 5, 0, 0, 0, 0),
      new Date(2026, 7, 5, 6, 0, 0, 0),
      new Date(2026, 7, 5, 12, 0, 0, 0),
      new Date(2026, 7, 5, 18, 0, 0, 0),
      new Date(2026, 7, 5, 23, 59, 59, 999),
    ];
    for (const t of times) {
      const ms = msUntilNextMidnight(t);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
});
