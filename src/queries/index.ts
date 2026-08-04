import { UseQueryOptions } from '@tanstack/react-query';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import { fetchDueCount, fetchLearnedItems } from '@/db/reviewItems';
import { fetchProfile } from '@/db/profiles';
import { hasValidPendingOnboardingPlanForUser } from '@/lib/pendingOnboardingPlan';
import { getRevenueCatCustomerInfo, ensureRevenueCatReadyForUser, getRevenueCatCurrentUserId, getRevenueCatGeneration, CustomerInfo } from '@/lib/revenueCat';

// ─── Date helpers (must match useDueReviews exactly) ────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMidnightISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── Query options for dashboard warm-up ─────────────────────────────────────
// These functions return the exact same queryKey/queryFn as the hooks
// to ensure prefetch populates the same cache that useQuery will consume.

export function planQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['plan', userId],
    queryFn: () => fetchPlan(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function progressQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['progress', userId],
    queryFn: () => fetchProgress(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function dueReviewsQueryOptions(userId: string | undefined): UseQueryOptions {
  const today = localDateStr();
  const startTodayISO = localMidnightISO();

  return {
    queryKey: ['dueReviews', userId, today],
    queryFn: () => fetchDueCount(userId!, today, startTodayISO),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function profileQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  };
}

export function learnedItemsQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['learnedItems', userId],
    queryFn: () => fetchLearnedItems(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

// ─── Pending onboarding-v2 status ──────────────────────────────────────────
// userId-aware: the queryFn validates that the pending payload's ownerUserId
// is either null (unclaimed, pre-auth) or matches the given userId. This
// prevents cross-account leakage when a user switch occurs without an
// explicit clear (e.g. session expiry without logout).
//
// staleTime: Infinity — the query is only refetched on explicit invalidation
// (after finalization in useOnboardingV2AuthFinalize, or after a user switch
// clears the cache). This avoids a redundant AsyncStorage read on every
// dashboard mount/re-focus.
export function pendingOnboardingQueryOptions(userId: string | undefined): UseQueryOptions<boolean> {
  return {
    queryKey: ['pendingOnboarding', userId],
    queryFn: () => hasValidPendingOnboardingPlanForUser(userId!),
    enabled: !!userId,
    staleTime: Infinity,
  };
}

// ─── RevenueCat customer info ──────────────────────────────────────────────
// Shared between the boot pipeline (prepareAuthenticatedLaunch) and
// useZainlyPlusAccess so both use the exact same cache entry.
// The queryFn ensures RevenueCat is identified for the exact userId before
// fetching customer info — a late response from a previous user's identity
// can never populate this cache entry.
export function revenueCatCustomerInfoQueryOptions(userId: string | undefined): UseQueryOptions<CustomerInfo | null> {
  return {
    queryKey: ['revenueCatCustomerInfo', userId],
    queryFn: async () => {
      if (!userId) return null;
      // Step 1: ensure RevenueCat is identified for this userId.
      const { ready, generation } = await ensureRevenueCatReadyForUser(userId);
      if (!ready) return null;
      // Step 2: fetch CustomerInfo.
      const info = await getRevenueCatCustomerInfo();
      // Step 3: verify identity hasn't changed during the fetch.
      // If another identity switch happened (e.g. user B logged in while
      // A's CustomerInfo was still being fetched), reject the result.
      if (getRevenueCatGeneration() !== generation) return null;
      if (getRevenueCatCurrentUserId() !== userId) return null;
      return info;
    },
    enabled: !!userId,
    staleTime: 60_000,
  };
}
