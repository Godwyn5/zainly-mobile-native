// ─── useOnboardingV2AuthFinalize ────────────────────────────────────────────
// Shared orchestration for signup.tsx/login.tsx: calls
// finalizeOnboardingV2PlanWithPremiumGate() right after a Supabase session
// exists, and exposes just enough state for each screen to render its own
// sober retry/restore UI when a 'unlimited' parcours cannot yet be verified
// as premium. Never grants access itself — RevenueCat entitlement (checked
// inside the gate) remains the only source of truth. Free/daily_limited
// parcours (or accounts with no onboarding-v2 source at all) resolve
// immediately with no gate involved.

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { restoreRevenueCatPurchases, hasRevenueCatEntitlement } from '@/lib/revenueCat';
import {
  finalizeOnboardingV2PlanWithPremiumGate, FinalizeOnboardingV2Result,
} from '@/lib/onboardingFinalize';
import { getSessionAuthFlowId, clearSessionAuthFlowId } from '@/lib/pendingOnboardingPlan';

// ─── Dashboard queries that decide "has a plan" / "no plan" state ─────────
// AuthLayout (app/(auth)/_layout.tsx) redirects into the dashboard the
// instant a Supabase session appears (via the global onAuthStateChange
// listener in app/_layout.tsx) — independently of, and typically BEFORE,
// this finalize call finishes persisting the plan/progress rows. If the
// dashboard's usePlan/useProgress/useDueReviews/useProfile queries fire
// during that race, they cache an empty "no plan yet" result under their
// staleTime (up to 5 minutes for plan/progress/dueReviews) — the exact
// same queryClient instance survives the subsequent router.replace below,
// so without an explicit invalidation the dashboard would keep showing
// "Créer mon programme" until a full app restart resets the cache.
// Invalidating here (right after a successful finalize, still inside this
// same async call) refetches any already-mounted dashboard query
// immediately, and marks not-yet-mounted ones stale so their first mount
// fetches fresh data — never a setTimeout, never a forced reload.
function invalidateDashboardQueries(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['plan', userId] }),
    queryClient.invalidateQueries({ queryKey: ['progress', userId] }),
    queryClient.invalidateQueries({ queryKey: ['dueReviews', userId] }),
    queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    queryClient.invalidateQueries({ queryKey: ['pendingOnboarding', userId] }),
  ]);
}

export type PremiumGateIssueKind = 'sync_error' | 'entitlement_missing';

// ─── Declarative lifecycle status ──────────────────────────────────────────
// Additive to the existing Promise-based API above — signup.tsx/login.tsx
// keep working unchanged (they only ever read the resolved
// FinalizeOnboardingV2Result + premiumGateIssue). This status/lastError pair
// exists so a caller with no natural "await this one call" moment — the
// dashboard, which must recover a finalization that may have started before
// it even mounted (app/(auth)/_layout.tsx can redirect into it before
// finalizeOnboardingV2Plan() finishes) — can render UI reactively instead.
// Never a second finalization implementation: both consumers funnel through
// the exact same runFinalize()/finalizeOnboardingV2PlanWithPremiumGate().
export type OnboardingV2FinalizeStatus =
  | 'idle' | 'running' | 'success' | 'error'
  | 'premium_sync_failed' | 'premium_entitlement_missing';

export interface OnboardingV2FinalizeError {
  reason: string;
  message?: string;
}

export interface UseOnboardingV2AuthFinalizeResult {
  /** Set once a 'unlimited' parcours could not be verified — null otherwise. */
  premiumGateIssue: PremiumGateIssueKind | null;
  /** True while a retry/restore attempt is in flight — disable buttons on this. */
  isResolvingPremiumGate: boolean;
  /** Declarative status of the last runFinalize/retry/restore call — 'idle' until the first call. */
  status: OnboardingV2FinalizeStatus;
  /** Set only when status === 'error' (a non-premium finalize failure) — null otherwise. */
  lastError: OnboardingV2FinalizeError | null;
  /**
   * Call right after signup/login resolves with an active session.
   * Returns null if blocked by the premium gate (premiumGateIssue is now
   * set — render the retry/restore block) or a real FinalizeOnboardingV2Result
   * the screen should branch on exactly as before (ok / no_source / error).
   */
  runFinalize: (userId: string) => Promise<FinalizeOnboardingV2Result | null>;
  /** Re-attempts the same gated finalization for the last userId passed to runFinalize. */
  retryPremiumGate: () => Promise<FinalizeOnboardingV2Result | null>;
  /** Generic alias of retryPremiumGate — identical call, named for non-premium-gate callers (e.g. the dashboard's "Réessayer" on a persist/network error). No duplicated logic. */
  retryFinalize: () => Promise<FinalizeOnboardingV2Result | null>;
  /** Calls the existing restoreRevenueCatPurchases(), then re-attempts finalization on success. */
  restorePremiumPurchase: () => Promise<FinalizeOnboardingV2Result | null>;
}

export function useOnboardingV2AuthFinalize(): UseOnboardingV2AuthFinalizeResult {
  const queryClient = useQueryClient();
  const [premiumGateIssue, setPremiumGateIssue] = useState<PremiumGateIssueKind | null>(null);
  const [isResolvingPremiumGate, setIsResolvingPremiumGate] = useState(false);
  const [status, setStatus] = useState<OnboardingV2FinalizeStatus>('idle');
  const [lastError, setLastError] = useState<OnboardingV2FinalizeError | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Guards against double-tap across runFinalize/retryPremiumGate/restorePremiumPurchase —
  // a single bounded async chain per call, never a retry loop or timer.
  const busyRef = useRef(false);

  const runFinalize = useCallback(async (userId: string): Promise<FinalizeOnboardingV2Result | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setIsResolvingPremiumGate(true);
    setStatus('running');
    setLastError(null);
    userIdRef.current = userId;

    try {
      // Read the in-memory session flow ID set by signup-email/login-email when
      // context=onboarding was in their route params. Empty string means the
      // current session did not originate from an onboarding parcours.
      const authFlowId = getSessionAuthFlowId();
      const outcome = await finalizeOnboardingV2PlanWithPremiumGate(userId, authFlowId);

      if (outcome.status === 'premium_sync_failed') {
        setPremiumGateIssue('sync_error');
        setStatus('premium_sync_failed');
        return null;
      }
      if (outcome.status === 'premium_entitlement_missing') {
        setPremiumGateIssue('entitlement_missing');
        setStatus('premium_entitlement_missing');
        return null;
      }

      setPremiumGateIssue(null);
      if (outcome.finalize.ok) {
        clearSessionAuthFlowId();
        await invalidateDashboardQueries(queryClient, userId);
        setStatus('success');
      } else {
        setStatus('error');
        setLastError({ reason: outcome.finalize.reason, message: outcome.finalize.message });
      }
      return outcome.finalize;
    } finally {
      busyRef.current = false;
      setIsResolvingPremiumGate(false);
    }
  }, [queryClient]);

  const retryPremiumGate = useCallback(async (): Promise<FinalizeOnboardingV2Result | null> => {
    if (!userIdRef.current) return null;
    return runFinalize(userIdRef.current);
  }, [runFinalize]);

  // Generic alias — same call as retryPremiumGate, exposed under a name
  // that reads clearly for non-premium-gate retry callers.
  const retryFinalize = retryPremiumGate;

  const restorePremiumPurchase = useCallback(async (): Promise<FinalizeOnboardingV2Result | null> => {
    if (busyRef.current || !userIdRef.current) return null;
    busyRef.current = true;
    setIsResolvingPremiumGate(true);

    let restoredEntitlement = false;
    try {
      const restoreResult = await restoreRevenueCatPurchases();
      restoredEntitlement = restoreResult.ok && hasRevenueCatEntitlement(restoreResult.customerInfo);
    } finally {
      busyRef.current = false;
      setIsResolvingPremiumGate(false);
    }

    if (!restoredEntitlement) {
      // Stays in 'entitlement_missing' — no real purchase found to restore.
      return null;
    }

    // Real entitlement recovered — re-run the same gated path, which will
    // now confirm it via syncRevenueCatUserAfterAuth() and finalize normally.
    return runFinalize(userIdRef.current);
  }, [runFinalize]);

  return {
    premiumGateIssue,
    isResolvingPremiumGate,
    status,
    lastError,
    runFinalize,
    retryPremiumGate,
    retryFinalize,
    restorePremiumPurchase,
  };
}
