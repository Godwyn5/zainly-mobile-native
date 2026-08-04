// ─── usePendingOnboardingPlanStatus ─────────────────────────────────────────
// Reports whether a still-valid onboarding-v2 pending payload
// (src/lib/pendingOnboardingPlan.ts) exists in AsyncStorage — i.e. the user
// tapped "Commencer mon Hifz" on program-summary and a finalization
// (signup.tsx/login.tsx → onboardingFinalize.ts) may still be in flight, or
// may have failed without clearing it. Used by the dashboard to avoid ever
// showing the legacy "Créer mon programme" CTA while that is true — never
// mutates the payload itself (read-only).
//
// Uses the shared pendingOnboardingQueryOptions so the boot pipeline
// (prepareAuthenticatedLaunch) and the dashboard read from the exact same
// TanStack Query cache entry — no duplicate AsyncStorage reads, no race
// between two independent states.

import { useQuery } from '@tanstack/react-query';
import { pendingOnboardingQueryOptions } from '@/queries';

export interface PendingOnboardingPlanStatus {
  /** True until the first AsyncStorage check resolves. */
  isLoading: boolean;
  /** True if a still-valid (non-expired, well-formed) pending payload exists. */
  hasPending: boolean;
  /** Set if the AsyncStorage read itself failed — hasPending is false in that case. */
  error: string | null;
}

export function usePendingOnboardingPlanStatus(userId: string | undefined): PendingOnboardingPlanStatus {
  const query = useQuery(pendingOnboardingQueryOptions(userId));

  const error = query.error instanceof Error
    ? query.error.message
    : query.error ? String(query.error) : null;

  return {
    isLoading: query.isLoading,
    hasPending: query.data === true,
    error,
  };
}
