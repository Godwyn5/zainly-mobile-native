import { supabase } from './client';
import type { SessionDifficulty } from './progress';

// ─── SRS schedule offsets (days) ──────────────────────────────────────────────
// cycle 0→+1, 1→+3, 2→+7, 3→+14, 4→+30, cycle>=5 → mastered

export const REVIEW_OFFSETS = [1, 3, 7, 14, 30] as const;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

// ─── Existing read helpers (unchanged) ────────────────────────────────────────

export async function fetchDueCount(userId: string, today: string, startTodayISO: string): Promise<number> {
  const { data, error } = await supabase
    .from('review_items')
    .select('id')
    .eq('user_id', userId)
    .eq('mastered', false)
    .lte('next_review', today)
    .lt('created_at', startTodayISO);
  if (error) throw error;
  return (data ?? []).length;
}

export async function fetchDueItems(userId: string, today: string, startTodayISO: string) {
  const { data, error } = await supabase
    .from('review_items')
    .select('id, user_id, surah_number, ayah, review_cycle, next_review, mastered, final_test_status, created_at, updated_at')
    .eq('user_id', userId)
    .eq('mastered', false)
    .lte('next_review', today)
    .lt('created_at', startTodayISO);
  if (error) throw error;
  return data ?? [];
}

// ─── createReviewItemsForAyatRange ────────────────────────────────────────────
// Creates one review_item per ayah in the given range.
// Skips ayahs that already have ANY existing row (mastered or active).
// Idempotent: safe to call multiple times — second call is always a no-op.
// final_test_status: DB column accepts 'validated' | 'reinforce' | null.
// We map: easy→'validated', hesitant→'reinforce', hard→'reinforce'.

export async function createReviewItemsForAyatRange(params: {
  userId: string;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
  difficulty: SessionDifficulty;
}): Promise<{ error: Error | null }> {
  const { userId, surahNumber, fromAyah, toAyah, difficulty } = params;

  if (fromAyah > toAyah || fromAyah < 1) {
    return { error: new Error(`Plage d'ayats invalide: ${fromAyah}–${toAyah}.`) };
  }

  // Fetch ALL existing rows (active or mastered) for this range to avoid duplicates.
  // Do NOT filter by mastered — a mastered row must also block re-insertion.
  const { data: existing, error: fetchError } = await supabase
    .from('review_items')
    .select('ayah')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .gte('ayah', fromAyah)
    .lte('ayah', toAyah);

  if (fetchError) return { error: new Error(fetchError.message) };

  const existingAyahs = new Set((existing ?? []).map(r => r.ayah));

  const tomorrow = addDays(1);

  const finalTestStatus: 'validated' | 'reinforce' =
    difficulty === 'easy' ? 'validated' : 'reinforce';

  const rowsToInsert = [];
  for (let ayah = fromAyah; ayah <= toAyah; ayah++) {
    if (existingAyahs.has(ayah)) continue;
    rowsToInsert.push({
      user_id:           userId,
      surah_number:      surahNumber,
      ayah,
      review_cycle:      0,
      next_review:       tomorrow,
      mastered:          false,
      final_test_status: finalTestStatus,
    });
  }

  if (rowsToInsert.length === 0) return { error: null };

  const { error: insertError } = await supabase
    .from('review_items')
    .insert(rowsToInsert);

  if (insertError) return { error: new Error(insertError.message) };
  return { error: null };
}

// ─── fetchLearnedItems ────────────────────────────────────────────────────────
// Returns ALL learned ayats for the user, including mastered ones.
// mastered=true means the SRS cycle completed — the ayat is still in the Hifz.
// There is no separate archived/deleted flag in this schema.
//
// Deduplication: if the same (surah_number, ayah) appears multiple times
// (e.g. a mastered row and a fresh re-insert), we keep only the most recent row
// per unique ayat. The query orders by created_at DESC so the first occurrence
// of each key encountered in the JS loop is always the most recent.

export async function fetchLearnedItems(userId: string) {
  const { data, error } = await supabase
    .from('review_items')
    .select('id, surah_number, ayah, review_cycle, next_review, mastered, final_test_status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  const seen = new Set<string>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    const key = `${row.surah_number}:${row.ayah}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  }
  return deduped;
}

// ─── advanceReviewItem ────────────────────────────────────────────────────────
// Advances a single review item through the SRS cycle based on difficulty.

export async function advanceReviewItem(params: {
  itemId: string;
  difficulty: SessionDifficulty;
}): Promise<{ error: Error | null }> {
  const { itemId, difficulty } = params;

  const { data: item, error: fetchError } = await supabase
    .from('review_items')
    .select('id, review_cycle, mastered')
    .eq('id', itemId)
    .maybeSingle();

  if (fetchError) return { error: new Error(fetchError.message) };
  if (!item)      return { error: new Error(`review_item introuvable: ${itemId}`) };

  const currentCycle: number = item.review_cycle ?? 0;
  let nextCycle: number;
  let nextReview: string;
  let mastered: boolean;

  if (difficulty === 'hard') {
    // Hard: repeat tomorrow, do not advance cycle, but don't go below 0.
    nextCycle  = Math.max(currentCycle - 1, 0);
    nextReview = addDays(1);
    mastered   = false;
  } else if (difficulty === 'hesitant') {
    // Hesitant: stay at current cycle, review in 1 day if cycle 0, else 3 days.
    nextCycle  = currentCycle;
    nextReview = addDays(currentCycle === 0 ? 1 : 3);
    mastered   = false;
  } else {
    // Easy: advance cycle.
    nextCycle = currentCycle + 1;
    if (nextCycle >= REVIEW_OFFSETS.length) {
      mastered   = true;
      nextReview = addDays(365);
    } else {
      mastered   = false;
      nextReview = addDays(REVIEW_OFFSETS[nextCycle]);
    }
  }

  const { error: updateError } = await supabase
    .from('review_items')
    .update({
      review_cycle: nextCycle,
      next_review:  nextReview,
      mastered,
    })
    .eq('id', itemId);

  if (updateError) return { error: new Error(updateError.message) };
  return { error: null };
}

// ─── completeReviewItems ──────────────────────────────────────────────────────
// Bulk-advances multiple review items. Stops on first error.

export async function completeReviewItems(params: {
  itemIds: string[];
  difficulty: SessionDifficulty;
}): Promise<{ error: Error | null }> {
  const { itemIds, difficulty } = params;

  for (const itemId of itemIds) {
    const { error } = await advanceReviewItem({ itemId, difficulty });
    if (error) return { error };
  }
  return { error: null };
}
