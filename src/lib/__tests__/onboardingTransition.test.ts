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
  getLeaseSnapshot,
  type SignupVisualSnapshot,
} from '../transitionLease';
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import {
  clearPendingOnboardingIfMatches,
  clearSessionAuthFlowId,
  saveCompletedAuthProof,
} from '@/lib/pendingOnboardingPlan';

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
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  setSessionAuthFlowId: jest.fn(),
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  readPendingOnboardingPlan: jest.fn(async () => ({ flowId: 'flow-123', ownerUserId: 'user-A' })),
  clearPendingOnboardingIfMatches: jest.fn(async () => 'cleared'),
  saveCompletedAuthProof: jest.fn(async () => {}),
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

  const VISUAL: SignupVisualSnapshot = {
    surfaceType: 'signup',
    email: 'test@test.com',
    password: 'pass123',
    confirm: 'pass123',
    showPw: false,
    showConfirm: false,
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    jest.clearAllMocks();
    forceReleaseTransitionLease();
  });

  afterEach(() => {
    forceReleaseTransitionLease();
  });

  it('beginOnboardingTransition without visual leaves the ACTIVE snapshot visual null (login path unchanged)', () => {
    beginOnboardingTransition('flow-123');
    expect(getLeaseSnapshot().phase).toBe('active');
    expect(getLeaseSnapshot().visual).toBeNull();
  });

  it('beginOnboardingTransition with visual populates the ACTIVE snapshot immediately — the cover overlay can already mount before signUp/signIn resolves, before any route swap', () => {
    beginOnboardingTransition('flow-123', VISUAL);
    const snapshot = getLeaseSnapshot();
    expect(snapshot.phase).toBe('active');
    expect(snapshot.visual).toEqual(VISUAL);
    expect(getActiveTransitionLeaseFlowId()).toBe('flow-123');
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

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('success');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(clearSessionAuthFlowId).toHaveBeenCalled();
    expect(clearPendingOnboardingIfMatches).toHaveBeenCalledWith('user-A', 'flow-123');
    // Lease transitioned atomically to data_ready_covered
    const snapshot = getLeaseSnapshot();
    expect(snapshot.phase).toBe('data_ready_covered');
    expect(snapshot.userId).toBe('user-A');
    expect(snapshot.flowId).toBe('flow-123');
    expect(snapshot.cacheVerified).toBe(true);
    expect(snapshot.sessionGen).toBe('gen-1');
    expect(snapshot.visual).toEqual(VISUAL);
  });

  it('returns error when finalize fails (ok: false)', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValueOnce({
      ok: false, reason: 'persist_error', message: 'DB error'
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('finalize_error');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
    // No verified handoff on error — phase is idle, not data_ready_covered
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('returns error when handoff fails', async () => {
    const leaseId = await setupLease('flow-123');
    (handOffFinalizedProgram as jest.Mock).mockResolvedValueOnce({
      status: 'error',
      error: new Error('network'),
    });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('handoff_error');
    expect(hasActiveTransitionLease()).toBe(false);
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
  });

  it('returns proof_persist_failed when saveCompletedAuthProof throws — pending NOT cleared, lease released', async () => {
    const leaseId = await setupLease('flow-123');
    queryClient.setQueryData(['plan', 'user-A'], { id: 'plan-1' });
    queryClient.setQueryData(['progress', 'user-A'], { id: 'progress-1' });

    // Inject proof persistence failure
    (saveCompletedAuthProof as jest.Mock).mockRejectedValueOnce(new Error('Storage write failed'));

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('proof_persist_failed');
    // Lease is released
    expect(hasActiveTransitionLease()).toBe(false);
    // Pending payload is NOT cleared — recovery state preserved
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
  });

  it('returns error when clear returns superseded', async () => {
    const leaseId = await setupLease('flow-123');
    (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValueOnce('superseded');

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('clear_superseded');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('returns error when cache verification fails (plan missing)', async () => {
    const leaseId = await setupLease('flow-123');
    // Don't populate plan cache — only progress
    queryClient.setQueryData(['progress', 'user-A'], { id: 'progress-1' });

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
    expect(result.status).toBe('error');
    expect((result as { error: { kind: string } }).error.kind).toBe('cache_verification_failed');
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('releases the lease even when an unexpected exception occurs', async () => {
    const leaseId = await setupLease('flow-123');
    (finalizeOnboardingV2Plan as jest.Mock).mockRejectedValueOnce(
      new Error('unexpected'),
    );

    const result = await runOnboardingTransition(queryClient, 'user-A', leaseId, 'gen-1', VISUAL);
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
