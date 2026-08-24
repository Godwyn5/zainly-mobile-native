import { supabase } from './client';

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, is_premium, first_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
