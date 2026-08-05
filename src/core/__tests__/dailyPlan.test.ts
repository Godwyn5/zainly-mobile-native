/// <reference types="jest" />
import {
  getTodayProgramme,
  type PlanSnapshot,
  type ProgressSnapshot,
} from '../dailyPlan';
import { ZAINLY_ORDER, nextSurahInOrder } from '../zainlyOrder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    ayah_per_day: 3,
    plan_mode: 'recommended',
    custom_surah_order: null,
    ...overrides,
  };
}

function makeProgress(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    current_surah: 1,
    current_ayah: 0,
    ayah_per_day: 3,
    streak: 0,
    total_memorized: 0,
    last_session_date: null,
    ...overrides,
  };
}

const TODAY = '2026-08-06';

// ─── getTodayProgramme — null / missing inputs ───────────────────────────────

describe('getTodayProgramme — null / missing inputs', () => {
  it('returns safe defaults when plan is null', () => {
    const result = getTodayProgramme({ plan: null, progress: makeProgress(), dueReviewCount: 0, today: TODAY });
    expect(result.currentSurah).toBeNull();
    expect(result.memStart).toBeNull();
    expect(result.memEnd).toBeNull();
    expect(result.todayAyatCount).toBe(0);
    expect(result.dueReviewCount).toBe(0);
  });

  it('returns safe defaults when progress is null', () => {
    const result = getTodayProgramme({ plan: makePlan(), progress: null, dueReviewCount: 5, today: TODAY });
    expect(result.currentSurah).toBeNull();
    expect(result.memStart).toBeNull();
    expect(result.dueReviewCount).toBe(5);
  });

  it('returns safe defaults when both are undefined', () => {
    const result = getTodayProgramme({ plan: undefined, progress: undefined, dueReviewCount: 3, today: TODAY });
    expect(result.currentSurah).toBeNull();
    expect(result.todayAyatCount).toBe(0);
    expect(result.dueReviewCount).toBe(3);
  });
});

// ─── getTodayProgramme — normal session ───────────────────────────────────────

describe('getTodayProgramme — normal session', () => {
  it('fresh user: surah 1, ayah 0, ayahPerDay 3 → memStart=1, memEnd=3', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ current_surah: 1, current_ayah: 0, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.currentSurah).toBe(1);
    expect(result.surahName).toBe('Al-Fatiha');
    expect(result.surahTotalAyats).toBe(7);
    expect(result.memStart).toBe(1);
    expect(result.memEnd).toBe(3);
    expect(result.todayAyatCount).toBe(3);
    expect(result.surahExhausted).toBe(false);
    expect(result.sessionFinishesSurah).toBe(false);
    expect(result.remainingAfterSession).toBe(4);
  });

  it('mid-surah: surah 1, ayah 3, ayahPerDay 3 → memStart=4, memEnd=6', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ current_surah: 1, current_ayah: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.memStart).toBe(4);
    expect(result.memEnd).toBe(6);
    expect(result.todayAyatCount).toBe(3);
    expect(result.remainingAfterSession).toBe(1);
  });
});

// ─── getTodayProgramme — session finishes surah ───────────────────────────────

describe('getTodayProgramme — session finishes surah', () => {
  it('memEnd caps at surahTotalAyats when session would exceed it', () => {
    // Surah 1 has 7 ayahs. current_ayah=5, ayahPerDay=3 → memStart=6, memEnd=min(8,7)=7
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ current_surah: 1, current_ayah: 5, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.memStart).toBe(6);
    expect(result.memEnd).toBe(7);
    expect(result.todayAyatCount).toBe(2);
    expect(result.sessionFinishesSurah).toBe(true);
    expect(result.remainingAfterSession).toBe(0);
  });

  it('sessionFinishesSurah is true when memEnd === surahTotalAyats', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ current_surah: 1, current_ayah: 6, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.memEnd).toBe(7);
    expect(result.sessionFinishesSurah).toBe(true);
  });
});

// ─── getTodayProgramme — surah exhausted ──────────────────────────────────────

describe('getTodayProgramme — surah exhausted', () => {
  it('surahExhausted=true when all ayahs are memorized', () => {
    // Surah 1 has 7 ayahs. current_ayah=7 means the surah is fully memorized.
    // The exact memStart/memEnd values in this state are internal and not
    // a business guarantee — consumers guard on surahExhausted and
    // todayAyatCount === 0 before using the ayah range.
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ current_surah: 1, current_ayah: 7, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.surahExhausted).toBe(true);
    expect(result.todayAyatCount).toBe(0);
    expect(result.sessionFinishesSurah).toBe(false);
    expect(result.nextSurah).toBe(114);
    expect(result.nextSurahName).toBe('An-Nas');
  });
});

// ─── getTodayProgramme — sessionDoneToday ─────────────────────────────────────

describe('getTodayProgramme — sessionDoneToday', () => {
  it('sessionDoneToday=true when last_session_date === today', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ last_session_date: TODAY }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.sessionDoneToday).toBe(true);
  });

  it('sessionDoneToday=false when last_session_date !== today', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ last_session_date: '2026-08-05' }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.sessionDoneToday).toBe(false);
  });

  it('sessionDoneToday=false when last_session_date is null', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ last_session_date: null }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.sessionDoneToday).toBe(false);
  });
});

// ─── getTodayProgramme — effectiveAyahPerDay cap ──────────────────────────────

describe('getTodayProgramme — effectiveAyahPerDay cap', () => {
  it('caps ayahPerDay to effectiveAyahPerDay when lower (free user → 1)', () => {
    const result = getTodayProgramme({
      plan: makePlan({ ayah_per_day: 3 }),
      progress: makeProgress({ current_surah: 1, current_ayah: 0, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
      effectiveAyahPerDay: 1,
    });
    expect(result.ayahPerDay).toBe(1);
    expect(result.memEnd).toBe(1);
    expect(result.todayAyatCount).toBe(1);
  });

  it('does not cap when effectiveAyahPerDay is higher than plan ayahPerDay', () => {
    const result = getTodayProgramme({
      plan: makePlan({ ayah_per_day: 3 }),
      progress: makeProgress({ current_surah: 1, current_ayah: 0, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
      effectiveAyahPerDay: 10,
    });
    expect(result.ayahPerDay).toBe(3);
    expect(result.memEnd).toBe(3);
  });

  it('uses plan ayahPerDay when effectiveAyahPerDay is omitted', () => {
    const result = getTodayProgramme({
      plan: makePlan({ ayah_per_day: 3 }),
      progress: makeProgress({ current_surah: 1, current_ayah: 0, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.ayahPerDay).toBe(3);
  });
});

// ─── getTodayProgramme — nextSurah transitions ────────────────────────────────

describe('getTodayProgramme — nextSurah transitions', () => {
  it('recommended mode: nextSurah uses nextZainlySurah', () => {
    // Surah 1 → next in ZAINLY_ORDER is surah 114
    const result = getTodayProgramme({
      plan: makePlan({ plan_mode: 'recommended' }),
      progress: makeProgress({ current_surah: 1, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBe(114);
    expect(result.nextSurahName).toBe('An-Nas');
  });

  it('recommended mode: last surah in order → nextSurah=null', () => {
    // Last surah in ZAINLY_ORDER is 77 (Al-Mursalat)
    const result = getTodayProgramme({
      plan: makePlan({ plan_mode: 'recommended' }),
      progress: makeProgress({ current_surah: 77, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBeNull();
    expect(result.nextSurahName).toBeNull();
  });

  it('custom_order mode: nextSurah uses nextSurahInOrder', () => {
    const result = getTodayProgramme({
      plan: makePlan({
        plan_mode: 'custom_order',
        custom_surah_order: [78, 1, 114],
      }),
      progress: makeProgress({ current_surah: 78, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBe(1);
    expect(result.nextSurahName).toBe('Al-Fatiha');
  });

  it('custom_order mode: last surah in custom order → nextSurah=null', () => {
    const result = getTodayProgramme({
      plan: makePlan({
        plan_mode: 'custom_order',
        custom_surah_order: [78, 1, 114],
      }),
      progress: makeProgress({ current_surah: 114, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBeNull();
  });

  it('start_surah mode with custom_surah_order: uses nextSurahInOrder', () => {
    const result = getTodayProgramme({
      plan: makePlan({
        plan_mode: 'start_surah',
        custom_surah_order: [78, 2, 3],
      }),
      progress: makeProgress({ current_surah: 78, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBe(2);
  });

  it('recommended mode with no custom_surah_order: uses nextZainlySurah even if custom_surah_order is null', () => {
    const result = getTodayProgramme({
      plan: makePlan({ plan_mode: 'recommended', custom_surah_order: null }),
      progress: makeProgress({ current_surah: 1, current_ayah: 0 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.nextSurah).toBe(114);
  });
});

// ─── getTodayProgramme — ayah range invariants ────────────────────────────────

describe('getTodayProgramme — ayah range invariants', () => {
  it('memEnd never exceeds surahTotalAyats', () => {
    // Test with a large ayahPerDay on a small surah
    for (const entry of ZAINLY_ORDER) {
      const result = getTodayProgramme({
        plan: makePlan({ ayah_per_day: 20 }),
        progress: makeProgress({ current_surah: entry.surah, current_ayah: 0, ayah_per_day: 20 }),
        dueReviewCount: 0,
        today: TODAY,
      });
      if (result.memEnd !== null) {
        expect(result.memEnd).toBeLessThanOrEqual(entry.ayahs);
      }
    }
  });

  it('memStart is always currentAyah + 1 when surah exists', () => {
    for (let ayah = 0; ayah < 10; ayah++) {
      const result = getTodayProgramme({
        plan: makePlan({ ayah_per_day: 3 }),
        progress: makeProgress({ current_surah: 1, current_ayah: ayah, ayah_per_day: 3 }),
        dueReviewCount: 0,
        today: TODAY,
      });
      expect(result.memStart).toBe(ayah + 1);
    }
  });

  it('todayAyatCount is always non-negative', () => {
    // Even when surah is exhausted
    const result = getTodayProgramme({
      plan: makePlan({ ayah_per_day: 3 }),
      progress: makeProgress({ current_surah: 1, current_ayah: 7, ayah_per_day: 3 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.todayAyatCount).toBeGreaterThanOrEqual(0);
  });

  it('no ayah duplication: memStart..memEnd is a contiguous unique range', () => {
    const result = getTodayProgramme({
      plan: makePlan({ ayah_per_day: 5 }),
      progress: makeProgress({ current_surah: 2, current_ayah: 10, ayah_per_day: 5 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    if (result.memStart !== null && result.memEnd !== null) {
      const ayahs: number[] = [];
      for (let a = result.memStart; a <= result.memEnd; a++) ayahs.push(a);
      expect(new Set(ayahs).size).toBe(ayahs.length);
      expect(ayahs.length).toBe(result.todayAyatCount);
    }
  });
});

// ─── getTodayProgramme — streak and totalMemorized ────────────────────────────

describe('getTodayProgramme — streak and totalMemorized', () => {
  it('passes through streak and totalMemorized from progress', () => {
    const result = getTodayProgramme({
      plan: makePlan(),
      progress: makeProgress({ streak: 7, total_memorized: 42 }),
      dueReviewCount: 0,
      today: TODAY,
    });
    expect(result.streak).toBe(7);
    expect(result.totalMemorized).toBe(42);
  });
});

// ─── nextSurahInOrder ─────────────────────────────────────────────────────────

describe('nextSurahInOrder', () => {
  it('returns the next surah in the given order', () => {
    expect(nextSurahInOrder(78, [78, 1, 114])).toBe(1);
    expect(nextSurahInOrder(1, [78, 1, 114])).toBe(114);
  });

  it('returns null for the last surah in the order', () => {
    expect(nextSurahInOrder(114, [78, 1, 114])).toBeNull();
  });

  it('returns null for a surah not in the order', () => {
    expect(nextSurahInOrder(99, [78, 1, 114])).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(nextSurahInOrder(78, [])).toBeNull();
  });

  it('returns null for a non-array input', () => {
    expect(nextSurahInOrder(78, null as unknown as number[])).toBeNull();
    expect(nextSurahInOrder(78, undefined as unknown as number[])).toBeNull();
  });
});
