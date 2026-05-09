import { supabase } from './client';

// TODO: implement profile queries
export async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, is_premium')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
