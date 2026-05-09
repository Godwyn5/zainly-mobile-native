import { supabase } from './client';

// TODO: implement progress queries
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
