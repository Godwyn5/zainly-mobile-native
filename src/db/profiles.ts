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

// Best-effort — called once right after onboarding finalization to persist
// the first name captured during onboarding-v2 (src/lib/onboardingDraft.ts).
// Never blocks plan finalization: callers must catch/ignore failures here,
// exactly like the notification-scheduling step in onboardingFinalize.ts.
export async function upsertProfileFirstName(userId: string, firstName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ first_name: firstName })
    .eq('id', userId);
  if (error) throw error;
}
