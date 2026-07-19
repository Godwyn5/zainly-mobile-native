// ─── usePendingOnboardingPlanStatus ─────────────────────────────────────────
// Reports whether a still-valid onboarding-v2 pending payload
// (src/lib/pendingOnboardingPlan.ts) exists in AsyncStorage — i.e. the user
// tapped "Commencer mon Hifz" on program-summary and a finalization
// (signup.tsx/login.tsx → onboardingFinalize.ts) may still be in flight, or
// may have failed without clearing it. Used by the dashboard to avoid ever
// showing the legacy "Créer mon programme" CTA while that is true — never
// mutates the payload itself (read-only).
//
// Deliberately no polling/timer: callers pass `refreshDeps` (e.g. the
// dashboard's own plan/progress query freshness markers) so the check is
// re-run exactly when a finalization's invalidateQueries() causes those
// queries to refetch, plus once on mount.

import { useEffect, useRef, useState } from 'react';
import { hasValidPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';

export interface PendingOnboardingPlanStatus {
  /** True until the first AsyncStorage check (for the current deps) resolves. */
  isLoading: boolean;
  /** True if a still-valid (non-expired, well-formed) pending payload exists. */
  hasPending: boolean;
  /** Set if the AsyncStorage read itself failed — hasPending is false in that case. */
  error: string | null;
}

export function usePendingOnboardingPlanStatus(
  refreshDeps: ReadonlyArray<unknown> = []
): PendingOnboardingPlanStatus {
  const [isLoading, setIsLoading] = useState(true);
  const [hasPending, setHasPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);

    hasValidPendingOnboardingPlan()
      .then((pending) => {
        if (!mountedRef.current) return;
        setHasPending(pending);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        // Never let a storage failure block the dashboard indefinitely —
        // fall back to "no pending" so the legacy no-plan CTA can still
        // render for genuine no-plan users.
        setHasPending(false);
        setError(err instanceof Error ? err.message : 'Erreur inconnue.');
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false);
      });

    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refreshDeps);

  return { isLoading, hasPending, error };
}
