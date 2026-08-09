// ─── prepareAuthenticatedLaunch ─────────────────────────────────────────────
// Pure function that prefetches all dashboard-critical queries for a given
// userId into the TanStack Query cache. Called by the root layout gate before
// releasing the Stack for an authenticated user.
//
// All queries use the exact same queryKey/queryFn as the dashboard hooks,
// ensuring the cache populated here is consumed directly by useQuery calls
// in the dashboard — no duplicate fetch, no skeleton.
//
// When a pending onboarding-v2 payload exists (signup/login from onboarding),
// the full finalize → handoff → clear sequence runs HERE, before plan/progress
// are fetched. This ensures the dashboard sees canonical rows on its first
// frame instead of null+pending → "Finalisation" card → re-render.
//
// Returns a discriminated result so the gate can branch on success/error
// without catching thrown exceptions in the component.

import { QueryClient } from '@tanstack/react-query';
import {
  planQueryOptions,
  progressQueryOptions,
  dueReviewsQueryOptions,
  profileQueryOptions,
  pendingOnboardingQueryOptions,
  revenueCatCustomerInfoQueryOptions,
} from '@/queries';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  getSessionAuthFlowId,
  clearSessionAuthFlowId,
  readPendingOnboardingPlan,
  clearPendingOnboardingIfMatches,
} from '@/lib/pendingOnboardingPlan';

export type PrepareAuthenticatedLaunchResult =
  | { status: 'ready' }
  | { status: 'error'; error: unknown };

export async function prepareAuthenticatedLaunch(
  queryClient: QueryClient,
  userId: string,
  opts?: { force?: boolean },
): Promise<PrepareAuthenticatedLaunchResult> {
  try {
    // On retry (force=true), reset any queries that are in an error or
    // stale state for this userId so fetchQuery invokes a fresh queryFn
    // instead of reusing a cached error or pending promise.
    if (opts?.force) {
      await queryClient.resetQueries({
        queryKey: ['plan', userId],
        type: 'active',
      }).catch(() => {});
      await queryClient.resetQueries({
        queryKey: ['progress', userId],
        type: 'active',
      }).catch(() => {});
      await queryClient.resetQueries({
        queryKey: ['dueReviews', userId],
        type: 'active',
      }).catch(() => {});
      await queryClient.resetQueries({
        queryKey: ['profile', userId],
        type: 'active',
      }).catch(() => {});
      await queryClient.resetQueries({
        queryKey: ['revenueCatCustomerInfo', userId],
        type: 'active',
      }).catch(() => {});
      await queryClient.resetQueries({
        queryKey: ['pendingOnboarding', userId],
        type: 'active',
      }).catch(() => {});
    }

    // ── Pending onboarding detection ───────────────────────────────────
    // Check for a pending onboarding-v2 payload BEFORE fetching plan/progress.
    // If one exists, run the full finalize → handoff → clear sequence here
    // so the dashboard sees canonical rows on its first frame.
    const pendingResult = await queryClient.fetchQuery(
      pendingOnboardingQueryOptions(userId),
    ).catch(() => false);

    if (pendingResult === true) {
      // A valid pending payload exists — run finalize + handoff + clear.
      const authFlowId = getSessionAuthFlowId();
      const outcome = await finalizeOnboardingV2PlanWithPremiumGate(userId, authFlowId);

      if (outcome.status === 'finalized' && outcome.finalize.ok) {
        // Finalize succeeded — run handoff to populate cache with canonical rows.
        const handoff = await handOffFinalizedProgram(queryClient, userId);
        if (handoff.status === 'ready') {
          // Clear the pending payload with the exact transaction identity.
          const pendingBeforeClear = await readPendingOnboardingPlan();
          const transactionId = pendingBeforeClear?.flowId ?? '';
          if (transactionId) {
            await clearPendingOnboardingIfMatches(userId, transactionId);
          }
          clearSessionAuthFlowId();
          // Invalidate pendingOnboarding query so the dashboard sees no pending.
          await queryClient.invalidateQueries({
            queryKey: ['pendingOnboarding', userId],
            exact: true,
            refetchType: 'none',
          }).catch(() => {});
          // Set pendingOnboarding cache to false — no refetch needed.
          queryClient.setQueryData(['pendingOnboarding', userId], false);
        }
        // If handoff failed, fall through to normal fetch — the dashboard's
        // recovery hook will handle it.
      }
      // If finalize failed or premium gate blocked, fall through to normal
      // fetch — the dashboard's recovery hook will handle retry/premium states.
    }

    // Critical sources: plan, progress — must all succeed for a
    // determined dashboard render. A failure here means the dashboard
    // cannot render without inventing data, so the gate shows the error
    // screen with retry.
    const criticalResults = await Promise.allSettled([
      queryClient.fetchQuery(planQueryOptions(userId)),
      queryClient.fetchQuery(progressQueryOptions(userId)),
    ]);

    // Non-critical sources: dueReviews, profile, RevenueCat, pendingOnboarding —
    // failures are tolerated. The dashboard can render with fallbacks:
    //   - dueReviews: shows 0 or a retry indicator
    //   - profile: RevenueCat fallback or default values
    //   - RevenueCat: profile.is_premium fallback
    //   - pendingOnboarding: dashboard recovery hook handles it
    // These are fetched in parallel and never block the gate.
    await Promise.allSettled([
      queryClient.fetchQuery(dueReviewsQueryOptions(userId)),
      queryClient.fetchQuery(profileQueryOptions(userId)),
      queryClient.fetchQuery(revenueCatCustomerInfoQueryOptions(userId)),
      queryClient.fetchQuery(pendingOnboardingQueryOptions(userId)),
    ]);

    // Check critical results — any rejection means global error.
    const criticalFailure = criticalResults.find(
      (r) => r.status === 'rejected',
    );
    if (criticalFailure) {
      return {
        status: 'error',
        error: criticalFailure.reason,
      };
    }

    return { status: 'ready' };
  } catch (error) {
    return { status: 'error', error };
  }
}
