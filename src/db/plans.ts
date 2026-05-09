import { supabase } from './client';

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
