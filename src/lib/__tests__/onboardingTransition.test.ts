/// <reference types="jest" />
import { QueryClient } from '@tanstack/react-query';
import {
  runOnboardingTransition,
  beginOnboardingTransition,
  setTransitionUserId,
} from '../onboardingTransition';
import {
  forceReleaseTransitionLease,
  hasActiveTransitionLease,
  getActiveTransitionLeaseFlowId,
  consumeVerifiedHandoff,
  clearVerifiedHandoff,
} from '../transitionLease';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  clearPendingOnboardingIfMatches,
  clearSessionAuthFlowId,
} from '@/lib/pendingOnboardingPlan';

jest.mock('@/lib/onboardingFinalize', () => ({
  finalizeOnboardingV2PlanWithPremiumGate: jest.fn(async () => ({
    status: 'finalized',
    finalize: { ok: true, reason: 'created' },
  })),
}));
jest.mock('@/lib/onboardingDashboardHandoff', () => ({
  handOffFinalizedProgram: jest.fn(async () => ({
    status: 'ready',
    plan: { id: 'plan-1' },
    progress: { id: 'progress-1' },
  })),
}));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  setSessionAuthFlowId: jest.fn(),
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  readPendingOnboardingPlan: jest.fn(async () => ({ flowId: 'flow-123', ownerUserId: 'user-A' })),
  clearPendingOnboardingIfMatches: jest.fn(async () => 'cleared'),
}));
jest.mock('@/db/plans', () => ({
  fetchPlan: jest.fn(async () => ({ id: 'plan-1' })),
}));
jest.mock('@/db/progress', () => ({
  fetchProgress: jest.fn(async () => ({ id: 'progress-1' })),
}));
jest.mock('@/queries', () => ({
  planQueryOptions: (userId: string) => ({ queryKey: ['plan', userId], queryFn: jest.fn(), enabled: !!userId }),
  progressQueryOptions: (userId: string) => ({ queryKey: ['progress', userId], queryFn: jest.fn(), enabled: !!userId }),
}));

describe('runOnboardingTransition', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    jest.clearAllMocks();
    forceReleaseTransitionLease();
  });

  afterEach(() => {
    forceReleaseTransitionLease();
    clearVerifiedHandoff();
  });

  async function setupLease(flowId: string): Promise<string> {
    const leaseId = beginOnboardingTransition(flowId);
    setTransitionUserId('user-A');
    return leaseId;
  }

  it('returns success when finalize → handoff → clear all succeed, and sets verified handoff', async () => {
    const leaseId = await setupLease('flow-123');
    // Pre-populate cache as handoff would
    queryClient.setQueryData(['plan', 'user-A'], { id: 'plan-1' });
    queryClient.setQueryData(['progress', 'user-A'], { id: 'progress-1' });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('success');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(clearSessionAuthFlowId).toHaveBeenCalled();
    expect(clearPendingOnboardingIfMatches).toHaveBeenCalledWith('user-A', 'flow-123');
    // Verified handoff was set and can be consumed
    const handoff = consumeVerifiedHandoff('user-A');
    expect(handoff).not.toBeNull();
    expect(handoff!.userId).toBe('user-A');
    expect(handoff!.flowId).toBe('flow-123');
  });

  it('returns error when finalize fails (ok: false)', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockResolvedValueOnce({
      status: 'finalized',
      finalize: { ok: false, reason: 'persist_error', message: 'DB error' },
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('finalize_error');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
    // No verified handoff on error
    expect(consumeVerifiedHandoff('user-A')).toBeNull();
  });

  it('returns error when premium entitlement is missing', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockResolvedValueOnce({
      status: 'premium_entitlement_missing',
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('premium_entitlement_missing');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('returns error when premium sync fails', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockResolvedValueOnce({
      status: 'premium_sync_failed',
      reason: 'configure_failed',
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('premium_sync_failed');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('returns error when handoff fails', async () => {
    const leaseId = await setupLease('flow-123');
    (handOffFinalizedProgram as jest.Mock).mockResolvedValueOnce({
      status: 'error',
      error: new Error('network'),
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('handoff_error');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
  });

  it('returns error when clear returns superseded', async () => {
    const leaseId = await setupLease('flow-123');
    (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValueOnce('superseded');

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('clear_superseded');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('returns error when cache verification fails (plan missing)', async () => {
    const leaseId = await setupLease('flow-123');
    // Don't populate plan cache — only progress
    queryClient.setQueryData(['progress', 'user-A'], { id: 'progress-1' });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('cache_verification_failed');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('releases the lease even when an unexpected exception occurs', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockRejectedValueOnce(
      new Error('unexpected'),
    );

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId);
    expect(result.status).toBe('error');
    expect(hasActiveTransitionLease()).toBe(false);
  });
});

describe('beginOnboardingTransition', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
  });

  it('creates a lease and sets the session auth flow ID', () => {
    const leaseId = beginOnboardingTransition('flow-abc');
    expect(hasActiveTransitionLease()).toBe(true);
    expect(getActiveTransitionLeaseFlowId()).toBe('flow-abc');
    expect(leaseId).toContain('flow-abc');
  });
});
