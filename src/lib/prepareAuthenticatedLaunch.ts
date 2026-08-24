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
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  getSessionAuthFlowId,
  clearSessionAuthFlowId,
  readPendingOnboardingPlan,
  clearPendingOnboardingIfMatches,
} from '@/lib/pendingOnboardingPlan';

export type PrepareAuthenticatedLaunchResult =
  | { status: 'ready' }
  | { status: 'account_not_found' }
  | { status: 'error'; error: unknown };

// Query keys scoped to a single userId — every dashboard-critical and
// non-critical source prefetched by this module. Shared by the `force`
// reset below and by purgeUserScopedCaches so both stay in sync.
const USER_SCOPED_QUERY_PREFIXES = [
  'plan',
  'progress',
  'dueReviews',
  'profile',
  'revenueCatCustomerInfo',
  'pendingOnboarding',
] as const;

/**
 * Fully evicts (not just invalidates) every dashboard-critical and
 * non-critical query cached for this exact userId. Used by the
 * account_not_found fail-closed sign-out — purges only this user's
 * cached data, never a global queryClient.clear().
 */
export function purgeUserScopedCaches(queryClient: QueryClient, userId: string): void {
  for (const prefix of USER_SCOPED_QUERY_PREFIXES) {
    queryClient.removeQueries({ queryKey: [prefix, userId] });
  }
}

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
      for (const prefix of USER_SCOPED_QUERY_PREFIXES) {
        await queryClient.resetQueries({
          queryKey: [prefix, userId],
          type: 'active',
        }).catch(() => {});
      }
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
      const outcome = await finalizeOnboardingV2Plan(userId, authFlowId);

      if (outcome.ok) {
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
        } else {
          // Handoff failed — do NOT fall through to normal fetch. The plan
          // was persisted but the cache re-read failed. Return error so the
          // gate blocks the dashboard — the user can retry via the
          // preparation error screen, which re-triggers this function.
          return {
            status: 'error',
            error: new Error('handoff_failed'),
          };
        }
      } else if (!outcome.ok) {
        // Finalize failed (persist_error, no_source, etc.) — do NOT fall
        // through. Return error so the gate blocks the dashboard.
        return {
          status: 'error',
          error: new Error(`finalize_failed:${outcome.reason}`),
        };
      }
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

    // ── Typed launch decision ──────────────────────────────────────────
    //   - Both queries rejected → genuine network/RLS error → error screen
    //   - Both queries fulfilled, both null → no Zainly account recognized
    //     for this identity (no pending onboarding either, checked above)
    //     → account_not_found: the gate fails closed (local sign-out) and
    //     shows "Compte introuvable" on the auth screen
    //   - Both queries fulfilled, both non-null → complete program → ready
    //   - One null, one non-null → inconsistent state → error (partial data)
    //   - One rejected, one fulfilled → genuine error on the rejected query
    const criticalFailure = criticalResults.find(
      (r) => r.status === 'rejected',
    );
    if (criticalFailure) {
      return {
        status: 'error',
        error: criticalFailure.reason,
      };
    }

    const planData = (criticalResults[0] as PromiseFulfilledResult<unknown>).value;
    const progressData = (criticalResults[1] as PromiseFulfilledResult<unknown>).value;

    if (!planData && !progressData) {
      return { status: 'account_not_found' };
    }

    if (planData && progressData) {
      return { status: 'ready' };
    }

    // Inconsistent state — one exists but not the other
    return {
      status: 'error',
      error: new Error('inconsistent_state'),
    };
  } catch (error) {
    return { status: 'error', error };
  }
}
