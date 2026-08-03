/// <reference types="jest" />
import {
  ZAINLY_ORDER,
  ZAINLY_INDEX_BY_SURAH,
  computePlan,
  isPlanError,
  nextZainlySurah,
  buildRealisticEstimate,
  type PlanInput,
} from '../planEngine';

// ─── ZAINLY_ORDER stability ─────────────────────────────────────────────────

describe('ZAINLY_ORDER', () => {
  it('has exactly 114 entries', () => {
    expect(ZAINLY_ORDER).toHaveLength(114);
  });

  it('contains every surah number from 1 to 114 exactly once', () => {
    const surahNumbers = ZAINLY_ORDER.map(s => s.surah);
    const unique = new Set(surahNumbers);
    expect(unique.size).toBe(114);
    for (let i = 1; i <= 114; i++) {
      expect(unique.has(i)).toBe(true);
    }
  });

  it('ZAINLY_INDEX_BY_SURAH maps every surah to its index', () => {
    for (let i = 0; i < ZAINLY_ORDER.length; i++) {
      expect(ZAINLY_INDEX_BY_SURAH[ZAINLY_ORDER[i].surah]).toBe(i);
    }
  });

  it('first entry is Al-Fatiha (surah 1, 7 ayahs)', () => {
    expect(ZAINLY_ORDER[0]).toEqual({ name: 'Al-Fatiha', surah: 1, ayahs: 7 });
  });

  it('second entry is An-Nas (surah 114, 6 ayahs)', () => {
    expect(ZAINLY_ORDER[1]).toEqual({ name: 'An-Nas', surah: 114, ayahs: 6 });
  });

  it('last entry is Al-Mursalat (surah 77, 50 ayahs)', () => {
    expect(ZAINLY_ORDER[ZAINLY_ORDER.length - 1]).toEqual({
      name: 'Al-Mursalat',
      surah: 77,
      ayahs: 50,
    });
  });

  it('every entry has positive ayah count', () => {
    for (const entry of ZAINLY_ORDER) {
      expect(entry.ayahs).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty name', () => {
    for (const entry of ZAINLY_ORDER) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  // ─── Exact pedagogical order fixture ───────────────────────────────────
  // This is the single most critical test in the suite: it guards against
  // any accidental reordering of ZAINLY_ORDER.  Length, uniqueness, and
  // boundary checks cannot detect a swap of two middle entries.  This
  // fixture is the canonical sequence copied from src/core/planEngine.ts
  // at audit time.  If the order ever changes intentionally, this fixture
  // must be updated deliberately.

  const EXPECTED_ZAINLY_ORDER: readonly { name: string; surah: number; ayahs: number }[] = [
    { name: 'Al-Fatiha',      surah: 1,   ayahs: 7   },
    { name: 'An-Nas',         surah: 114, ayahs: 6   },
    { name: 'Al-Falaq',       surah: 113, ayahs: 5   },
    { name: 'Al-Ikhlas',      surah: 112, ayahs: 4   },
    { name: 'Al-Masad',       surah: 111, ayahs: 5   },
    { name: 'An-Nasr',        surah: 110, ayahs: 3   },
    { name: 'Al-Kafirun',     surah: 109, ayahs: 6   },
    { name: 'Al-Kawthar',     surah: 108, ayahs: 3   },
    { name: 'Al-Maun',        surah: 107, ayahs: 7   },
    { name: 'Quraysh',        surah: 106, ayahs: 4   },
    { name: 'Al-Fil',         surah: 105, ayahs: 5   },
    { name: 'Al-Humaza',      surah: 104, ayahs: 9   },
    { name: 'Al-Asr',         surah: 103, ayahs: 3   },
    { name: 'At-Takathur',    surah: 102, ayahs: 8   },
    { name: 'Al-Qaria',       surah: 101, ayahs: 11  },
    { name: 'Al-Adiyat',      surah: 100, ayahs: 11  },
    { name: 'Az-Zalzala',     surah: 99,  ayahs: 8   },
    { name: 'Al-Bayyina',     surah: 98,  ayahs: 8   },
    { name: 'Al-Qadr',        surah: 97,  ayahs: 5   },
    { name: 'Al-Alaq',        surah: 96,  ayahs: 19  },
    { name: 'At-Tin',         surah: 95,  ayahs: 8   },
    { name: 'Ash-Sharh',      surah: 94,  ayahs: 8   },
    { name: 'Ad-Duha',        surah: 93,  ayahs: 11  },
    { name: 'Al-Layl',        surah: 92,  ayahs: 21  },
    { name: 'Ash-Shams',      surah: 91,  ayahs: 15  },
    { name: 'Al-Balad',       surah: 90,  ayahs: 20  },
    { name: 'Al-Fajr',        surah: 89,  ayahs: 30  },
    { name: 'Al-Ghashiya',    surah: 88,  ayahs: 26  },
    { name: 'Al-Ala',         surah: 87,  ayahs: 19  },
    { name: 'At-Tariq',       surah: 86,  ayahs: 17  },
    { name: 'Al-Buruj',       surah: 85,  ayahs: 22  },
    { name: 'Al-Inshiqaq',    surah: 84,  ayahs: 25  },
    { name: 'Al-Mutaffifin',  surah: 83,  ayahs: 36  },
    { name: 'Al-Infitar',     surah: 82,  ayahs: 19  },
    { name: 'At-Takwir',      surah: 81,  ayahs: 29  },
    { name: 'Abasa',          surah: 80,  ayahs: 42  },
    { name: 'An-Naziat',      surah: 79,  ayahs: 46  },
    { name: 'An-Naba',        surah: 78,  ayahs: 40  },
    { name: 'Al-Baqara',      surah: 2,   ayahs: 286 },
    { name: 'Al-Imran',       surah: 3,   ayahs: 200 },
    { name: 'An-Nisa',        surah: 4,   ayahs: 176 },
    { name: 'Al-Maida',       surah: 5,   ayahs: 120 },
    { name: 'Al-Anam',        surah: 6,   ayahs: 165 },
    { name: 'Al-Araf',        surah: 7,   ayahs: 206 },
    { name: 'Al-Anfal',       surah: 8,   ayahs: 75  },
    { name: 'At-Tawba',       surah: 9,   ayahs: 129 },
    { name: 'Yunus',          surah: 10,  ayahs: 109 },
    { name: 'Hud',            surah: 11,  ayahs: 123 },
    { name: 'Yusuf',          surah: 12,  ayahs: 111 },
    { name: 'Ar-Rad',         surah: 13,  ayahs: 43  },
    { name: 'Ibrahim',        surah: 14,  ayahs: 52  },
    { name: 'Al-Hijr',        surah: 15,  ayahs: 99  },
    { name: 'An-Nahl',        surah: 16,  ayahs: 128 },
    { name: 'Al-Isra',        surah: 17,  ayahs: 111 },
    { name: 'Al-Kahf',        surah: 18,  ayahs: 110 },
    { name: 'Maryam',         surah: 19,  ayahs: 98  },
    { name: 'Ta-Ha',          surah: 20,  ayahs: 135 },
    { name: 'Al-Anbiya',      surah: 21,  ayahs: 112 },
    { name: 'Al-Hajj',        surah: 22,  ayahs: 78  },
    { name: 'Al-Muminun',     surah: 23,  ayahs: 118 },
    { name: 'An-Nur',         surah: 24,  ayahs: 64  },
    { name: 'Al-Furqan',      surah: 25,  ayahs: 77  },
    { name: 'Ash-Shuara',     surah: 26,  ayahs: 227 },
    { name: 'An-Naml',        surah: 27,  ayahs: 93  },
    { name: 'Al-Qasas',       surah: 28,  ayahs: 88  },
    { name: 'Al-Ankabut',     surah: 29,  ayahs: 69  },
    { name: 'Ar-Rum',         surah: 30,  ayahs: 60  },
    { name: 'Luqman',         surah: 31,  ayahs: 34  },
    { name: 'As-Sajda',       surah: 32,  ayahs: 30  },
    { name: 'Al-Ahzab',       surah: 33,  ayahs: 73  },
    { name: 'Saba',           surah: 34,  ayahs: 54  },
    { name: 'Fatir',          surah: 35,  ayahs: 45  },
    { name: 'Ya-Sin',         surah: 36,  ayahs: 83  },
    { name: 'As-Saffat',      surah: 37,  ayahs: 182 },
    { name: 'Sad',            surah: 38,  ayahs: 88  },
    { name: 'Az-Zumar',       surah: 39,  ayahs: 75  },
    { name: 'Ghafir',         surah: 40,  ayahs: 85  },
    { name: 'Fussilat',       surah: 41,  ayahs: 54  },
    { name: 'Ash-Shura',      surah: 42,  ayahs: 53  },
    { name: 'Az-Zukhruf',     surah: 43,  ayahs: 89  },
    { name: 'Ad-Dukhan',      surah: 44,  ayahs: 59  },
    { name: 'Al-Jathiya',     surah: 45,  ayahs: 37  },
    { name: 'Al-Ahqaf',       surah: 46,  ayahs: 35  },
    { name: 'Muhammad',       surah: 47,  ayahs: 38  },
    { name: 'Al-Fath',        surah: 48,  ayahs: 29  },
    { name: 'Al-Hujurat',     surah: 49,  ayahs: 18  },
    { name: 'Qaf',            surah: 50,  ayahs: 45  },
    { name: 'Adh-Dhariyat',   surah: 51,  ayahs: 60  },
    { name: 'At-Tur',         surah: 52,  ayahs: 49  },
    { name: 'An-Najm',        surah: 53,  ayahs: 62  },
    { name: 'Al-Qamar',       surah: 54,  ayahs: 55  },
    { name: 'Ar-Rahman',      surah: 55,  ayahs: 78  },
    { name: 'Al-Waqia',       surah: 56,  ayahs: 96  },
    { name: 'Al-Hadid',       surah: 57,  ayahs: 29  },
    { name: 'Al-Mujadila',    surah: 58,  ayahs: 22  },
    { name: 'Al-Hashr',       surah: 59,  ayahs: 24  },
    { name: 'Al-Mumtahana',   surah: 60,  ayahs: 13  },
    { name: 'As-Saf',         surah: 61,  ayahs: 14  },
    { name: 'Al-Jumua',       surah: 62,  ayahs: 11  },
    { name: 'Al-Munafiqun',   surah: 63,  ayahs: 11  },
    { name: 'At-Taghabun',    surah: 64,  ayahs: 18  },
    { name: 'At-Talaq',       surah: 65,  ayahs: 12  },
    { name: 'At-Tahrim',      surah: 66,  ayahs: 12  },
    { name: 'Al-Mulk',        surah: 67,  ayahs: 30  },
    { name: 'Al-Qalam',       surah: 68,  ayahs: 52  },
    { name: 'Al-Haqqa',       surah: 69,  ayahs: 52  },
    { name: 'Al-Maarij',      surah: 70,  ayahs: 44  },
    { name: 'Nuh',            surah: 71,  ayahs: 28  },
    { name: 'Al-Jinn',        surah: 72,  ayahs: 28  },
    { name: 'Al-Muzzammil',   surah: 73,  ayahs: 20  },
    { name: 'Al-Muddaththir', surah: 74,  ayahs: 56  },
    { name: 'Al-Qiyama',      surah: 75,  ayahs: 40  },
    { name: 'Al-Insan',       surah: 76,  ayahs: 31  },
    { name: 'Al-Mursalat',    surah: 77,  ayahs: 50  },
  ];

  it('matches the exact expected pedagogical order (full sequence)', () => {
    expect(ZAINLY_ORDER).toEqual(EXPECTED_ZAINLY_ORDER);
  });
});

// ─── nextZainlySurah ────────────────────────────────────────────────────────

describe('nextZainlySurah', () => {
  it('returns the next surah in ZAINLY_ORDER for surah 1 (Al-Fatiha)', () => {
    expect(nextZainlySurah(1)).toBe(114);
  });

  it('returns null for the last surah in order (77 — Al-Mursalat)', () => {
    expect(nextZainlySurah(77)).toBeNull();
  });

  it('returns null for an invalid surah number', () => {
    expect(nextZainlySurah(999)).toBeNull();
  });

  it('returns null for surah 0', () => {
    expect(nextZainlySurah(0)).toBeNull();
  });
});

// ─── computePlan — recommended mode ─────────────────────────────────────────

describe('computePlan — recommended mode', () => {
  const baseInput: PlanInput = {
    userId: 'test-user',
    planMode: 'recommended',
    knownSurahs: [],
    ayahPerDay: 3,
  };

  it('produces a valid plan for a fresh user with no known surahs', () => {
    const result = computePlan(baseInput);
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.planPayload.surah_start).toBe(1);
      expect(result.planPayload.start_ayah).toBe(1);
      expect(result.planPayload.first_surah_name).toBe('Al-Fatiha');
      expect(result.progressPayload.current_surah).toBe(1);
      expect(result.progressPayload.current_ayah).toBe(0);
    }
  });

  it('is deterministic — same input yields same output', () => {
    const r1 = computePlan(baseInput);
    const r2 = computePlan(baseInput);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('skips known surahs and starts at the first unknown', () => {
    const result = computePlan({
      ...baseInput,
      knownSurahs: [1, 114, 113, 112, 111, 110],
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.planPayload.surah_start).toBe(109);
      expect(result.planPayload.first_surah_name).toBe('Al-Kafirun');
      expect(result.planPayload.known_surahs).toContain(1);
      expect(result.planPayload.known_surahs).toContain(114);
    }
  });

  it('returns an error when all surahs are known', () => {
    const allSurahs = ZAINLY_ORDER.map(s => s.surah);
    const result = computePlan({
      ...baseInput,
      knownSurahs: allSurahs,
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('handles partial known surahs (start at to+1)', () => {
    const result = computePlan({
      ...baseInput,
      partialKnownSurahs: { 1: { from: 1, to: 3 } },
    });
    expect(isPlanError(result)).toBe(false);
    if (!isError(result)) {
      expect(result!.planPayload.start_ayah).toBe(4);
      expect(result!.planPayload.surah_start).toBe(1);
    }
  });

  it('promotes partial known to fully known when to >= ayahs', () => {
    const result = computePlan({
      ...baseInput,
      partialKnownSurahs: { 1: { from: 1, to: 7 } },
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.planPayload.known_surahs).toContain(1);
      expect(result.planPayload.surah_start).not.toBe(1);
    }
  });
});

// ─── computePlan — start_surah mode ─────────────────────────────────────────

describe('computePlan — start_surah mode', () => {
  const baseInput: PlanInput = {
    userId: 'test-user',
    planMode: 'start_surah',
    knownSurahs: [],
    startingSurah: 78,
    ayahPerDay: 3,
  };

  it('places the chosen surah first in effectiveOrder', () => {
    const result = computePlan(baseInput);
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.firstSurahNumber).toBe(78);
      expect(result.computed.effectiveOrder[0].surah).toBe(78);
    }
  });

  it('returns error for an invalid starting surah', () => {
    const result = computePlan({
      ...baseInput,
      startingSurah: 999,
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('skips the chosen surah if it is in knownSurahs', () => {
    const result = computePlan({
      ...baseInput,
      knownSurahs: [78],
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.firstSurahNumber).not.toBe(78);
      expect(result.computed.skippedKnownSurahs).toContain(78);
    }
  });
});

// ─── computePlan — custom_order mode ────────────────────────────────────────

describe('computePlan — custom_order mode', () => {
  const baseInput: PlanInput = {
    userId: 'test-user',
    planMode: 'custom_order',
    knownSurahs: [],
    customSurahOrder: [78, 1, 114],
    continueWithRest: true,
    ayahPerDay: 3,
  };

  it('respects the user-specified order', () => {
    const result = computePlan(baseInput);
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.effectiveOrder[0].surah).toBe(78);
      expect(result.computed.effectiveOrder[1].surah).toBe(1);
      expect(result.computed.effectiveOrder[2].surah).toBe(114);
    }
  });

  it('appends the rest of ZAINLY_ORDER when continueWithRest is true', () => {
    const result = computePlan(baseInput);
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.effectiveOrder.length).toBeGreaterThan(3);
      expect(result.computed.continueWithRest).toBe(true);
    }
  });

  it('does NOT append the rest when continueWithRest is false', () => {
    const result = computePlan({
      ...baseInput,
      continueWithRest: false,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.effectiveOrder.length).toBe(3);
      expect(result.computed.continueWithRest).toBe(false);
    }
  });

  it('deduplicates customSurahOrder', () => {
    const result = computePlan({
      ...baseInput,
      customSurahOrder: [78, 78, 1, 1, 114],
      continueWithRest: false,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.effectiveOrder.length).toBe(3);
    }
  });

  it('returns error for empty customSurahOrder', () => {
    const result = computePlan({
      ...baseInput,
      customSurahOrder: [],
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('returns error for invalid surah in customSurahOrder', () => {
    const result = computePlan({
      ...baseInput,
      customSurahOrder: [78, 999],
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('skips known surahs from custom order', () => {
    const result = computePlan({
      ...baseInput,
      knownSurahs: [78],
      continueWithRest: false,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.computed.effectiveOrder[0].surah).toBe(1);
      expect(result.computed.skippedKnownSurahs).toContain(78);
    }
  });
});

// ─── computePlan — validation ───────────────────────────────────────────────

describe('computePlan — validation', () => {
  it('returns error for missing userId', () => {
    const result = computePlan({
      userId: '',
      planMode: 'recommended',
      knownSurahs: [],
      ayahPerDay: 3,
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('returns error for invalid planMode', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'invalid' as never,
      knownSurahs: [],
      ayahPerDay: 3,
    });
    expect(isPlanError(result)).toBe(true);
  });

  it('clamps ayahPerDay to max 20', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'recommended',
      knownSurahs: [],
      ayahPerDay: 100,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.planPayload.ayah_per_day).toBe(20);
    }
  });

  it('clamps ayahPerDay to min 1', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'recommended',
      knownSurahs: [],
      ayahPerDay: 0,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      expect(result.planPayload.ayah_per_day).toBe(1);
    }
  });
});

// ─── computePlan — no duplicates in effectiveOrder ──────────────────────────

describe('computePlan — no duplicates in effectiveOrder', () => {
  it('recommended mode: no duplicate surahs', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'recommended',
      knownSurahs: [1, 114],
      ayahPerDay: 3,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      const surahs = result.computed.effectiveOrder.map(s => s.surah);
      expect(new Set(surahs).size).toBe(surahs.length);
    }
  });

  it('start_surah mode: no duplicate surahs', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'start_surah',
      knownSurahs: [1],
      startingSurah: 78,
      ayahPerDay: 3,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      const surahs = result.computed.effectiveOrder.map(s => s.surah);
      expect(new Set(surahs).size).toBe(surahs.length);
    }
  });

  it('custom_order mode with continueWithRest: no duplicate surahs', () => {
    const result = computePlan({
      userId: 'test',
      planMode: 'custom_order',
      knownSurahs: [],
      customSurahOrder: [78, 1, 114],
      continueWithRest: true,
      ayahPerDay: 3,
    });
    expect(isPlanError(result)).toBe(false);
    if (!isPlanError(result)) {
      const surahs = result.computed.effectiveOrder.map(s => s.surah);
      expect(new Set(surahs).size).toBe(surahs.length);
    }
  });
});

// ─── buildRealisticEstimate ─────────────────────────────────────────────────

describe('buildRealisticEstimate', () => {
  it('returns null for zero remaining ayats', () => {
    expect(buildRealisticEstimate({ remainingAyats: 0, ayahPerDay: 3, daysPerWeek: 6 })).toBeNull();
  });

  it('returns null for negative remaining ayats', () => {
    expect(buildRealisticEstimate({ remainingAyats: -10, ayahPerDay: 3, daysPerWeek: 6 })).toBeNull();
  });

  it('returns a valid estimate for normal input', () => {
    const est = buildRealisticEstimate({ remainingAyats: 1000, ayahPerDay: 3, daysPerWeek: 6 });
    expect(est).not.toBeNull();
    if (est) {
      expect(est.minDays).toBeGreaterThan(0);
      expect(est.maxDays).toBeGreaterThanOrEqual(est.minDays);
      expect(est.label.length).toBeGreaterThan(0);
    }
  });

  it('uses days unit for small remaining ayats', () => {
    const est = buildRealisticEstimate({ remainingAyats: 10, ayahPerDay: 3, daysPerWeek: 6 });
    expect(est).not.toBeNull();
    if (est) {
      expect(est.unit).toBe('days');
    }
  });

  it('uses years unit for very large remaining ayats', () => {
    const est = buildRealisticEstimate({ remainingAyats: 60000, ayahPerDay: 1, daysPerWeek: 1 });
    expect(est).not.toBeNull();
    if (est) {
      expect(est.unit).toBe('years');
    }
  });
});

// ─── Helper to avoid type narrowing repetition ──────────────────────────────

function isError(r: ReturnType<typeof computePlan>): r is { error: string } {
  return 'error' in r;
}
