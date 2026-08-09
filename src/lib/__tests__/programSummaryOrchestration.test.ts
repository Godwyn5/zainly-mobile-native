/// <reference types="jest" />
import { QueryClient } from '@tanstack/react-query';
import { orchestrateAuthedFinalize } from '../programSummaryOrchestration';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';

jest.mock('@/lib/onboardingFinalize', () => ({
  finalizeOnboardingV2PlanWithPremiumGate: jest.fn(),
}));
jest.mock('@/lib/onboardingDashboardHandoff', () => ({
  handOffFinalizedProgram: jest.fn(),
}));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  clearPendingOnboardingForUser: jest.fn(async () => {}),
}));

const mockFinalize = finalizeOnboardingV2PlanWithPremiumGate as jest.Mock;
const mockHandoff = handOffFinalizedProgram as jest.Mock;

const USER_A = 'user-aaa';
const PLAN_A = { id: 'plan-A', user_id: USER_A };
const PROGRESS_A = { user_id: USER_A };

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function makeDeps(overrides: {
  getSessionUserId?: () => string | undefined;
  invalidateNonCritical?: jest.Mock;
  clearPending?: jest.Mock;
} = {}) {
  return {
    finalizeWithPremiumGate: mockFinalize,
    handoff: mockHandoff,
    getSessionUserId: overrides.getSessionUserId ?? (() => USER_A),
    invalidateNonCritical: overrides.invalidateNonCritical ?? jest.fn(),
    clearPending: overrides.clearPending ?? jest.fn(async () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('orchestrateAuthedFinalize', () => {
  it('navigates on full success (finalize ok + handoff ready)', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({
      status: 'ok',
      finalize: { ok: true },
    });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });
    const invalidateNonCritical = jest.fn();
    const clearPending = jest.fn(async () => {});

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps({ invalidateNonCritical, clearPending }));

    expect(result.status).toBe('navigate');
    expect(clearPending).toHaveBeenCalledWith(USER_A);
    expect(invalidateNonCritical).toHaveBeenCalledWith(client, USER_A);
  });

  it('does not navigate when finalize fails', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({
      status: 'ok',
      finalize: { ok: false, message: 'DB write failed' },
    });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps());

    expect(result.status).toBe('finalize_failed');
    expect(result).toMatchObject({ message: 'DB write failed' });
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it('does not navigate when premium sync fails', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'premium_sync_failed' });

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps());

    expect(result.status).toBe('premium_sync_failed');
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it('does not navigate when premium entitlement is missing', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'premium_entitlement_missing' });

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps());

    expect(result.status).toBe('premium_entitlement_missing');
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it('aborts without navigating if session changes during finalize', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });

    let currentSession = USER_A;
    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps({
      getSessionUserId: () => currentSession }));
    expect(result.status).toBe('navigate');

    // Now simulate session change — session check after finalize catches it
    // before handoff is ever called.
    jest.clearAllMocks();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    currentSession = 'user-bbb';

    const result2 = await orchestrateAuthedFinalize(client, USER_A, makeDeps({
      getSessionUserId: () => currentSession,
    }));

    expect(result2.status).toBe('session_changed');
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it('aborts without navigating if session changes during handoff (after finalize ok)', async () => {
    const client = freshClient();
    mockHandoff.mockResolvedValue({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });

    let currentSession = USER_A;
    // Finalize succeeds, then handoff succeeds, but session changes
    // during the handoff await — the post-handoff session check catches it.
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    mockHandoff.mockImplementationOnce(async () => {
      currentSession = 'user-bbb';
      return { status: 'ready', plan: PLAN_A, progress: PROGRESS_A };
    });

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps({
      getSessionUserId: () => currentSession,
    }));

    expect(result.status).toBe('session_changed');
    // Handoff was called (first session check passed), but no navigation
    expect(mockHandoff).toHaveBeenCalled();
  });

  it('does not navigate when handoff fails', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    mockHandoff.mockResolvedValue({ status: 'error', error: new Error('network') });
    const invalidateNonCritical = jest.fn();
    const clearPending = jest.fn(async () => {});

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps({ invalidateNonCritical, clearPending }));

    expect(result.status).toBe('handoff_failed');
    expect(invalidateNonCritical).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
  });

  it('a retry after durable finalization but handoff failure succeeds on second call', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    mockHandoff
      .mockResolvedValueOnce({ status: 'error', error: new Error('network') })
      .mockResolvedValueOnce({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });

    const first = await orchestrateAuthedFinalize(client, USER_A, makeDeps());
    expect(first.status).toBe('handoff_failed');

    const second = await orchestrateAuthedFinalize(client, USER_A, makeDeps());
    expect(second.status).toBe('navigate');
  });

  it('calls invalidateNonCritical exactly once on success, never on failure', async () => {
    const client = freshClient();
    const invalidateNonCritical = jest.fn();

    // Failure path
    mockFinalize.mockResolvedValueOnce({ status: 'ok', finalize: { ok: false } });
    await orchestrateAuthedFinalize(client, USER_A, makeDeps({ invalidateNonCritical }));
    expect(invalidateNonCritical).not.toHaveBeenCalled();

    // Success path
    mockFinalize.mockResolvedValueOnce({ status: 'ok', finalize: { ok: true } });
    mockHandoff.mockResolvedValueOnce({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });
    await orchestrateAuthedFinalize(client, USER_A, makeDeps({ invalidateNonCritical }));
    expect(invalidateNonCritical).toHaveBeenCalledTimes(1);
  });

  it('clearPending is called with the correct userId, never a different user', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: PLAN_A, progress: PROGRESS_A });
    const clearPending = jest.fn(async () => {});

    await orchestrateAuthedFinalize(client, USER_A, makeDeps({ clearPending }));

    expect(clearPending).toHaveBeenCalledWith(USER_A);
    expect(clearPending).not.toHaveBeenCalledWith('user-bbb');
  });

  it('session change after handoff but before clearPending → session_changed, no clearPending', async () => {
    const client = freshClient();
    mockFinalize.mockResolvedValue({ status: 'ok', finalize: { ok: true } });
    const clearPending = jest.fn(async () => {});

    let currentSession = USER_A;
    // Handoff succeeds, but changes session during its await
    mockHandoff.mockImplementationOnce(async () => {
      currentSession = 'user-bbb';
      return { status: 'ready', plan: PLAN_A, progress: PROGRESS_A };
    });

    const result = await orchestrateAuthedFinalize(client, USER_A, makeDeps({
      getSessionUserId: () => currentSession,
      clearPending,
    }));

    expect(result.status).toBe('session_changed');
    expect(clearPending).not.toHaveBeenCalled();
  });
});
