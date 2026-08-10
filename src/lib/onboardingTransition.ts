// ─── runOnboardingTransition ─────────────────────────────────────────────────
// Shared transition logic for signup-email and login-email when the auth flow
// originates from an onboarding-v2 parcours. Runs the full sequence:
//   createTransitionLease → setSessionAuthFlowId → signUp/signIn →
//   finalizeOnboardingV2PlanWithPremiumGate → handOffFinalizedProgram →
//   clearPendingOnboardingIfMatches → cache verification → releaseTransitionLease
//
// While the lease is active, _layout.tsx treats the user as unauthenticated,
// keeping the (auth) route group mounted and the signup/login screen visible.
// The dashboard never mounts until the cache is confirmed populated.
//
// On any failure, the lease is released and a typed result is returned so the
// caller can render a stable error/retry UI on the same screen — the dashboard
// is never exposed with incomplete data.

import { QueryClient } from '@tanstack/react-query';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  setSessionAuthFlowId,
  clearSessionAuthFlowId,
  readPendingOnboardingPlan,
  clearPendingOnboardingIfMatches,
} from '@/lib/pendingOnboardingPlan';
import {
  createTransitionLease,
  releaseTransitionLease,
  setTransitionLeaseUserId,
  getActiveTransitionLeaseFlowId,
  completeTransitionLease,
  type SignupVisualSnapshot,
} from '@/lib/transitionLease';
import { planQueryOptions, progressQueryOptions } from '@/queries';

export type OnboardingTransitionError =
  | { kind: 'finalize_error'; reason: string; message?: string }
  | { kind: 'premium_sync_failed'; reason: 'configure_failed' | 'login_failed' | 'customer_info_failed' }
  | { kind: 'premium_entitlement_missing' }
  | { kind: 'handoff_error'; message: string }
  | { kind: 'clear_superseded'; message: string }
  | { kind: 'cache_verification_failed'; message: string };

export type OnboardingTransitionResult =
  | { status: 'success' }
  | { status: 'error'; error: OnboardingTransitionError };

/**
 * Runs the full onboarding transition sequence after supabase.auth.signUp
 * or signInWithPassword has returned with an active session.
 *
 * The caller MUST:
 *   1. Call createTransitionLease(flowId) BEFORE supabase.auth.signUp/signIn
 *   2. Call setSessionAuthFlowId(flowId) BEFORE calling this function
 *   3. Pass the userId from the session and the leaseId from step 1
 *
 * This function:
 *   1. Runs finalizeOnboardingV2PlanWithPremiumGate
 *   2. On success, runs handOffFinalizedProgram (populates plan+progress cache)
 *   3. On handoff success, clears the pending payload
 *   4. Verifies the cache has non-null plan and progress
 *   5. Releases the transition lease
 *   6. Returns a typed result
 */
export async function runOnboardingTransition(
  queryClient: QueryClient,
  userId: string,
  leaseId: string,
  sessionGen: string,
  visual: SignupVisualSnapshot,
): Promise<OnboardingTransitionResult> {
  try {
    // ── Step 1: Finalize with premium gate ──────────────────────────────
    const authFlowId = getActiveTransitionLeaseFlowId() ?? '';
    const outcome = await finalizeOnboardingV2PlanWithPremiumGate(userId, authFlowId);

    if (outcome.status === 'premium_sync_failed') {
      releaseTransitionLease(leaseId);
      return { status: 'error', error: { kind: 'premium_sync_failed', reason: outcome.reason } };
    }
    if (outcome.status === 'premium_entitlement_missing') {
      releaseTransitionLease(leaseId);
      return { status: 'error', error: { kind: 'premium_entitlement_missing' } };
    }

    if (!outcome.finalize.ok) {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: {
          kind: 'finalize_error',
          reason: outcome.finalize.reason,
          message: outcome.finalize.message,
        },
      };
    }

    // ── Step 2: Handoff — populate cache with canonical rows ────────────
    const handoff = await handOffFinalizedProgram(queryClient, userId);
    if (handoff.status === 'error') {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: {
          kind: 'handoff_error',
          message: "Ton programme est enregistré mais n'a pas pu être chargé. Réessaie.",
        },
      };
    }

    // ── Step 3: Clear the pending payload ───────────────────────────────
    const pendingBeforeClear = await readPendingOnboardingPlan();
    const transactionId = pendingBeforeClear?.flowId ?? '';
    if (transactionId) {
      const clearResult = await clearPendingOnboardingIfMatches(userId, transactionId);
      if (clearResult === 'superseded') {
        releaseTransitionLease(leaseId);
        return {
          status: 'error',
          error: {
            kind: 'clear_superseded',
            message: 'Une nouvelle session a été détectée. Réessaie si nécessaire.',
          },
        };
      }
    }
    clearSessionAuthFlowId();

    // Invalidate pendingOnboarding query so the dashboard sees no pending.
    await queryClient.invalidateQueries({
      queryKey: ['pendingOnboarding', userId],
      exact: true,
      refetchType: 'none',
    }).catch(() => {});
    queryClient.setQueryData(['pendingOnboarding', userId], false);

    // ── Step 4: Verify cache has non-null plan and progress ─────────────
    const cachedPlan = queryClient.getQueryData(planQueryOptions(userId).queryKey);
    const cachedProgress = queryClient.getQueryData(progressQueryOptions(userId).queryKey);
    if (!cachedPlan || !cachedProgress) {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: {
          kind: 'cache_verification_failed',
          message: "Le programme n'a pas pu être vérifié. Réessaie.",
        },
      };
    }

    // ── Step 5: Atomic transition ACTIVE → DATA_READY_COVERED ──────
    // Single mutation+notification: lease becomes inactive for routing,
    // verified handoff is available, and visual snapshot is stored for
    // the cover overlay — all in the same render.
    completeTransitionLease(leaseId, userId, authFlowId, sessionGen, visual);
    return { status: 'success' };
  } catch (error) {
    releaseTransitionLease(leaseId);
    return {
      status: 'error',
      error: {
        kind: 'finalize_error',
        reason: 'persist_error',
        message: error instanceof Error ? error.message : 'Erreur inattendue.',
      },
    };
  }
}

/**
 * Creates a transition lease and sets the session auth flow ID.
 * Returns the leaseId that must be passed to runOnboardingTransition.
 *
 * Call this BEFORE supabase.auth.signUp/signInWithPassword.
 *
 * When `visual` is provided, the lease's visual snapshot is populated
 * immediately (ACTIVE phase) instead of only at completion — allowing the
 * caller's cover overlay to already be mounted before any route swap.
 * Callers that omit it keep the previous behavior unchanged.
 */
export function beginOnboardingTransition(flowId: string, visual?: SignupVisualSnapshot): string {
  setSessionAuthFlowId(flowId);
  return createTransitionLease(flowId, visual ?? null);
}

/**
 * Sets the userId on the active lease after signUp returns with a session.
 * Must be called BEFORE runOnboardingTransition.
 */
export function setTransitionUserId(userId: string): void {
  setTransitionLeaseUserId(userId);
}
