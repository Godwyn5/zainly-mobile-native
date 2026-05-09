import { supabase } from './client';

// TODO: implement review item queries
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
