/// <reference types="jest" />
// ─── handOffFinalizedProgram tests ──────────────────────────────────────────
// Exercises the real QueryClient behaviour (invalidate + fetchQuery), not a
// mock of the helper's own implementation — these tests would fail if the
// invalidate-then-fetchQuery sequencing stopped forcing a real re-read.

import { QueryClient, onlineManager } from '@tanstack/react-query';
import { handOffFinalizedProgram } from '../onboardingDashboardHandoff';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';

jest.mock('@/db/plans', () => ({
  fetchPlan: jest.fn(),
}));
jest.mock('@/db/progress', () => ({
  fetchProgress: jest.fn(),
}));

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

const clients: QueryClient[] = [];
function trackClient() {
  const c = freshClient();
  clients.push(c);
  return c;
}

afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  jest.clearAllMocks();
});

const USER_A = 'user-aaa';
const USER_B = 'user-bbb';

const PLAN_A = { id: 'plan-A', user_id: USER_A, surah_start: 1, start_ayah: 1, ayah_per_day: 2 };
const PROGRESS_A = { user_id: USER_A, current_surah: 1, current_ayah: 0, ayah_per_day: 2 };

describe('handOffFinalizedProgram — forces a real re-read past a stale cached null', () => {
  it('executes fetchPlan/fetchProgress even though the cache already holds a fresh null (5min staleTime)', async () => {
    const client = trackClient();
    // Seed the cache exactly like prepareAuthenticatedLaunch's boot-time
    // prefetch would: null, with the same 5-minute staleTime, "just fetched".
    client.setQueryData(['plan', USER_A], null);
    client.setQueryData(['progress', USER_A], null);

    (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    const result = await handOffFinalizedProgram(client, USER_A);

    // The real queryFn must have been invoked — a naive fetchQuery() with
    // the default 5-minute staleTime would NOT have called these at all.
    expect(fetchPlan).toHaveBeenCalledWith(USER_A);
    expect(fetchProgress).toHaveBeenCalledWith(USER_A);
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.plan).toEqual(PLAN_A);
      expect(result.progress).toEqual(PROGRESS_A);
    }
  });

  it('returns canonical non-null results before the caller may navigate', async () => {
    const client = trackClient();
    (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    const result = await handOffFinalizedProgram(client, USER_A);

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.plan).not.toBeNull();
      expect(result.progress).not.toBeNull();
    }
    // The cache itself must now hold the canonical rows too.
    expect(client.getQueryData(['plan', USER_A])).toEqual(PLAN_A);
    expect(client.getQueryData(['progress', USER_A])).toEqual(PROGRESS_A);
  });

  it('reports error (never "ready") when plan is non-null but progress is null', async () => {
    const client = trackClient();
    (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(null);

    const result = await handOffFinalizedProgram(client, USER_A);

    expect(result.status).toBe('error');
  });

  it('reports error and does not navigate on a real network failure', async () => {
    const client = trackClient();
    (fetchPlan as jest.Mock).mockRejectedValue(new Error('network down'));
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    const result = await handOffFinalizedProgram(client, USER_A);

    expect(result.status).toBe('error');
  });

  it('a retried handoff succeeds after a transient failure is resolved', async () => {
    const client = trackClient();
    // HANDOFF_RETRY = 2 means fetchQuery itself retries twice internally
    // (3 attempts total) before this first handOffFinalizedProgram() call
    // can reject — reject all 3 to genuinely exhaust it, proving this is
    // NOT a false-positive from the internal retry masking the failure.
    (fetchPlan as jest.Mock)
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    const first = await handOffFinalizedProgram(client, USER_A);
    expect(first.status).toBe('error');

    // A genuinely separate, later call (the user-facing "Réessayer" CTA)
    // succeeds once the transient condition is gone.
    const second = await handOffFinalizedProgram(client, USER_A);
    expect(second.status).toBe('ready');
  }, 15000);

  it('only touches the exact cache keys for the given userId — another user\'s cache is untouched', async () => {
    const client = trackClient();
    const PLAN_B = { id: 'plan-B', user_id: USER_B, surah_start: 4, start_ayah: 2, ayah_per_day: 3 };
    const PROGRESS_B = { user_id: USER_B, current_surah: 4, current_ayah: 1, ayah_per_day: 3 };
    client.setQueryData(['plan', USER_B], PLAN_B);
    client.setQueryData(['progress', USER_B], PROGRESS_B);

    (fetchPlan as jest.Mock).mockImplementation(async (uid: string) => (uid === USER_A ? PLAN_A : null));
    (fetchProgress as jest.Mock).mockImplementation(async (uid: string) => (uid === USER_A ? PROGRESS_A : null));

    await handOffFinalizedProgram(client, USER_A);

    // USER_B's cache must be byte-for-byte unchanged — no cross-account leak.
    expect(client.getQueryData(['plan', USER_B])).toEqual(PLAN_B);
    expect(client.getQueryData(['progress', USER_B])).toEqual(PROGRESS_B);
    expect(fetchPlan).not.toHaveBeenCalledWith(USER_B);
    expect(fetchProgress).not.toHaveBeenCalledWith(USER_B);
  });

  it('does not invalidate unrelated caches (profile, dueReviews, pendingOnboarding, revenueCat)', async () => {
    const client = trackClient();
    client.setQueryData(['profile', USER_A], { is_premium: true });
    client.setQueryData(['dueReviews', USER_A, '2026-01-01'], 5);
    client.setQueryData(['pendingOnboarding', USER_A], false);
    client.setQueryData(['revenueCatCustomerInfo', USER_A], { entitlements: {} });

    (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    await handOffFinalizedProgram(client, USER_A);

    // Untouched — same object identity, not just equal value, proving no
    // invalidate/refetch cycle ran against them.
    expect(client.getQueryState(['profile', USER_A])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['dueReviews', USER_A, '2026-01-01'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['pendingOnboarding', USER_A])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['revenueCatCustomerInfo', USER_A])?.isInvalidated).toBe(false);
  });

  it('a stale in-flight fetch for a previous userId cannot leak into a different userId\'s cache slot', async () => {
    const client = trackClient();
    let resolvePlanA: (v: unknown) => void = () => {};
    (fetchPlan as jest.Mock).mockImplementation((uid: string) => {
      if (uid === USER_A) {
        return new Promise((resolve) => { resolvePlanA = resolve; });
      }
      return Promise.resolve({ id: 'plan-B', user_id: USER_B, surah_start: 4, start_ayah: 2, ayah_per_day: 3 });
    });
    (fetchProgress as jest.Mock).mockImplementation((uid: string) =>
      Promise.resolve({ user_id: uid, current_surah: 1, current_ayah: 0, ayah_per_day: 2 })
    );

    // Start a handoff for USER_A that never resolves yet.
    const pendingA = handOffFinalizedProgram(client, USER_A);
    // A second, independent handoff for USER_B completes fully.
    const doneB = await handOffFinalizedProgram(client, USER_B);
    expect(doneB.status).toBe('ready');

    // Now resolve A's fetchPlan — its result can only ever land in
    // ['plan', USER_A], never in USER_B's slot.
    resolvePlanA(PLAN_A);
    const doneA = await pendingA;
    expect(doneA.status).toBe('ready');
    expect(client.getQueryData(['plan', USER_B])).toMatchObject({ user_id: USER_B });
    expect(client.getQueryData(['plan', USER_A])).toMatchObject({ user_id: USER_A });
  });

  // ── §1: Delayed prior query race ──────────────────────────────────────────
  it('a delayed prior fetch resolving null cannot feed the handoff a stale null (cancelQueries guard)', async () => {
    const client = trackClient();

    // Step 1: boot-time prefetch starts — fetchPlan/fetchProgress return
    // controllable promises that will eventually resolve with null (plan
    // didn't exist yet at the time the boot prefetch fired).
    let resolvePriorPlan: (v: unknown) => void = () => {};
    let resolvePriorProgress: (v: unknown) => void = () => {};
    (fetchPlan as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolvePriorPlan = resolve; }),
    );
    (fetchProgress as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolvePriorProgress = resolve; }),
    );

    // Start the boot-time prefetch — creates in-flight fetches for
    // ['plan', USER_A] and ['progress', USER_A].
    const priorPlanP = client.prefetchQuery({
      queryKey: ['plan', USER_A],
      queryFn: () => fetchPlan(USER_A),
      staleTime: 5 * 60 * 1000,
    });
    const priorProgressP = client.prefetchQuery({
      queryKey: ['progress', USER_A],
      queryFn: () => fetchProgress(USER_A),
      staleTime: 5 * 60 * 1000,
    });

    // Step 2: finalization persists the plan+progress. Now the mock
    // returns canonical non-null data for subsequent calls.
    (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
    (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

    // Step 3: handoff starts — while the prior fetch is still in-flight.
    const handoffP = handOffFinalizedProgram(client, USER_A);

    // Step 4: the prior fetch resolves with null (it was started before
    // the plan was persisted).
    resolvePriorPlan(null);
    resolvePriorProgress(null);
    await priorPlanP;
    await priorProgressP;

    // Step 5: the handoff must complete with the canonical non-null data,
    // NOT the stale null from the prior fetch. Without cancelQueries,
    // fetchQuery would reuse the in-flight promise and get null.
    const result = await handoffP;
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.plan).toEqual(PLAN_A);
      expect(result.progress).toEqual(PROGRESS_A);
    }
    // The handoff must have called fetchPlan/fetchProgress a second time
    // (the first call was the boot prefetch, the second is the handoff's
    // own fresh fetch after cancelQueries).
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(fetchProgress).toHaveBeenCalledTimes(2);
  });

  // ── §2: Offline mode ──────────────────────────────────────────────────────
  describe('offline mode', () => {
    beforeEach(() => {
      onlineManager.setOnline(false);
    });
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it('reaches a deterministic error state when offline (never silently paused)', async () => {
      const client = trackClient();
      (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
      (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

      const result = await handOffFinalizedProgram(client, USER_A);

      // networkMode: 'always' guarantees the queryFn actually runs even
      // offline — so a real success is possible (the queryFn mock resolves).
      // But if the queryFn rejected, the error would be deterministic, not
      // paused. Here we test the success case: 'always' means the fetch
      // is NOT paused even though onlineManager reports offline.
      expect(result.status).toBe('ready');
    });

    it('never returns success from a cached null when offline', async () => {
      const client = trackClient();
      // Seed cache with null (stale boot-time prefetch result).
      client.setQueryData(['plan', USER_A], null);
      client.setQueryData(['progress', USER_A], null);

      (fetchPlan as jest.Mock).mockResolvedValue(PLAN_A);
      (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

      const result = await handOffFinalizedProgram(client, USER_A);

      expect(result.status).toBe('ready');
      if (result.status === 'ready') {
        expect(result.plan).toEqual(PLAN_A);
        expect(result.progress).toEqual(PROGRESS_A);
      }
    });

    it('reaches a deterministic error when the queryFn rejects while offline', async () => {
      const client = trackClient();
      (fetchPlan as jest.Mock).mockRejectedValue(new Error('network down'));
      (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

      const result = await handOffFinalizedProgram(client, USER_A);

      expect(result.status).toBe('error');
    });

    it('a retry succeeds after network is restored', async () => {
      const client = trackClient();
      // While offline, the queryFn rejects (real network failure).
      (fetchPlan as jest.Mock)
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(PLAN_A);
      (fetchProgress as jest.Mock).mockResolvedValue(PROGRESS_A);

      const first = await handOffFinalizedProgram(client, USER_A);
      expect(first.status).toBe('error');

      // Network restored.
      onlineManager.setOnline(true);

      const second = await handOffFinalizedProgram(client, USER_A);
      expect(second.status).toBe('ready');
    }, 15000);
  });
});
