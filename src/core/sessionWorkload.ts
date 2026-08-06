// ─── sessionWorkload.ts ──────────────────────────────────────────────────────
// Session charge and duration helpers extracted from app/(app)/session.tsx.
// Pure functions — no external dependencies, no side effects.

type ChargeLevel = 'light' | 'normal' | 'intense';

export function estimateDuration(ayatCount: number, hasReviews: boolean): string {
  if (ayatCount <= 2) return hasReviews ? '~8 min' : '~5 min';
  if (ayatCount <= 5) return hasReviews ? '~12 min' : '~8 min';
  return hasReviews ? '~20 min' : '~15 min';
}

export function chargeInfo(ayatCount: number, reviewCount: number): { label: string; level: ChargeLevel } {
  if (reviewCount >= 5 || ayatCount >= 6) return { label: 'Intense', level: 'intense' };
  if (reviewCount > 0  || ayatCount >= 3) return { label: 'Normale', level: 'normal'  };
  return                                         { label: 'Légère',  level: 'light'   };
}
