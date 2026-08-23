/// <reference types="jest" />
// ─── Launch decision tests — all business states for prepareAuthenticatedLaunch ──
//
// Tests the typed launch decision that distinguishes:
//   - complete program (plan + progress) → ready
//   - new user (no plan, no progress) → needs_onboarding
//   - inconsistent state (one null, one non-null) → error
//   - genuine network error (query rejection) → error
//   - valid pending onboarding → finalize + handoff → ready
//
// Also tests the preparationStateMachine's needs_onboarding status to ensure
// the gate allows rendering and never shows an error screen for new users.

import { QueryClient } from '@tanstack/react-query';
import { prepareAuthenticatedLaunch } from '../prepareAuthenticatedLaunch';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import { fetchDueCount } from '@/db/reviewItems';
import { fetchProfile } from '@/db/profiles';
import {
  hasValidPendingOnboardingPlanForUser,
  clearPendingOnboardingIfMatches,
  readPendingOnboardingPlan,
} from '@/lib/pendingOnboardingPlan';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { getRevenueCatCustomerInfo, ensureRevenueCatReadyForUser } from '@/lib/revenueCat';
import {
  canRenderStackForUser,
  canRenderOnboardingStackForUser,
  shouldShowPreparationError,
  shouldShowCustomSplash,
  createAccountNotFoundState,
  createReadyState,
  createErrorState,
  createPreparingState,
} from '../preparationStateMachine';

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
  clearPendingOnboardingIfMatches: jest.fn(async () => 'already_absent' as never),
}));
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
jest.mock('@/lib/revenueCat', () => ({
  getRevenueCatCustomerInfo: jest.fn(() => Promise.resolve(null)),
  ensureRevenueCatReadyForUser: jest.fn(() => Promise.resolve({ ready: true, generation: 1 })),
  getRevenueCatCurrentUserId: jest.fn(() => 'user-A'),
  getRevenueCatGeneration: jest.fn(() => 1),
  hasRevenueCatEntitlement: jest.fn(() => false),
}));

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

const clients: QueryClient[] = [];
const trackClient = () => {
  const c = freshClient();
  clients.push(c);
  return c;
};

afterEach(() => {
  for (const c of clients) c.clear();
  clients.length = 0;
});

function setupDefaultMocks() {
  (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-1' });
  (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-1' });
  (fetchDueCount as jest.Mock).mockResolvedValue(3);
  (fetchProfile as jest.Mock).mockResolvedValue({ id: 'profile-1', is_premium: false });
  (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(false);
  (getRevenueCatCustomerInfo as jest.Mock).mockResolvedValue(null);
  (ensureRevenueCatReadyForUser as jest.Mock).mockResolvedValue({ ready: true, generation: 1 });
  (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockResolvedValue({
    status: 'finalized', finalize: { ok: true, reason: 'created' },
  });
  (handOffFinalizedProgram as jest.Mock).mockResolvedValue({
    status: 'ready', plan: { id: 'plan-1' }, progress: { id: 'progress-1' },
  });
  (readPendingOnboardingPlan as jest.Mock).mockResolvedValue(null);
  (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValue('already_absent' as never);
}

// ─── 1. Complete program → ready ─────────────────────────────────────────────

describe('Launch decision — complete program', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
  });

  it('both plan and progress present → status:ready', async () => {
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('ready');
  });

  it('ready result does not carry an error property', async () => {
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r).toEqual({ status: 'ready' });
    expect((r as { error?: unknown }).error).toBeUndefined();
  });
});

// ─── 2. New user (no plan, no progress) → account_not_found ────────────────

describe('Launch decision — new user without plan/progress', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
  });

  it('both plan and progress null → status:account_not_found', async () => {
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('account_not_found');
  });

  it('account_not_found result does not carry an error property', async () => {
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r).toEqual({ status: 'account_not_found' });
    expect((r as { error?: unknown }).error).toBeUndefined();
  });

  it('account_not_found does not trigger error screen in preparation state machine', () => {
    const state = createAccountNotFoundState('user-A');
    expect(shouldShowPreparationError(true, state, 'user-A')).toBe(false);
  });

  it('account_not_found does NOT allow canRenderStack (app does NOT mount)', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });

  it('account_not_found does NOT allow canRenderOnboardingStack (no auto-redirect)', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderOnboardingStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });

  it('account_not_found shows custom splash during initial boot (canRenderStack=false)', () => {
    const state = createAccountNotFoundState('user-A');
    const canRender = canRenderStackForUser(true, true, true, state, 'user-A');
    expect(shouldShowCustomSplash(false, true, true, canRender, false)).toBe(true);
  });

  it('cache contains null for plan and progress (not undefined)', async () => {
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(qc.getQueryData(['plan', 'user-A'])).toBeNull();
    expect(qc.getQueryData(['progress', 'user-A'])).toBeNull();
  });
});

// ─── 3. Inconsistent state (partial data) → error ────────────────────────────

describe('Launch decision — inconsistent partial state', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
  });

  it('plan present, progress null → status:error with inconsistent_state', async () => {
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.error).toBeInstanceOf(Error);
      expect((r.error as Error).message).toBe('inconsistent_state');
    }
  });

  it('plan null, progress present → status:error with inconsistent_state', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect((r.error as Error).message).toBe('inconsistent_state');
    }
  });
});

// ─── 4. Genuine network error (query rejection) → error ──────────────────────

describe('Launch decision — genuine network errors', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
  });

  it('plan query rejects → status:error with rejection reason', async () => {
    const networkErr = new Error('Network error');
    (fetchPlan as jest.Mock).mockRejectedValueOnce(networkErr);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.error).toBe(networkErr);
    }
  });

  it('progress query rejects → status:error with rejection reason', async () => {
    const networkErr = new Error('Progress fetch failed');
    (fetchProgress as jest.Mock).mockRejectedValueOnce(networkErr);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.error).toBe(networkErr);
    }
  });

  it('both queries reject → status:error (first rejection surfaced)', async () => {
    (fetchPlan as jest.Mock).mockRejectedValueOnce(new Error('plan down'));
    (fetchProgress as jest.Mock).mockRejectedValueOnce(new Error('progress down'));
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
  });

  it('error result triggers shouldShowPreparationError', () => {
    const state = createErrorState('user-A', new Error('network'));
    expect(shouldShowPreparationError(true, state, 'user-A')).toBe(true);
  });

  it('error result blocks canRenderStack', () => {
    const state = createErrorState('user-A', new Error('network'));
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });
});

// ─── 5. Valid pending onboarding → finalize + handoff → ready ─────────────────

describe('Launch decision — valid pending onboarding', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
  });

  it('pending=true, finalize succeeds, handoff succeeds → status:ready', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(true);
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValue({
      flowId: 'flow-123', ownerUserId: 'user-A',
    });
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('ready');
    expect(finalizeOnboardingV2PlanWithPremiumGate).toHaveBeenCalled();
    expect(handOffFinalizedProgram).toHaveBeenCalled();
    expect(clearPendingOnboardingIfMatches).toHaveBeenCalled();
  });

  it('pending=true, finalize fails → status:error (no fallthrough to plan/progress)', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(true);
    (finalizeOnboardingV2PlanWithPremiumGate as jest.Mock).mockResolvedValue({
      status: 'finalized', finalize: { ok: false, reason: 'persist_error' },
    });
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-A');
    expect(r.status).toBe('error');
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
  });
});

// ─── 6. Preparation state machine — account_not_found integration ─────────────

describe('Preparation state machine — account_not_found status', () => {
  it('createAccountNotFoundState sets correct userId and status', () => {
    const state = createAccountNotFoundState('user-X');
    expect(state.userId).toBe('user-X');
    expect(state.status).toBe('account_not_found');
    expect(state.error).toBeUndefined();
  });

  it('canRenderStackForUser returns false for account_not_found (app does NOT mount)', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });

  it('canRenderOnboardingStackForUser returns false for account_not_found (no auto-redirect)', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderOnboardingStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });

  it('canRenderStackForUser returns false for account_not_found when userId mismatches', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-B')).toBe(false);
  });

  it('canRenderStackForUser returns false for account_not_found when initialVisualReleased is false', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(false, true, true, state, 'user-A')).toBe(false);
  });

  it('shouldShowPreparationError returns false for account_not_found', () => {
    const state = createAccountNotFoundState('user-A');
    expect(shouldShowPreparationError(true, state, 'user-A')).toBe(false);
  });

  it('shouldShowPreparationError returns false for account_not_found even if userId mismatches', () => {
    const state = createAccountNotFoundState('user-A');
    expect(shouldShowPreparationError(true, state, 'user-B')).toBe(false);
  });

  it('shouldShowCustomSplash returns true for account_not_found during initial boot', () => {
    const state = createAccountNotFoundState('user-A');
    const canRender = canRenderStackForUser(true, true, true, state, 'user-A');
    expect(shouldShowCustomSplash(false, true, true, canRender, false)).toBe(true);
  });

  it('preparing state still blocks canRenderStack', () => {
    const state = createPreparingState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });

  it('ready state still allows canRenderStack', () => {
    const state = createReadyState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(true);
  });
});

// ─── 7. No loop — account_not_found is a terminal state ────────────────────

describe('No loop — account_not_found is terminal', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
  });

  it('second call without force uses cache (no re-fetch, no loop)', async () => {
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it('force=true re-fetches and still returns account_not_found', async () => {
    const qc = trackClient();
    const r1 = await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(r1.status).toBe('account_not_found');

    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const r2 = await prepareAuthenticatedLaunch(qc, 'user-A', { force: true });
    expect(r2.status).toBe('account_not_found');
  });

  it('account_not_found then user creates plan → next call returns ready', async () => {
    const qc = trackClient();
    const r1 = await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(r1.status).toBe('account_not_found');

    // Simulate: user completed onboarding, plan+progress now exist
    qc.removeQueries({ queryKey: ['plan', 'user-A'] });
    qc.removeQueries({ queryKey: ['progress', 'user-A'] });
    (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-new' });
    (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-new' });

    const r2 = await prepareAuthenticatedLaunch(qc, 'user-A', { force: true });
    expect(r2.status).toBe('ready');
  });
});
