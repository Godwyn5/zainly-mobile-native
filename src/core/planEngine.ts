// ─── Plan Engine — pure functions, no React, no Supabase ─────────────────────
// Ported faithfully from:
//   web: lib/zainlyOrder.js
//   web: app/api/generate-plan/route.js

import { ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH, type SurahEntry } from './zainlyOrder';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanMode = 'recommended' | 'start_surah' | 'custom_order';

export type { SurahEntry } from './zainlyOrder';

export interface PartialKnown {
  from: number;
  to:   number;
}

export interface PlanInput {
  userId:             string;
  planMode:           PlanMode;
  knownSurahs:        number[];          // surah numbers fully memorised
  partialKnownSurahs?: Record<number, PartialKnown>; // surahNum → {from,to}
  startingSurah?:     number | null;     // for start_surah mode
  customSurahOrder?:  number[];         // for custom_order mode
  continueWithRest?:  boolean;          // custom_order: append rest of Quran after selected
  ayahPerDay:         number;
  daysPerWeek?:       number;            // default 6
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
    selectedCustomCount: number;
    continueWithRest:    boolean;
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

// ─── Zainly pedagogical order (re-exported from zainlyOrder.ts) ──────────────
// The canonical source of truth for the surah order and index lives in
// ./zainlyOrder.ts.  Re-exported here for backward compatibility with
// existing imports from planEngine.

export { ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH } from './zainlyOrder';

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
    continueWithRest: continueWithRestRaw,
    ayahPerDay: ayahPerDayRaw,
    daysPerWeek = DAYS_PER_WEEK,
  } = input;

  const continueWithRest = planMode === 'custom_order'
    ? (continueWithRestRaw !== false)  // default true
    : false;

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
    // Validate + dedupe custom order (preserve user-specified order)
    const validCustom: number[] = [];
    for (const n of customSurahOrder) {
      const num = Math.round(n);
      if (!VALID_SURAH_NUMBERS.has(num)) {
        return { error: `Sourate invalide dans l'ordre personnalisé : ${n}` };
      }
      if (!validCustom.includes(num)) validCustom.push(num);
    }
    const validCustomSet = new Set(validCustom);

    // Selected surahs that are non-known → front of effectiveOrder
    const selectedNonKnown = validCustom.filter(num => {
      if (knownSet.has(num)) { skippedKnownSurahs.push(num); return false; }
      return true;
    });

    if (continueWithRest) {
      // Append all ZAINLY_ORDER surahs not already in validCustom and not known
      const appendedRest = ZAINLY_ORDER
        .filter(s => !validCustomSet.has(s.surah) && !knownSet.has(s.surah))
        .map(s => s.surah);
      const fullOrder = [...selectedNonKnown, ...appendedRest];

      if (fullOrder.length === 0) {
        return { error: 'Tu as indiqué maîtriser toutes les sourates disponibles.' };
      }
      effectiveOrder = fullOrder.map(num => ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[num]]);
    } else {
      if (selectedNonKnown.length === 0) {
        return { error: 'Toutes les sourates de ton ordre personnalisé sont marquées comme déjà maîtrisées.' };
      }
      effectiveOrder = selectedNonKnown.map(num => ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[num]]);
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

  // selectedCustomCount is meaningful only for custom_order
  const selectedCustomCount = planMode === 'custom_order'
    ? (Array.isArray(customSurahOrder) ? customSurahOrder.length : 0)
    : 0;

  return {
    planPayload,
    progressPayload,
    computed: {
      firstSurahNumber:    startSurah.surah,
      firstSurahName:      startSurah.name,
      startAyah,
      remainingAyats,
      estimatedMonths,
      estimatedYears,
      effectiveOrder,
      skippedKnownSurahs,
      paceLabel,
      estimateRange,
      selectedCustomCount,
      continueWithRest,
    },
  };
}

// ─── Navigation helper (re-exported from zainlyOrder.ts) ──────────────────────

export { nextZainlySurah } from './zainlyOrder';
