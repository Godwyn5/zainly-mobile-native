// ─── hifzProgressMetrics — pure TypeScript, no React, no Supabase ────────────
//
// Long-term-safe Hifz progress computation.
//
// Design goal:
//   Combine known-before-Zainly ayats and learned-with-Zainly ayats using
//   exact ayat-key set union. This avoids double-counting regardless of future
//   plan edits, resets, surah changes, or re-learning declared-known surahs.
//
// Double-counting is avoided by ayat-key set union when exact learned items
// are available. Count addition is never used for the combined total.
//
// If exact learned-with-Zainly items are unavailable, canShowTrackedTotal is
// false and only the fallback count (total_memorized) is exposed for display.

import { ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH, type PartialKnown } from '@/core/planEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Canonical identity for a single ayat: "surahNumber:ayahNumber" */
export type AyatKey = `${number}:${number}`;

export type HifzProgressMetrics = {
  /** Ayats declared known before Zainly (from plan known_surahs + partial_known_surahs). */
  knownBeforeAyats: number;
  /**
   * Ayats learned through Zainly sessions.
   * When learnedExactDataAvailable && learnedExactDataConsistent: exact set size.
   * Otherwise: fallbackTotalMemorized (from progress.total_memorized).
   */
  learnedWithZainlyAyats: number;
  /**
   * Size of union(knownBeforeSet, learnedWithZainlySet).
   * Only meaningful when canShowTrackedTotal is true.
   */
  trackedHifzAyats: number;
  quranTotalAyats: number;
  /**
   * True only when exact learned items are both available AND consistent with
   * fallbackTotalMemorized. False when falling back to count-only mode.
   * Never show a combined total when this is false.
   */
  canShowTrackedTotal: boolean;
  /** True if exact learned items were present (learnedItems was an array). */
  learnedExactDataAvailable: boolean;
  /**
   * True if learnedSet.size >= fallbackTotalMemorized (exact data covers all
   * ayats counted by progress.total_memorized).
   * False signals a historical gap: total_memorized was incremented in a session
   * where review_items creation failed or had not yet been introduced.
   */
  learnedExactDataConsistent: boolean;
  /** Non-fatal issues encountered during computation (invalid entries, clamps). */
  warnings: string[];
};

/** Exact shape of a single item returned by fetchLearnedItems / useLearnedItems. */
export type LearnedItem = {
  surah_number: number;
  ayah:         number;
};

export const QURAN_TOTAL_AYATS = 6236;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function makeAyatKey(surah: number, ayah: number): AyatKey {
  return `${surah}:${ayah}`;
}

/**
 * Returns the authoritative ayat count for a surah using ZAINLY_ORDER.
 * Returns null for unknown or out-of-range surah numbers.
 */
export function getSurahAyahCount(surah: number): number | null {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  const idx = ZAINLY_INDEX_BY_SURAH[surah];
  if (idx == null) return null;
  return ZAINLY_ORDER[idx]?.ayahs ?? null;
}

// ─── Set builders ─────────────────────────────────────────────────────────────

/**
 * Builds the exact Set<AyatKey> for ayats declared known before Zainly.
 *
 * Rules:
 *   - Full known surah  → add all ayats 1..N using ZAINLY_ORDER
 *   - Partial range     → clamp from/to to valid range, add from..to
 *   - If full and partial overlap → Set prevents duplicates automatically
 *   - Invalid surah     → ignored + warning
 *   - from < 1          → clamped to 1
 *   - to > surah total  → clamped to surah total
 *   - from > to (after clamp) → ignored + warning
 */
export function buildKnownBeforeAyatSet(
  knownSurahs:       number[]                           | null | undefined,
  partialKnownSurahs: Record<number | string, PartialKnown> | null | undefined,
): { set: Set<AyatKey>; warnings: string[] } {
  const set: Set<AyatKey> = new Set();
  const warnings: string[] = [];

  // Full known surahs
  if (Array.isArray(knownSurahs)) {
    for (const surah of knownSurahs) {
      const total = getSurahAyahCount(surah);
      if (total === null) {
        warnings.push(`known_surahs: invalid surah ${surah} — ignored`);
        continue;
      }
      for (let ayah = 1; ayah <= total; ayah++) {
        set.add(makeAyatKey(surah, ayah));
      }
    }
  }

  // Partial known surahs
  if (partialKnownSurahs != null) {
    for (const [keyStr, val] of Object.entries(partialKnownSurahs)) {
      const surah = Number(keyStr);
      if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
        warnings.push(`partial_known_surahs: invalid surah key ${keyStr} — ignored`);
        continue;
      }
      const total = getSurahAyahCount(surah);
      if (total === null) {
        warnings.push(`partial_known_surahs: surah ${surah} not in ZAINLY_ORDER — ignored`);
        continue;
      }
      const from = Math.max(1, val.from ?? 1);
      const to   = Math.min(total, val.to ?? 0);
      if (from > to) {
        warnings.push(`partial_known_surahs: surah ${surah} range ${val.from}–${val.to} invalid after clamp (${from}–${to}) — ignored`);
        continue;
      }
      for (let ayah = from; ayah <= to; ayah++) {
        set.add(makeAyatKey(surah, ayah)); // Set dedupes with full-known overlap
      }
    }
  }

  return { set, warnings };
}

/**
 * Builds the exact Set<AyatKey> for ayats learned through Zainly sessions.
 *
 * Source: items returned by fetchLearnedItems / useLearnedItems.
 * Each item has surah_number + ayah — exact identity.
 *
 * Validation:
 *   - valid surah (1–114, in ZAINLY_ORDER)
 *   - ayah >= 1 and <= surah ayat count
 *   - invalid entries → ignored + warning
 */
export function buildLearnedWithZainlyAyatSet(
  items: LearnedItem[],
): { set: Set<AyatKey>; warnings: string[] } {
  const set: Set<AyatKey> = new Set();
  const warnings: string[] = [];

  for (const item of items) {
    const { surah_number, ayah } = item;
    const total = getSurahAyahCount(surah_number);
    if (total === null) {
      warnings.push(`learnedItems: invalid surah ${surah_number} — ignored`);
      continue;
    }
    if (!Number.isInteger(ayah) || ayah < 1 || ayah > total) {
      warnings.push(`learnedItems: surah ${surah_number} ayah ${ayah} out of range (1–${total}) — ignored`);
      continue;
    }
    set.add(makeAyatKey(surah_number, ayah));
  }

  return { set, warnings };
}

// ─── Main metric computation ───────────────────────────────────────────────────

export function computeHifzProgressMetrics(params: {
  /** Raw plan data from fetchPlan / usePlan. */
  plan: {
    known_surahs?:        number[]                             | null;
    partial_known_surahs?: Record<number | string, PartialKnown> | null;
  } | null | undefined;
  /**
   * Exact learned items from fetchLearnedItems / useLearnedItems.
   * Pass null/undefined if the query has not yet loaded or failed.
   */
  learnedItems: LearnedItem[] | null | undefined;
  /**
   * Fallback total from progress.total_memorized.
   * Used only for learnedWithZainlyAyats when exact items are unavailable.
   * NEVER combined with knownBeforeAyats for a combined total.
   */
  fallbackTotalMemorized: number;
}): HifzProgressMetrics {
  const { plan, learnedItems, fallbackTotalMemorized } = params;
  const allWarnings: string[] = [];

  // ── Known-before-Zainly set ──────────────────────────────────────────────
  const { set: knownBeforeSet, warnings: kbWarnings } = buildKnownBeforeAyatSet(
    plan?.known_surahs,
    plan?.partial_known_surahs,
  );
  allWarnings.push(...kbWarnings);

  // ── Learned-with-Zainly set ──────────────────────────────────────────────
  const hasExactLearnedItems = Array.isArray(learnedItems);

  if (!hasExactLearnedItems) {
    // Exact data unavailable — cannot show combined total safely.
    // Use fallback count only for display of learnedWithZainlyAyats.
    return {
      knownBeforeAyats:           knownBeforeSet.size,
      learnedWithZainlyAyats:     Math.max(0, fallbackTotalMemorized),
      trackedHifzAyats:           0,
      quranTotalAyats:            QURAN_TOTAL_AYATS,
      canShowTrackedTotal:        false,
      learnedExactDataAvailable:  false,
      learnedExactDataConsistent: false,
      warnings:                   allWarnings,
    };
  }

  const { set: learnedSet, warnings: lWarnings } = buildLearnedWithZainlyAyatSet(learnedItems);
  allWarnings.push(...lWarnings);

  // ── Consistency check ────────────────────────────────────────────────────
  // Exact learned set must cover at least as many ayats as progress.total_memorized.
  // If learnedSet.size < fallbackTotalMemorized, there is a historical gap:
  //   - sessions completed before review_items existed
  //   - createReviewItemsForAyatRange failed after completeSession succeeded
  //   - plan reset / import not fully reflected in review_items
  // In that case, the exact set understates the real learned count.
  // We must NOT show MON HIFZ SUIVI with an incomplete learned set.
  const safeCount = Math.max(0, fallbackTotalMemorized);
  const consistent = learnedSet.size >= safeCount;

  if (!consistent) {
    allWarnings.push(
      `learned_items_count_mismatch: learnedSet.size=${learnedSet.size} < fallbackTotalMemorized=${safeCount} — exact data incomplete, falling back to count-only mode`,
    );
    return {
      knownBeforeAyats:           knownBeforeSet.size,
      learnedWithZainlyAyats:     safeCount,
      trackedHifzAyats:           0,
      quranTotalAyats:            QURAN_TOTAL_AYATS,
      canShowTrackedTotal:        false,
      learnedExactDataAvailable:  true,
      learnedExactDataConsistent: false,
      warnings:                   allWarnings,
    };
  }

  // ── Set union — the only safe way to compute combined total ──────────────
  // Exact data is available and consistent with total_memorized.
  // Double-counting is avoided by ayat-key set union (not count addition).
  // An ayat present in both knownBeforeSet and learnedSet is counted once.
  const unionSet: Set<AyatKey> = new Set([...knownBeforeSet, ...learnedSet]);

  return {
    knownBeforeAyats:           knownBeforeSet.size,
    learnedWithZainlyAyats:     learnedSet.size,
    trackedHifzAyats:           unionSet.size,
    quranTotalAyats:            QURAN_TOTAL_AYATS,
    canShowTrackedTotal:        true,
    learnedExactDataAvailable:  true,
    learnedExactDataConsistent: true,
    warnings:                   allWarnings,
  };
}
