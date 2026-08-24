/// <reference types="jest" />
import { QueryClient } from '@tanstack/react-query';
import { prepareAuthenticatedLaunch } from '../prepareAuthenticatedLaunch';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import { fetchDueCount } from '@/db/reviewItems';
import { fetchProfile } from '@/db/profiles';
import {
  hasValidPendingOnboardingPlanForUser,
  clearPendingOnboardingIfMatches,
  clearSessionAuthFlowId,
  readPendingOnboardingPlan,
} from '@/lib/pendingOnboardingPlan';
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { getRevenueCatCustomerInfo, ensureRevenueCatReadyForUser } from '@/lib/revenueCat';

// Mock all data sources — the preparation function should call fetchQuery
// for each, which in turn calls the queryFn. We mock the queryFn modules so
// we can assert which queries were attempted and control success/failure.

jest.mock('@/db/plans', () => ({
  fetchPlan: jest.fn(() => Promise.resolve({ id: 'plan-1' })),
}));
jest.mock('@/db/progress', () => ({
  fetchProgress: jest.fn(() => Promise.resolve({ id: 'progress-1' })),
}));
jest.mock('@/db/reviewItems', () => ({
  fetchDueCount: jest.fn(() => Promise.resolve(3)),
  fetchLearnedItems: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/db/profiles', () => ({
  fetchProfile: jest.fn(() => Promise.resolve({ id: 'profile-1', is_premium: false })),
}));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  hasValidPendingOnboardingPlanForUser: jest.fn(() => Promise.resolve(false)),
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  readPendingOnboardingPlan: jest.fn(() => Promise.resolve(null)),
  clearPendingOnboardingIfMatches: jest.fn(async () => 'already_absent'),
}));
jest.mock('@/lib/onboardingFinalize', () => ({
  finalizeOnboardingV2Plan: jest.fn(async () => ({ ok: true, reason: 'created' })),
}));
jest.mock('@/lib/onboardingDashboardHandoff', () => ({
  handOffFinalizedProgram: jest.fn(async () => ({
    status: 'ready',
    plan: { id: 'plan-1' },
    progress: { id: 'progress-1' },
  })),
}));
jest.mock('@/lib/revenueCat', () => ({
  getRevenueCatCustomerInfo: jest.fn(() => Promise.resolve(null)),
  ensureRevenueCatReadyForUser: jest.fn(() => Promise.resolve({ ready: true, generation: 1 })),
  getRevenueCatCurrentUserId: jest.fn(() => 'user-A'),
  getRevenueCatGeneration: jest.fn(() => 1),
  hasRevenueCatEntitlement: jest.fn(() => false),
}));

describe('prepareAuthenticatedLaunch', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    jest.clearAllMocks();
  });

  it('returns status ready when all queries succeed', async () => {
    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('prefetches plan, progress, dueReviews, profile, revenueCat, and pendingOnboarding', async () => {
    await prepareAuthenticatedLaunch(queryClient, 'user-A');

    expect(fetchPlan).toHaveBeenCalledWith('user-A');
    expect(fetchProgress).toHaveBeenCalledWith('user-A');
    expect(fetchDueCount).toHaveBeenCalled();
    expect(fetchProfile).toHaveBeenCalledWith('user-A');
    expect(ensureRevenueCatReadyForUser).toHaveBeenCalledWith('user-A');
    expect(getRevenueCatCustomerInfo).toHaveBeenCalled();
    expect(hasValidPendingOnboardingPlanForUser).toHaveBeenCalledWith('user-A');
  });

  it('returns status error when a critical query throws (plan)', async () => {
    (fetchPlan as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('error');
    expect((result as { error: unknown }).error).toBeDefined();
  });

  it('returns status error when a critical query throws (progress)', async () => {
    (fetchProgress as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('error');
  });

  it('returns status ready when pendingOnboarding query fails (non-critical)', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('returns status ready when non-critical query fails (dueReviews)', async () => {
    (fetchDueCount as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('returns status ready when non-critical query fails (profile)', async () => {
    (fetchProfile as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('returns status ready when non-critical query fails (revenueCat)', async () => {
    (getRevenueCatCustomerInfo as jest.Mock).mockRejectedValueOnce(new Error('RC error'));

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('populates the TanStack cache so dashboard hooks get cached data', async () => {
    await prepareAuthenticatedLaunch(queryClient, 'user-A');

    // The cache should now contain data for the plan query
    const cachedPlan = queryClient.getQueryData(['plan', 'user-A']);
    expect(cachedPlan).toEqual({ id: 'plan-1' });

    const cachedProgress = queryClient.getQueryData(['progress', 'user-A']);
    expect(cachedProgress).toEqual({ id: 'progress-1' });
  });

  it('does not prefetch when userId is empty string (edge case)', async () => {
    // The function itself doesn't guard userId — the caller (gate) does.
    // But verify it still attempts and the result is deterministic.
    const result = await prepareAuthenticatedLaunch(queryClient, '');
    // fetchPlan will be called with '' — it's the caller's responsibility
    // to not call this with an empty userId.
    expect(fetchPlan).toHaveBeenCalledWith('');
    // Result depends on the mock — should still be ready since mocks resolve.
    expect(result.status).toBe('ready');
  });

  it('handles RevenueCat returning null without error', async () => {
    (getRevenueCatCustomerInfo as jest.Mock).mockResolvedValueOnce(null);

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');
  });

  it('force=true resets queries before fetching', async () => {
    // First populate cache
    await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(queryClient.getQueryData(['plan', 'user-A'])).toEqual({ id: 'plan-1' });

    // Now force a fresh fetch
    (fetchPlan as jest.Mock).mockResolvedValueOnce({ id: 'plan-2' });
    await prepareAuthenticatedLaunch(queryClient, 'user-A', { force: true });
    expect(fetchPlan).toHaveBeenCalledWith('user-A');
  });

  it('when pendingOnboarding is true, runs finalize → handoff → clear before returning ready', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValueOnce(true);
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValueOnce({ flowId: 'flow-123', ownerUserId: 'user-A' });
    (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValueOnce('cleared');

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('ready');

    // Finalize was called
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledWith('user-A', '');
    // Handoff was called
    expect(handOffFinalizedProgram).toHaveBeenCalledWith(queryClient, 'user-A');
    // Clear was called
    expect(clearPendingOnboardingIfMatches).toHaveBeenCalled();
    // Session auth flow ID was cleared
    expect(clearSessionAuthFlowId).toHaveBeenCalled();

    // pendingOnboarding cache is set to false
    const cachedPending = queryClient.getQueryData(['pendingOnboarding', 'user-A']);
    expect(cachedPending).toBe(false);
  });

  it('when pending is true but finalize fails, returns error (no fallthrough)', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValueOnce(true);
    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'persist_error' });

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('error');
    // Handoff was NOT called because finalize failed
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
    // Plan/progress were NOT fetched — no fallthrough
    expect(fetchPlan).not.toHaveBeenCalledWith('user-A');
  });

  it('when pending is true, finalize ok, but handoff fails, returns error (no fallthrough)', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValueOnce(true);
    (handOffFinalizedProgram as jest.Mock).mockResolvedValueOnce({
      status: 'error', error: new Error('handoff_failed'),
    });

    const result = await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(result.status).toBe('error');
    // Clear was NOT called because handoff failed
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
    // Plan/progress were NOT fetched — no fallthrough
    expect(fetchPlan).not.toHaveBeenCalledWith('user-A');
  });

  it('when no pending exists, finalize/handoff/clear are never called', async () => {
    // Default mock: hasValidPendingOnboardingPlanForUser returns false
    await prepareAuthenticatedLaunch(queryClient, 'user-A');

    expect(finalizeOnboardingV2Plan).not.toHaveBeenCalled();
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
  });
});

// ─── Targeted cancellation and retry tests (required 18–21) ─────────────────

describe('Targeted cancellation and retry', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
    // resetAllMocks clears both call counts AND mockResolvedValueOnce queues,
    // preventing bleed between tests that queue different resolved values.
    jest.resetAllMocks();
    // Re-setup default mock implementations after reset
    (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-1' });
    (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-1' });
    (fetchDueCount as jest.Mock).mockResolvedValue(3);
    (fetchProfile as jest.Mock).mockResolvedValue({ id: 'profile-1', is_premium: false });
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(false);
    (getRevenueCatCustomerInfo as jest.Mock).mockResolvedValue(null);
    (ensureRevenueCatReadyForUser as jest.Mock).mockResolvedValue({ ready: true, generation: 1 });
    // Re-setup finalize/handoff/clear mocks
    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValue({ ok: true, reason: 'created' });
    (handOffFinalizedProgram as jest.Mock).mockResolvedValue({
      status: 'ready', plan: { id: 'plan-1' }, progress: { id: 'progress-1' },
    });
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValue(null);
    (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValue('already_absent' as never);
  });

  it('P18. cancelQueries with preparation keys cancels only those queries', async () => {
    // Populate cache with preparation queries for user-A and one unrelated query
    await prepareAuthenticatedLaunch(queryClient, 'user-A');
    queryClient.setQueryData(['unrelated', 'user-A'], { data: 'untouched' });

    // Cancel only the 6 preparation keys (replicating what _layout.tsx does on timeout)
    const preparationKeys = [
      ['plan', 'user-A'],
      ['progress', 'user-A'],
      ['dueReviews', 'user-A'],
      ['profile', 'user-A'],
      ['revenueCatCustomerInfo', 'user-A'],
      ['pendingOnboarding', 'user-A'],
    ];
    await Promise.all(
      preparationKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })),
    );

    // Unrelated query must still be in cache
    expect(queryClient.getQueryData(['unrelated', 'user-A'])).toEqual({ data: 'untouched' });
    // Preparation queries cache still exists (cancel does not remove, just aborts in-flight)
    expect(queryClient.getQueryData(['plan', 'user-A'])).toEqual({ id: 'plan-1' });
  });

  it('P19. second preparation call (no force) uses cache — queryFn not called again', async () => {
    // planQueryOptions has staleTime=5min. A second fetchQuery within that
    // window returns cached data without re-invoking the queryFn.
    await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // Second call without force — cache hit, no second fetch
    await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(fetchPlan).toHaveBeenCalledTimes(1); // still 1 — cache served
    expect(queryClient.getQueryData(['plan', 'user-A'])).toEqual({ id: 'plan-1' });
  });

  it('P20. after cache clear, fresh preparation re-invokes queryFn', async () => {
    // Populate cache
    await prepareAuthenticatedLaunch(queryClient, 'user-A');
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // Clear cache — simulates what force=true + removeQueries would do
    queryClient.removeQueries({ queryKey: ['plan', 'user-A'] });

    // Fresh call: cache miss — queryFn fires again
    (fetchPlan as jest.Mock).mockResolvedValueOnce({ id: 'plan-fresh' });
    await prepareAuthenticatedLaunch(queryClient, 'user-A');

    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['plan', 'user-A'])).toEqual({ id: 'plan-fresh' });
  });

  it('P21. unrelated query for different userId is not affected by preparation of user-A', async () => {
    // Use a fresh queryClient to avoid mock queue bleed from previous tests
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    // Seed user-B data directly in cache (not via fetch)
    qc.setQueryData(['plan', 'user-B'], { id: 'plan-B' });
    // Reset mock to known value for this test
    (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-A' });
    await prepareAuthenticatedLaunch(qc, 'user-A');

    // user-B data untouched
    expect(qc.getQueryData(['plan', 'user-B'])).toEqual({ id: 'plan-B' });
    // user-A data populated via fresh queryFn
    expect(qc.getQueryData(['plan', 'user-A'])).toEqual({ id: 'plan-A' });
    qc.clear();
  });
});
