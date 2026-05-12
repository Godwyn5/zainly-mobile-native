import { supabase } from './client';
import type { ProgressPayload } from '@/core/planEngine';

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
