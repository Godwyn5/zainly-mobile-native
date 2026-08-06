/// <reference types="jest" />
import { estimateDuration, chargeInfo } from '../sessionWorkload';

// ─── estimateDuration ────────────────────────────────────────────────────────

describe('estimateDuration', () => {
  it.each([
    [0, true,  '~8 min'],
    [2, true,  '~8 min'],
    [0, false, '~5 min'],
    [2, false, '~5 min'],
    [3, true,  '~12 min'],
    [5, true,  '~12 min'],
    [3, false, '~8 min'],
    [5, false, '~8 min'],
    [6, true,  '~20 min'],
    [6, false, '~15 min'],
  ])('ayatCount=%i, hasReviews=%s → %s', (ayatCount, hasReviews, expected) => {
    expect(estimateDuration(ayatCount, hasReviews)).toBe(expected);
  });
});

// ─── chargeInfo ──────────────────────────────────────────────────────────────

describe('chargeInfo', () => {
  it('returns light tier with exact label', () => {
    expect(chargeInfo(0, 0)).toEqual({ label: 'Légère', level: 'light' });
  });

  it('boundary ayatCount 2→3 triggers normal (no reviews)', () => {
    expect(chargeInfo(2, 0).level).toBe('light');
    expect(chargeInfo(3, 0)).toEqual({ label: 'Normale', level: 'normal' });
  });

  it('boundary ayatCount 5→6 triggers intense (no reviews)', () => {
    expect(chargeInfo(5, 0).level).toBe('normal');
    expect(chargeInfo(6, 0)).toEqual({ label: 'Intense', level: 'intense' });
  });

  it('normal triggered solely by reviewCount > 0 (low ayatCount)', () => {
    expect(chargeInfo(1, 1)).toEqual({ label: 'Normale', level: 'normal' });
  });

  it('boundary reviewCount 4→5 triggers intense (low ayatCount)', () => {
    expect(chargeInfo(1, 4).level).toBe('normal');
    expect(chargeInfo(1, 5)).toEqual({ label: 'Intense', level: 'intense' });
  });
});
