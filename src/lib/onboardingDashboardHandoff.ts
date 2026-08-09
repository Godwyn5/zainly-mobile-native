// ─── handOffFinalizedProgram ────────────────────────────────────────────────
// Canonical cache handoff between a successful onboarding-v2 finalization
// (src/lib/onboardingFinalize.ts) and the dashboard's first render. Ensures
// `plan` and `progress` are non-null CANONICAL rows in the TanStack Query
// cache before the caller is allowed to navigate to / reveal the dashboard.
//
// Why a naive queryClient.fetchQuery(planQueryOptions(userId)) is NOT
// sufficient: fetchQuery only invokes the queryFn if the cached entry is
// stale (Query.isStaleByTime — see @tanstack/query-core queryClient.js).
// planQueryOptions/progressQueryOptions use a 5-minute staleTime — if the
// boot pipeline (prepareAuthenticatedLaunch) already cached `plan = null`
// moments earlier (the exact race this handoff exists to fix), a bare
// fetchQuery call would return that still-fresh `null` WITHOUT ever
// re-invoking fetchPlan/fetchProgress.
//
// Fix (per @tanstack/query-core 5.100.9 source, verified — see
// query.js: isStaleByTime() returns true unconditionally when
// state.isInvalidated is true, regardless of staleTime):
//   1. invalidateQueries({ queryKey: exact, exact: true, refetchType: 'none' })
//      on the two exact keys — this only flips Query.state.isInvalidated to
//      true; refetchType: 'none' guarantees no concurrent refetch is started
//      by this call itself (no race with the fetchQuery below).
//   2. fetchQuery(...) on the same two exact keys — isStaleByTime() now
//      returns true unconditionally (isInvalidated short-circuits before the
//      staleTime check), so the real fetchPlan/fetchProgress queryFn is
//      guaranteed to execute.
//
// Network behaviour: networkMode: 'always' is used for this specific
// re-read (overriding the queryClient's default 'online' mode). With the
// default mode, canFetch() returns false while offline and the retryer
// calls pause() — the fetchQuery promise then stays pending, invisibly,
// until connectivity returns (see @tanstack/query-core retryer.js). A
// handoff blocking dashboard reveal must never hang like that. 'always'
// makes canFetch() return true unconditionally, so the underlying Supabase
// call actually runs and a real network failure rejects the promise
// (after `HANDOFF_RETRY` bounded retries — never Infinity, never a silent
// timeout), which the caller can turn into a deterministic retry state.

import { QueryClient } from '@tanstack/react-query';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';

export type DashboardHandoffResult =
  | {
      status: 'ready';
      plan: NonNullable<Awaited<ReturnType<typeof fetchPlan>>>;
      progress: NonNullable<Awaited<ReturnType<typeof fetchProgress>>>;
    }
  | { status: 'error'; error: unknown };

// Bounded retry count for this specific, blocking re-read — never Infinity,
// never a silent timeout. A real outage must surface as a caught error the
// caller can offer a retry CTA for, not an indefinitely pending promise.
const HANDOFF_RETRY = 2;

export async function handOffFinalizedProgram(
  queryClient: QueryClient,
  userId: string,
): Promise<DashboardHandoffResult> {
  try {
    // Cancel any in-flight fetch on the two exact keys BEFORE invalidating.
    // Without this, query.fetch() (query.js:190-192) reuses the existing
    // retryer.promise when fetchStatus !== 'idle' and data === undefined,
    // returning a stale null from a boot-time prefetch that started before
    // finalization persisted the rows. cancelQueries sets fetchStatus to
    // 'idle' (query.js:384), so the subsequent fetchQuery starts a fresh
    // fetch that reads the post-finalization canonical rows.
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ['plan', userId], exact: true }),
      queryClient.cancelQueries({ queryKey: ['progress', userId], exact: true }),
    ]);

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['plan', userId],
        exact: true,
        refetchType: 'none',
      }),
      queryClient.invalidateQueries({
        queryKey: ['progress', userId],
        exact: true,
        refetchType: 'none',
      }),
    ]);

    const [plan, progress] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['plan', userId],
        queryFn: () => fetchPlan(userId),
        networkMode: 'always',
        retry: HANDOFF_RETRY,
      }),
      queryClient.fetchQuery({
        queryKey: ['progress', userId],
        queryFn: () => fetchProgress(userId),
        networkMode: 'always',
        retry: HANDOFF_RETRY,
      }),
    ]);

    // A finalize() that just resolved ok:true guarantees both rows were
    // persisted (see onboardingFinalize.ts's own post-write confirmation),
    // so null here means the re-read itself is unreliable (e.g. RLS/replica
    // lag) — never treat a null pair as a successful handoff.
    if (!plan || !progress) {
      return { status: 'error', error: new Error('handoff_missing_plan_or_progress') };
    }

    return { status: 'ready', plan, progress };
  } catch (error) {
    return { status: 'error', error };
  }
}
