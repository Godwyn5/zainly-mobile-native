// ─── runOnboardingTransition ─────────────────────────────────────────────────
// Shared transition logic for signup-email and login-email when the auth flow
// originates from an onboarding-v2 parcours. Runs the full sequence:
//   createTransitionLease → setSessionAuthFlowId → signUp/signIn →
//   finalizeOnboardingV2Plan → handOffFinalizedProgram →
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
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  setSessionAuthFlowId,
  clearSessionAuthFlowId,
  readPendingOnboardingPlan,
  clearPendingOnboardingIfMatches,
  saveCompletedAuthProof,
  hasValidPendingOnboardingPlanForUser,
  readGuestDraftHandoff,
  claimGuestDraftWithHandoff,
} from '@/lib/pendingOnboardingPlan';
import {
  createTransitionLease,
  releaseTransitionLease,
  setTransitionLeaseUserId,
  getActiveTransitionLeaseFlowId,
  getActiveTransitionLeaseUserId,
  completeTransitionLease,
  type SignupVisualSnapshot,
} from '@/lib/transitionLease';
import { readOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { planQueryOptions, progressQueryOptions } from '@/queries';

export type OnboardingTransitionError =
  | { kind: 'finalize_error'; reason: string; message?: string }
  | { kind: 'handoff_error'; message: string }
  | { kind: 'proof_persist_failed'; message: string }
  | { kind: 'clear_superseded'; message: string }
  | { kind: 'cache_verification_failed'; message: string }
  | { kind: 'session_check_failed'; message: string }
  | { kind: 'not_onboardable'; message: string }
  | { kind: 'claim_failed'; reason: string; message: string }
  | { kind: 'no_draft'; message: string };

export type OnboardingTransitionResult =
  | { status: 'success' }
  | { status: 'needs_onboarding' }
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
 *   1. Confirms the Supabase session and active transition lease
 *   2. Persists the completed auth proof
 *   3. Decides between legacy (pending payload → finalize) and early
 *      (Build → guest draft claim → needs_onboarding)
 *   4. Legacy: finalize → handoff → clear → DATA_READY_COVERED
 *   5. Early: claim guest draft → verify user draft → release lease
 *   6. Returns a typed, discriminated result
 */
export async function runOnboardingTransition(
  queryClient: QueryClient,
  userId: string,
  leaseId: string,
  sessionGen: string,
  visual: SignupVisualSnapshot,
): Promise<OnboardingTransitionResult> {
  const getCurrentSessionUserId = () => useAuthStore.getState().session?.user?.id;

  try {
    // ── Step 1: Confirm Supabase session belongs to the expected user ────
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || session.user.id !== userId) {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: { kind: 'session_check_failed', message: 'Session non valide. Réessaie.' },
      };
    }

    // ── Step 2: Confirm the active lease matches this session ────────────
    const authFlowId = getActiveTransitionLeaseFlowId() ?? '';
    const leaseUserId = getActiveTransitionLeaseUserId();
    if (!authFlowId || leaseUserId !== userId) {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: { kind: 'session_check_failed', message: 'Session de transition invalide.' },
      };
    }

    // ── Step 3: Persist the completed auth proof ─────────────────────────
    // This is the POST-AUTH proof that binds the onboarding transaction to
    // the authenticated userId. It is required by claimGuestDraftWithHandoff.
    // If proof persistence fails, we must not navigate into a route that
    // depends on it; the active Supabase session lets the user retry.
    try {
      await saveCompletedAuthProof(authFlowId, userId);
    } catch {
      releaseTransitionLease(leaseId);
      return {
        status: 'error',
        error: {
          kind: 'proof_persist_failed',
          message: "L'authentification a réussi mais la preuve n'a pas pu être enregistrée. Réessaie.",
        },
      };
    }

    // ── Step 4: Decide legacy (late auth) vs early (Build) path ──────────
    // Legacy: a pending onboarding payload was saved at program-summary.
    // Early: no pending payload, but the active auth flow and guest draft
    // handoff were created at Build.
    const hasPending = await hasValidPendingOnboardingPlanForUser(userId);
    const guestHandoff = await readGuestDraftHandoff();

    const guestHandoffMatches = !!guestHandoff && guestHandoff.transactionFlowId === authFlowId;

    // ── LEGACY: finalize the program from the pending payload ────────────
    if (hasPending) {
      const outcome = await finalizeOnboardingV2Plan(userId, authFlowId);
      if (!outcome.ok) {
        releaseTransitionLease(leaseId);
        return {
          status: 'error',
          error: { kind: 'finalize_error', reason: outcome.reason, message: outcome.message },
        };
      }

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

      const pendingBeforeClear = await readPendingOnboardingPlan();
      const transactionId = pendingBeforeClear?.flowId ?? '';
      if (transactionId) {
        const clearResult = await clearPendingOnboardingIfMatches(userId, transactionId);
        if (clearResult === 'superseded') {
          releaseTransitionLease(leaseId);
          return {
            status: 'error',
            error: { kind: 'clear_superseded', message: 'Une nouvelle session a été détectée. Réessaie si nécessaire.' },
          };
        }
      }
      clearSessionAuthFlowId();

      await queryClient.invalidateQueries({
        queryKey: ['pendingOnboarding', userId],
        exact: true,
        refetchType: 'none',
      }).catch(() => {});
      queryClient.setQueryData(['pendingOnboarding', userId], false);

      const cachedPlan = queryClient.getQueryData(planQueryOptions(userId).queryKey);
      const cachedProgress = queryClient.getQueryData(progressQueryOptions(userId).queryKey);
      if (!cachedPlan || !cachedProgress) {
        releaseTransitionLease(leaseId);
        return {
          status: 'error',
          error: { kind: 'cache_verification_failed', message: "Le programme n'a pas pu être vérifié. Réessaie." },
        };
      }

      completeTransitionLease(leaseId, userId, authFlowId, sessionGen, visual);
      return { status: 'success' };
    }

    // ── EARLY: claim the guest draft, then resume onboarding ─────────────
    if (!hasPending && guestHandoffMatches) {
      const guestFlowId = guestHandoff.sourceGuestDraftFlowId;
      const claim = await claimGuestDraftWithHandoff(
        userId,
        guestFlowId,
        getCurrentSessionUserId,
      );
      if (!claim.ok) {
        releaseTransitionLease(leaseId);
        return {
          status: 'error',
          error: {
            kind: 'claim_failed',
            reason: claim.reason,
            message: 'Impossible de récupérer ton brouillon. Réessaie.',
          },
        };
      }

      const userDraft = await readOnboardingDraftForOwner({ kind: 'authenticated', userId });
      if (!userDraft) {
        releaseTransitionLease(leaseId);
        return {
          status: 'error',
          error: { kind: 'no_draft', message: 'Brouillon introuvable après création du compte.' },
        };
      }

      // Release the lease so _layout sees the user as authed, runs
      // prepareAuthenticatedLaunch, and mounts the onboarding-only stack.
      releaseTransitionLease(leaseId);
      return { status: 'needs_onboarding' };
    }

    // No actionable onboarding source for this authentication.
    releaseTransitionLease(leaseId);
    return {
      status: 'error',
      error: { kind: 'not_onboardable', message: 'Aucun parcours à reprendre ou à finaliser.' },
    };
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
