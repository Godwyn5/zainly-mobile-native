// Supabase table row types for Zainly Mobile
// TODO: generate from Supabase CLI once schema is stable

export interface Plan {
  id: string;
  user_id: string;
  ayah_per_day: number;
  days_per_week: number;
  first_surah_name: string;
  surah_start: number;
  start_ayah: number;
  plan_mode: 'recommended' | 'start_surah' | 'custom_order';
  known_surahs: number[];
  partial_known_surahs: Record<string, { from: number; to: number }>;
  custom_surah_order: number[];
  pace_label: string | null;
  remaining_ayats: number;
  estimated_months: number;
  created_at: string;
}

export interface Progress {
  id: string;
  user_id: string;
  current_surah: number;
  current_ayah: number;
  ayah_per_day: number;
  streak: number;
  total_memorized: number;
  last_session_date: string | null;
  session_dates: string[];
  last_session_difficulty: number | null;
  last_revision_scores: number[];
  last_adaptation_date: string | null;
  last_adaptation_reason: string | null;
  created_at: string;
}

export interface ReviewItem {
  id: string;
  user_id: string;
  surah_number: number;
  ayah: number;
  review_cycle: number;
  next_review: string;
  mastered: boolean;
  final_test_status: 'validated' | 'reinforce' | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  is_premium: boolean;
}

export interface AccountDeletionRequest {
  id: string;
  user_id: string;
  email: string | null;
  status: 'pending' | 'processing' | 'completed' | 'canceled';
  reason: string | null;
  requested_at: string;
  processed_at: string | null;
  created_at: string;
}
