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
  // Use atomic upsert with onConflict to prevent TOCTOU race between
  // concurrent finalizations from different devices. Only send the fields
  // that should change on every call — streak, total_memorized, and
  // session_dates are NOT included so they are preserved on update and
  // set by DB column defaults on insert.
  //
  // Note: This requires a unique constraint on user_id in the progress
  // table. If the constraint doesn't exist, the upsert will fall back to
  // a regular insert, which is the same behavior as before.
  const { error } = await supabase
    .from('progress')
    .upsert(
      {
        user_id:         userId,
        current_surah:   payload.current_surah,
        current_ayah:    payload.current_ayah,
        ayah_per_day:    payload.ayah_per_day,
      },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

// ─── resetProgressForNewPlan ──────────────────────────────────────────────
// Used only by onboarding-v2 finalization when a NEW plan is being created
// (src/lib/onboardingFinalize.ts). Unlike upsertProgress() above — which
// deliberately PRESERVES streak/total_memorized/session_dates on update for
// legitimate session-completion callers — this always resets every
// progress-history field to its initial state. A progress row found here
// necessarily predates the plan just created (this is only ever called from
// the branch where fetchPlan(userId) returned null just before), so it can
// never be a legitimate continuation of the plan about to be persisted —
// carrying its streak/totals forward would silently misrepresent a fresh
// program as already in progress.
export async function resetProgressForNewPlan(userId: string, payload: ProgressPayload): Promise<void> {
  const freshFields = {
    user_id:                 userId,
    current_surah:           payload.current_surah,
    current_ayah:            payload.current_ayah,
    ayah_per_day:            payload.ayah_per_day,
    streak:                  0,
    total_memorized:         0,
    session_dates:           [] as string[],
    last_session_date:       null,
    last_session_difficulty: null,
    last_revision_scores:    null,
    last_adaptation_date:    null,
  };

  const { error } = await supabase
    .from('progress')
    .upsert(freshFields, { onConflict: 'user_id' });
  if (error) throw error;
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
//
// allowMultipleToday (default: false):
//   false → free-user behaviour: one new-learning validation per calendar day.
//           Returns an error if last_session_date === today so the caller can
//           detect a duplicate and NOT create review_items.
//   true  → Zainly+ behaviour: additional validations on the same day are
//           accepted. current_ayah advances, total_memorized increases.
//           streak does NOT increment again within the same day.
//
// Streak rules (safe for multi-session):
//   last_session_date === today     → streak unchanged  (already counted today)
//   last_session_date === yesterday → streak + 1
//   otherwise                       → streak reset to 1

export async function completeSession(params: {
  userId: string;
  currentSurah: number;
  newCurrentAyah: number;
  ayahPerDay: number;
  newAyatCount: number;
  difficulty: SessionDifficulty;
  allowMultipleToday?: boolean;
}): Promise<{ error: Error | null; data?: unknown }> {
  const { userId, currentSurah, newCurrentAyah, ayahPerDay, newAyatCount, difficulty, allowMultipleToday = false } = params;

  // 1. Fetch the most recent progress row.
  const { data: existing, error: fetchError } = await supabase
    .from('progress')
    .select('id, current_surah, current_ayah, streak, total_memorized, last_session_date, session_dates')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) return { error: new Error(fetchError.message) };
  if (!existing)  return { error: new Error('Aucune progression trouvée pour cet utilisateur.') };

  const today     = localDateStr();
  const yesterday = localYesterdayStr();

  // 2. Idempotency check — if the row already reflects the target state
  //    (same current_surah + current_ayah, last_session_date === today),
  //    this is a retry of a write that succeeded on the server but whose
  //    response was lost (timeout / transport error). Return success
  //    without re-applying mutations. This prevents:
  //      - Free users being blocked by the "déjà validée" guard on retry.
  //      - Zainly+ users getting total_memorized double-incremented.
  if (
    existing.last_session_date === today &&
    existing.current_surah === currentSurah &&
    existing.current_ayah === newCurrentAyah
  ) {
    return { error: null, data: existing };
  }

  // 3. Duplicate-completion guard — skipped for Zainly+ multi-session.
  if (existing.last_session_date === today && !allowMultipleToday) {
    return { error: new Error('Session déjà validée aujourd\'hui.') };
  }

  // 4. Streak: safe for multi-session.
  //    Same-day second validation must NOT increment streak again.
  const newStreak = existing.last_session_date === today
    ? (existing.streak ?? 0)           // already counted today — unchanged
    : existing.last_session_date === yesterday
      ? (existing.streak ?? 0) + 1     // consecutive day — +1
      : 1;                              // gap — reset

  // 5. total_memorized.
  const newTotalMemorized = (existing.total_memorized ?? 0) + newAyatCount;

  // 6. session_dates: append today if not already present.
  const prevDates: string[] = Array.isArray(existing.session_dates) ? existing.session_dates : [];
  const newSessionDates = prevDates.includes(today) ? prevDates : [...prevDates, today];

  // 7. Update by id only.
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
