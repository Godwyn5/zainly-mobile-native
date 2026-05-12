// ─── Plan Engine — pure functions, no React, no Supabase ─────────────────────
// Ported faithfully from:
//   web: lib/zainlyOrder.js
//   web: app/api/generate-plan/route.js

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanMode = 'recommended' | 'start_surah' | 'custom_order';

export interface SurahEntry {
  name:  string;
  surah: number;
  ayahs: number;
}

export interface PartialKnown {
  from: number;
  to:   number;
}

export interface PlanInput {
  userId:           string;
  planMode:         PlanMode;
  knownSurahs:      number[];          // surah numbers fully memorised
  partialKnownSurahs?: Record<number, PartialKnown>; // surahNum → {from,to}
  startingSurah?:   number | null;     // for start_surah mode
  customSurahOrder?: number[];         // for custom_order mode
  ayahPerDay:       number;
  daysPerWeek?:     number;            // default 6
}

// ─── Estimate types ─────────────────────────────────────────────────────────────

export type EstimateUnit = 'days' | 'weeks' | 'months' | 'years';

export interface EstimateRange {
  minDays:                  number;
  maxDays:                  number;
  minWeeks:                 number;
  maxWeeks:                 number;
  minMonths:                number;
  maxMonths:                number;
  minYears:                 number;
  maxYears:                 number;
  unit:                     EstimateUnit;
  label:                    string;
  helper:                   string;
  rawCalendarDays:          number;
  realisticCalendarDays:    number;
  reviewBufferMultiplier:   number;
}

export interface PlanResult {
  planPayload:         PlanPayload;
  progressPayload:     ProgressPayload;
  computed: {
    firstSurahNumber:    number;
    firstSurahName:      string;
    startAyah:           number;
    remainingAyats:      number;
    estimatedMonths:     number;
    estimatedYears:      string;
    effectiveOrder:      SurahEntry[];
    skippedKnownSurahs:  number[];
    paceLabel:           string;
    estimateRange:       EstimateRange | null;
  };
}

export interface PlanPayload {
  ayah_per_day:               number;
  days_per_week:              number;
  first_surah_name:           string;
  surah_start:                number;
  start_ayah:                 number;
  remaining_ayats:            number;
  estimated_months:           number;
  plan_mode:                  PlanMode;
  known_surahs:               number[];
  starting_surah:             number | null;
  custom_surah_order:         number[];
  pace_type:                  'ayahs';
  pace_label:                 string;
  pedagogical_order_version:  string;
  partial_known_surahs:       Record<number, PartialKnown>;
}

export interface ProgressPayload {
  current_surah: number;
  current_ayah:  number;
  ayah_per_day:  number;
}

export interface PlanValidationError {
  error: string;
}

export type PlanEngineResult = PlanResult | PlanValidationError;

export function isPlanError(r: PlanEngineResult): r is PlanValidationError {
  return 'error' in r;
}

// ─── buildRealisticEstimate ──────────────────────────────────────────────────────────────
export function buildRealisticEstimate({
  remainingAyats,
  ayahPerDay,
  daysPerWeek,
}: {
  remainingAyats: number;
  ayahPerDay:     number;
  daysPerWeek:    number;
}): EstimateRange | null {
  const safeAyahs = Math.max(1, Math.round(ayahPerDay) || 1);
  const safeDays  = Math.min(7, Math.max(1, daysPerWeek));

  if (!remainingAyats || remainingAyats <= 0 || !isFinite(remainingAyats)) return null;

  // Step 1: active memorization days
  const activeMemorizationDays = Math.ceil(remainingAyats / safeAyahs);

  // Step 2: raw calendar days (accounts for rest days per week)
  const rawCalendarDays = Math.ceil(activeMemorizationDays * (7 / safeDays));

  // Step 3: review/life buffer multiplier
  let reviewBufferMultiplier: number;
  if (safeAyahs <= 2)                          reviewBufferMultiplier = 1.10;
  else if (safeAyahs === 3)                    reviewBufferMultiplier = 1.15;
  else if (safeAyahs >= 4 && safeAyahs <= 6)   reviewBufferMultiplier = 1.22;
  else                                          reviewBufferMultiplier = 1.30;

  // Step 4: realistic (buffered) calendar days
  const realisticCalendarDays = Math.ceil(rawCalendarDays * reviewBufferMultiplier);

  const minDays = rawCalendarDays;
  const maxDays = realisticCalendarDays;

  // Step 5: derive weeks, months, and years
  const minWeeks  = Math.ceil(minDays / 7);
  const maxWeeks  = Math.ceil(maxDays / 7);
  const minMonths = Math.max(1, Math.ceil(minDays / 30.44));
  const maxMonths = Math.max(1, Math.ceil(maxDays / 30.44));
  const minYears  = Math.round((minMonths / 12) * 10) / 10;  // one decimal, e.g. 10.5
  const maxYears  = Math.round((maxMonths / 12) * 10) / 10;

  // Step 6: choose display unit
  let unit: EstimateUnit;
  let label: string;

  if (maxDays < 14) {
    unit = 'days';
    if (minDays === 1 && maxDays === 1) {
      label = '~1 jour';
    } else if (minDays === maxDays) {
      label = `~${minDays} jours`;
    } else {
      label = `~${minDays}–${maxDays} jours`;
    }
  } else if (maxDays < 90) {
    unit = 'weeks';
    if (minWeeks === maxWeeks) {
      label = `~${minWeeks} semaine${minWeeks > 1 ? 's' : ''}`;
    } else {
      label = `~${minWeeks}–${maxWeeks} semaines`;
    }
  } else if (maxMonths < 36) {
    unit = 'months';
    if (minMonths === maxMonths) {
      label = `~${minMonths} mois`;
    } else {
      label = `~${minMonths}–${maxMonths} mois`;
    }
  } else {
    unit = 'years';
    const fmtYear = (y: number) => Number.isInteger(y) ? `${y}` : y.toFixed(1);
    if (minYears === maxYears) {
      label = `~${fmtYear(minYears)} an${minYears > 1 ? 's' : ''}`;
    } else {
      label = `~${fmtYear(minYears)}–${fmtYear(maxYears)} ans`;
    }
  }

  const helper = `Basé sur ${safeAyahs} ayat${safeAyahs > 1 ? 's' : ''}/jour, ${safeDays} jours/semaine.`;

  return {
    minDays, maxDays,
    minWeeks, maxWeeks,
    minMonths, maxMonths,
    minYears, maxYears,
    unit, label, helper,
    rawCalendarDays,
    realisticCalendarDays,
    reviewBufferMultiplier,
  };
}

// ─── Zainly pedagogical order (single source of truth) ───────────────────────
// Ported from web lib/zainlyOrder.js verbatim

export const ZAINLY_ORDER: SurahEntry[] = [
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

// O(1) lookup: surah number → index in ZAINLY_ORDER
export const ZAINLY_INDEX_BY_SURAH: Record<number, number> = Object.fromEntries(
  ZAINLY_ORDER.map((s, i) => [s.surah, i])
);

const VALID_SURAH_NUMBERS = new Set(ZAINLY_ORDER.map(s => s.surah));

// ─── Constants (mirrors web exactly) ─────────────────────────────────────────
const DAYS_PER_WEEK = 6;
const MAX_AYAH_DAY  = 20;
export const PEDAGOGICAL_ORDER_VERSION = 'v1';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getStartAyahForSurah(surahNum: number, partialMap: Record<number, PartialKnown>): number {
  const p = partialMap[surahNum];
  return p ? p.to + 1 : 1;
}

function computeStartFromKnown(
  knownSet: Set<number>,
  partialMap: Record<number, PartialKnown>
): { startPosition: number; startAyah: number; knownAyats: number } {
  let startPosition = 0;
  let knownAyats    = 0;

  for (let i = 0; i < ZAINLY_ORDER.length; i++) {
    const s = ZAINLY_ORDER[i];
    if (knownSet.has(s.surah)) {
      knownAyats   += s.ayahs;
      startPosition = i + 1;
    } else if (partialMap[s.surah]) {
      const { to } = partialMap[s.surah];
      knownAyats   += to;
      startPosition = i;
      return { startPosition, startAyah: to + 1, knownAyats };
    } else {
      startPosition = i;
      break;
    }
  }
  return { startPosition, startAyah: 1, knownAyats };
}

function buildKnownSet(
  knownSurahsRaw: number[],
  partialMapOut: Record<number, PartialKnown>,
  partialKnownRaw?: Record<number, PartialKnown>
): Set<number> {
  const knownSet = new Set<number>();

  for (const n of knownSurahsRaw) {
    if (VALID_SURAH_NUMBERS.has(n)) knownSet.add(n);
  }

  if (partialKnownRaw) {
    for (const [keyStr, val] of Object.entries(partialKnownRaw)) {
      const num = Number(keyStr);
      if (!VALID_SURAH_NUMBERS.has(num) || !val || typeof val.to !== 'number') continue;
      const surahAyahs = ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[num]]?.ayahs;
      if (surahAyahs && val.to >= surahAyahs) {
        knownSet.add(num);
        continue;
      }
      if (knownSet.has(num)) continue;
      partialMapOut[num] = { from: 1, to: val.to };
    }
  }

  return knownSet;
}

// ─── Public: computePlan ──────────────────────────────────────────────────────

export function computePlan(input: PlanInput): PlanEngineResult {
  const {
    userId,
    planMode,
    knownSurahs,
    partialKnownSurahs,
    startingSurah,
    customSurahOrder,
    ayahPerDay: ayahPerDayRaw,
    daysPerWeek = DAYS_PER_WEEK,
  } = input;

  // ── Validate basics ──
  if (!userId) return { error: 'Utilisateur non identifié.' };

  const ayahPerDay = Math.min(MAX_AYAH_DAY, Math.max(1, Math.round(ayahPerDayRaw) || 1));
  if (!Number.isFinite(ayahPerDay) || ayahPerDay < 1) {
    return { error: 'Rythme invalide.' };
  }
  const effectiveDays = Math.min(7, Math.max(1, daysPerWeek));

  // ── Build known sets ──
  const partialMap: Record<number, PartialKnown> = {};
  const knownSet = buildKnownSet(knownSurahs ?? [], partialMap, partialKnownSurahs);
  const knownSurahsArray = [...knownSet];
  const skippedKnownSurahs: number[] = [];

  // ── Mode-specific logic ──
  let startAyah      = 1;
  let effectiveOrder: SurahEntry[] = [];

  if (planMode === 'recommended') {
    // effectiveOrder = ZAINLY_ORDER minus known surahs
    effectiveOrder = ZAINLY_ORDER.filter(s => !knownSet.has(s.surah));
    if (effectiveOrder.length === 0) {
      return { error: 'Tu as indiqué maîtriser toutes les sourates disponibles. Choisis au moins une sourate à travailler.' };
    }
    // Handle partial: if first entry has a partial, startAyah = to+1
    startAyah = getStartAyahForSurah(effectiveOrder[0].surah, partialMap);

  } else if (planMode === 'start_surah') {
    const ss = startingSurah != null ? Math.round(startingSurah) : NaN;
    if (!VALID_SURAH_NUMBERS.has(ss)) {
      return { error: 'Sourate de départ invalide ou absente du parcours Zainly.' };
    }
    // Build order: chosen surah first, then remaining ZAINLY_ORDER (excluding chosen)
    // Then filter known surahs — if chosen is known, it is skipped (not a hard error)
    const startIdx = ZAINLY_INDEX_BY_SURAH[ss];
    const fullOrder = [ZAINLY_ORDER[startIdx], ...ZAINLY_ORDER.filter(s => s.surah !== ss)];
    effectiveOrder = fullOrder.filter(s => {
      if (knownSet.has(s.surah)) { skippedKnownSurahs.push(s.surah); return false; }
      return true;
    });
    // Dedupe skippedKnownSurahs (same surah can't appear twice but be safe)
    const skippedSet = new Set(skippedKnownSurahs);
    skippedKnownSurahs.length = 0;
    skippedSet.forEach(n => skippedKnownSurahs.push(n));

    if (effectiveOrder.length === 0) {
      return { error: 'Tu as indiqué maîtriser toutes les sourates disponibles. Choisis au moins une sourate à travailler.' };
    }
    startAyah = getStartAyahForSurah(effectiveOrder[0].surah, partialMap);

  } else if (planMode === 'custom_order') {
    if (!Array.isArray(customSurahOrder) || customSurahOrder.length === 0) {
      return { error: 'Choisis au moins une sourate pour créer ton programme.' };
    }
    // Validate + dedupe custom order
    const validCustom: number[] = [];
    for (const n of customSurahOrder) {
      const num = Math.round(n);
      if (!VALID_SURAH_NUMBERS.has(num)) {
        return { error: `Sourate invalide dans l'ordre personnalisé : ${n}` };
      }
      if (!validCustom.includes(num)) validCustom.push(num);
    }
    // Filter known surahs — skip them instead of hard-erroring
    effectiveOrder = validCustom
      .filter(num => {
        if (knownSet.has(num)) { skippedKnownSurahs.push(num); return false; }
        return true;
      })
      .map(num => ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[num]]);

    if (effectiveOrder.length === 0) {
      return { error: 'Toutes les sourates de ton ordre personnalisé sont marquées comme déjà maîtrisées. Ajoutes-en d\'autres ou ajuste tes acquis.' };
    }
    startAyah = getStartAyahForSurah(effectiveOrder[0].surah, partialMap);

  } else {
    return { error: 'Mode de plan invalide.' };
  }

  const startSurah = effectiveOrder[0];

  // ── Remaining ayats & estimates (mirrors web) ──
  const effectiveTotal  = effectiveOrder.reduce((sum, s) => sum + s.ayahs, 0);
  const remainingAyats  = Math.max(0, effectiveTotal);
  const weeklyAyats     = ayahPerDay * effectiveDays;
  const estimatedWeeks  = weeklyAyats > 0 ? Math.ceil(remainingAyats / weeklyAyats) : 9999;
  const estimatedMonths = Math.round(estimatedWeeks / 4.33);
  const estimatedYears  = (estimatedMonths / 12).toFixed(1);

  const estimateRange = buildRealisticEstimate({
    remainingAyats,
    ayahPerDay,
    daysPerWeek: effectiveDays,
  });

  const paceLabel = `${ayahPerDay} ayat${ayahPerDay > 1 ? 's' : ''} / jour`;

  // ── Build payloads (fields mirror web planPayload exactly) ──
  const planPayload: PlanPayload = {
    ayah_per_day:               ayahPerDay,
    days_per_week:              effectiveDays,
    first_surah_name:           startSurah.name,
    surah_start:                startSurah.surah,
    start_ayah:                 startAyah,
    remaining_ayats:            remainingAyats,
    estimated_months:           estimateRange ? Math.max(1, estimateRange.maxMonths) : Math.max(1, estimatedMonths),
    plan_mode:                  planMode,
    known_surahs:               knownSurahsArray,
    starting_surah:             planMode === 'start_surah' ? (startingSurah ?? null) : null,
    custom_surah_order:         (planMode === 'custom_order' || planMode === 'start_surah')
                                  ? effectiveOrder.map(s => s.surah)
                                  : [],
    pace_type:                  'ayahs',
    pace_label:                 paceLabel,
    pedagogical_order_version:  PEDAGOGICAL_ORDER_VERSION,
    partial_known_surahs:       partialMap,
  };

  const progressPayload: ProgressPayload = {
    current_surah: startSurah.surah,
    current_ayah:  startAyah - 1,
    ayah_per_day:  ayahPerDay,
  };

  return {
    planPayload,
    progressPayload,
    computed: {
      firstSurahNumber:   startSurah.surah,
      firstSurahName:     startSurah.name,
      startAyah,
      remainingAyats,
      estimatedMonths,
      estimatedYears,
      effectiveOrder,
      skippedKnownSurahs,
      paceLabel,
      estimateRange,
    },
  };
}

// ─── Navigation helper (used by session engine) ───────────────────────────────

export function nextZainlySurah(currentSurahNumber: number): number | null {
  const idx = ZAINLY_INDEX_BY_SURAH[currentSurahNumber];
  if (idx == null) return null;
  const nextIdx = idx + 1;
  if (nextIdx >= ZAINLY_ORDER.length) return null;
  return ZAINLY_ORDER[nextIdx].surah;
}

export function nextSurahInOrder(currentSurahNumber: number, orderArray: number[]): number | null {
  if (!Array.isArray(orderArray) || orderArray.length === 0) return null;
  const idx = orderArray.indexOf(currentSurahNumber);
  if (idx === -1) return null;
  const nextIdx = idx + 1;
  if (nextIdx >= orderArray.length) return null;
  return orderArray[nextIdx];
}
