// ─── prepareAuthenticatedLaunch ─────────────────────────────────────────────
// Pure function that prefetches all dashboard-critical queries for a given
// userId into the TanStack Query cache. Called by the root layout gate before
// releasing the Stack for an authenticated user.
//
// All queries use the exact same queryKey/queryFn as the dashboard hooks,
// ensuring the cache populated here is consumed directly by useQuery calls
// in the dashboard — no duplicate fetch, no skeleton.
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

    // Critical sources: plan, progress, pending — must all succeed for a
    // determined dashboard render. A failure here means the dashboard
    // cannot render without inventing data, so the gate shows the error
    // screen with retry.
    const criticalResults = await Promise.allSettled([
      queryClient.fetchQuery(planQueryOptions(userId)),
      queryClient.fetchQuery(progressQueryOptions(userId)),
      queryClient.fetchQuery(pendingOnboardingQueryOptions(userId)),
    ]);

    // Non-critical sources: dueReviews, profile, RevenueCat — failures
    // are tolerated. The dashboard can render with fallbacks:
    //   - dueReviews: shows 0 or a retry indicator
    //   - profile: RevenueCat fallback or default values
    //   - RevenueCat: profile.is_premium fallback
    // These are fetched in parallel and never block the gate.
    await Promise.allSettled([
      queryClient.fetchQuery(dueReviewsQueryOptions(userId)),
      queryClient.fetchQuery(profileQueryOptions(userId)),
      queryClient.fetchQuery(revenueCatCustomerInfoQueryOptions(userId)),
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
