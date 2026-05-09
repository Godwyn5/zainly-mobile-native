// TODO: implement plan computation logic
// Ported from web app lib/zainlyOrder.js + api/generate-plan/route.js
// Pure functions — no React, no Supabase

export type PlanMode = 'recommended' | 'start_surah' | 'custom_order';

export interface PartialKnown {
  from: number;
  to: number;
}

// TODO: computeStartFromKnown, computeNewStreak, getStartAyahForSurah
// Will be implemented in the next coding step
