import { supabase } from './client';
import type { PlanPayload, PlanMode } from '@/core/planEngine';
import { ZAINLY_INDEX_BY_SURAH } from '@/core/planEngine';
import { updateProgressPointer } from './progress';

// ─── updateProgramMode ────────────────────────────────────────────────────────
// Updates ONLY future-program fields on the most recent plan row.
// Never touches: total_memorized, review_items, session_dates, streak,
//                learned items, or any historical Progression metric.
// Preserves: known_surahs, partial_known_surahs, ayah_per_day, days_per_week.

export type UpdateProgramModeResult = {
  error: Error | null;
  /**
   * True if the plan row was updated successfully.
   * If error is set AND planUpdated is true, it means plan succeeded but
   * the progress pointer update (Step 2) failed. The plan is saved; the
   * session pointer may be stale until the user retries.
   */
  planUpdated: boolean;
};

export async function updateProgramMode(params: {
  userId:      string;
  mode:        PlanMode;
  startSurah?: number;   // required when mode === 'start_surah'
  customSurahOrder?: number[];  // required when mode === 'custom_order'
}): Promise<UpdateProgramModeResult> {
  const { userId, mode, startSurah, customSurahOrder } = params;

  // Pre-flight validation (before any DB call)
  if (!userId) return { error: new Error('Utilisateur non identifié.'), planUpdated: false };
  if (!['recommended', 'start_surah', 'custom_order'].includes(mode)) {
    return { error: new Error('Mode de programme invalide.'), planUpdated: false };
  }
  if (mode === 'start_surah') {
    if (!Number.isInteger(startSurah) || startSurah! < 1 || startSurah! > 114) {
      return { error: new Error('Numéro de sourate invalide.'), planUpdated: false };
    }
    if (ZAINLY_INDEX_BY_SURAH[startSurah!] == null) {
      return { error: new Error('Sourate absente du parcours Zainly.'), planUpdated: false };
    }
  }
  if (mode === 'custom_order') {
    if (!Array.isArray(customSurahOrder) || customSurahOrder.length === 0) {
      return { error: new Error('Choisis au moins une sourate pour ce mode.'), planUpdated: false };
    }
    for (const s of customSurahOrder) {
      if (!Number.isInteger(s) || s < 1 || s > 114 || ZAINLY_INDEX_BY_SURAH[s] == null) {
        return { error: new Error(`Sourate ${s} invalide dans l'ordre personnalisé.`), planUpdated: false };
      }
    }
  }

  // Fetch most recent plan row
  const { data: existing, error: fetchError } = await supabase
    .from('plans')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) return { error: new Error(fetchError.message), planUpdated: false };
  if (!existing)  return { error: new Error('Aucun programme trouvé pour cet utilisateur.'), planUpdated: false };

  // ── Step 1: update plan mode fields ──────────────────────────────────────────
  const updatePayload: Record<string, unknown> = { plan_mode: mode };
  if (mode === 'start_surah') {
    updatePayload.surah_start    = startSurah;
    updatePayload.start_ayah     = 1;          // always start at ayah 1 (V1: no ayah picker)
    updatePayload.starting_surah = startSurah;
    // Do NOT clear custom_surah_order — user may switch back to custom_order later.
    // dailyPlan.ts only reads custom_surah_order when plan_mode === 'custom_order',
    // so preserving it here has no effect on start_surah session behavior.
  } else if (mode === 'recommended') {
    updatePayload.starting_surah = null;
    // Do NOT clear custom_surah_order — user may switch back to custom_order later.
  } else if (mode === 'custom_order') {
    updatePayload.custom_surah_order = customSurahOrder;
    updatePayload.starting_surah     = null;
  }

  const { error: planError } = await supabase
    .from('plans')
    .update(updatePayload)
    .eq('id', existing.id);

  if (planError) return { error: new Error(planError.message), planUpdated: false };

  // ── Step 2: update progress pointer when start position changes ───────────────
  // getTodayProgramme reads progress.current_surah + current_ayah exclusively.
  // plan.surah_start/starting_surah are not read at runtime.
  // current_ayah is stored as (startAyah - 1) because getTodayProgramme
  // computes: memStart = current_ayah + 1.
  // Only needed for start_surah; recommended/custom_order don't change position.
  if (mode === 'start_surah') {
    const progressResult = await updateProgressPointer({
      userId,
      currentSurah: startSurah!,
      currentAyah:  0,  // start at ayah 1 → pointer = 0 (last completed = none)
                        // matches computePlan: progressPayload.current_ayah = startAyah - 1 = 1 - 1 = 0
    });
    if (progressResult.error) {
      // Plan is saved (planUpdated: true) but progress pointer is stale.
      // Caller must show a specific error and should not celebrate success.
      return {
        error: new Error(
          `Programme sauvegardé, mais la position de départ n'a pas pu être mise à jour : ${progressResult.error.message}. Réessaie.`
        ),
        planUpdated: true,
      };
    }
  }

  return { error: null, planUpdated: true };
}

export async function upsertPlan(userId: string, payload: PlanPayload): Promise<void> {
  const { data: existing } = await supabase
    .from('plans')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('plans').update(payload).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('plans').insert({ user_id: userId, ...payload });
    if (error) throw error;
  }
}

export async function fetchPlan(userId: string) {
  const { data, error } = await supabase
    .from('plans')
    .select('id, user_id, ayah_per_day, surah_start, start_ayah, plan_mode, known_surahs, partial_known_surahs, custom_surah_order, pace_label, first_surah_name')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
