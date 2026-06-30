import { supabase } from './client';
import type { ProgressPayload } from '@/core/planEngine';

// ─── Shared difficulty type (imported by reviewItems.ts and session UI) ───────

export type SessionDifficulty = 'easy' | 'hesitant' | 'hard';

// Maps human difficulty to the numeric DB column last_session_difficulty.
const DIFFICULTY_DB_VALUE: Record<SessionDifficulty, number> = {
  easy:     1,
  hesitant: 2,
  hard:     3,
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

export async function upsertProgress(userId: string, payload: ProgressPayload): Promise<void> {
  const { data: existing } = await supabase
    .from('progress')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Preserve streak / total_memorized / session_dates — only update position + pace
    const { error } = await supabase
      .from('progress')
      .update({
        current_surah: payload.current_surah,
        current_ayah:  payload.current_ayah,
        ayah_per_day:  payload.ayah_per_day,
      })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('progress').insert({
      user_id:         userId,
      current_surah:   payload.current_surah,
      current_ayah:    payload.current_ayah,
      ayah_per_day:    payload.ayah_per_day,
      streak:          0,
      total_memorized: 0,
      session_dates:   [],
    });
    if (error) throw error;
  }
}

export async function fetchProgress(userId: string) {
  const { data, error } = await supabase
    .from('progress')
    .select('user_id, current_surah, current_ayah, streak, total_memorized, last_session_date, session_dates, ayah_per_day, last_session_difficulty, last_revision_scores, last_adaptation_date')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── completeSession ──────────────────────────────────────────────────────────
// Writes all session-completion fields atomically by row id.
// Guards against duplicate completion for the same calendar day.

export async function completeSession(params: {
  userId: string;
  currentSurah: number;
  newCurrentAyah: number;
  ayahPerDay: number;
  newAyatCount: number;
  difficulty: SessionDifficulty;
}): Promise<{ error: Error | null; data?: unknown }> {
  const { userId, currentSurah, newCurrentAyah, ayahPerDay, newAyatCount, difficulty } = params;

  // 1. Fetch the most recent progress row.
  const { data: existing, error: fetchError } = await supabase
    .from('progress')
    .select('id, streak, total_memorized, last_session_date, session_dates')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) return { error: new Error(fetchError.message) };
  if (!existing)  return { error: new Error('Aucune progression trouvée pour cet utilisateur.') };

  const today     = localDateStr();
  const yesterday = localYesterdayStr();

  // 2. Duplicate-completion guard.
  if (existing.last_session_date === today) {
    return { error: new Error('Session déjà validée aujourd\'hui.') };
  }

  // 3. Streak: +1 if yesterday was the last session, else reset to 1.
  const newStreak = existing.last_session_date === yesterday
    ? (existing.streak ?? 0) + 1
    : 1;

  // 4. total_memorized.
  const newTotalMemorized = (existing.total_memorized ?? 0) + newAyatCount;

  // 5. session_dates: append today if not already present.
  const prevDates: string[] = Array.isArray(existing.session_dates) ? existing.session_dates : [];
  const newSessionDates = prevDates.includes(today) ? prevDates : [...prevDates, today];

  // 6. Update by id only.
  const { data, error: updateError } = await supabase
    .from('progress')
    .update({
      current_surah:           currentSurah,
      current_ayah:            newCurrentAyah,
      ayah_per_day:            ayahPerDay,
      streak:                  newStreak,
      total_memorized:         newTotalMemorized,
      last_session_date:       today,
      session_dates:           newSessionDates,
      last_session_difficulty: DIFFICULTY_DB_VALUE[difficulty],
    })
    .eq('id', existing.id)
    .select()
    .maybeSingle();

  if (updateError) return { error: new Error(updateError.message) };
  return { error: null, data };
}
