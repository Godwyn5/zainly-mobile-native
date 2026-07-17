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
import { restoreRevenueCatPurchases, hasRevenueCatEntitlement } from '@/lib/revenueCat';
import {
  finalizeOnboardingV2PlanWithPremiumGate, FinalizeOnboardingV2Result,
} from '@/lib/onboardingFinalize';

export type PremiumGateIssueKind = 'sync_error' | 'entitlement_missing';

export interface UseOnboardingV2AuthFinalizeResult {
  /** Set once a 'unlimited' parcours could not be verified — null otherwise. */
  premiumGateIssue: PremiumGateIssueKind | null;
  /** True while a retry/restore attempt is in flight — disable buttons on this. */
  isResolvingPremiumGate: boolean;
  /**
   * Call right after signup/login resolves with an active session.
   * Returns null if blocked by the premium gate (premiumGateIssue is now
   * set — render the retry/restore block) or a real FinalizeOnboardingV2Result
   * the screen should branch on exactly as before (ok / no_source / error).
   */
  runFinalize: (userId: string) => Promise<FinalizeOnboardingV2Result | null>;
  /** Re-attempts the same gated finalization for the last userId passed to runFinalize. */
  retryPremiumGate: () => Promise<FinalizeOnboardingV2Result | null>;
  /** Calls the existing restoreRevenueCatPurchases(), then re-attempts finalization on success. */
  restorePremiumPurchase: () => Promise<FinalizeOnboardingV2Result | null>;
}

export function useOnboardingV2AuthFinalize(): UseOnboardingV2AuthFinalizeResult {
  const [premiumGateIssue, setPremiumGateIssue] = useState<PremiumGateIssueKind | null>(null);
  const [isResolvingPremiumGate, setIsResolvingPremiumGate] = useState(false);
  const userIdRef = useRef<string | null>(null);
  // Guards against double-tap across runFinalize/retryPremiumGate/restorePremiumPurchase —
  // a single bounded async chain per call, never a retry loop or timer.
  const busyRef = useRef(false);

  const runFinalize = useCallback(async (userId: string): Promise<FinalizeOnboardingV2Result | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setIsResolvingPremiumGate(true);
    userIdRef.current = userId;

    try {
      const outcome = await finalizeOnboardingV2PlanWithPremiumGate(userId);

      if (outcome.status === 'premium_sync_failed') {
        setPremiumGateIssue('sync_error');
        return null;
      }
      if (outcome.status === 'premium_entitlement_missing') {
        setPremiumGateIssue('entitlement_missing');
        return null;
      }

      setPremiumGateIssue(null);
      return outcome.finalize;
    } finally {
      busyRef.current = false;
      setIsResolvingPremiumGate(false);
    }
  }, []);

  const retryPremiumGate = useCallback(async (): Promise<FinalizeOnboardingV2Result | null> => {
    if (!userIdRef.current) return null;
    return runFinalize(userIdRef.current);
  }, [runFinalize]);

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
    runFinalize,
    retryPremiumGate,
    restorePremiumPurchase,
  };
}
