/// <reference types="jest" />
// ─── Google onboarding loop regression tests — 15 scenarios ──────────────────
//
// Tests the complete fix for the Google login flow where new social
// accounts (no plan, no progress, no pending onboarding) are handled
// at the authentication boundary with a fail-closed sign-out and
// AccountNotFoundScreen, instead of being shown the LaunchErrorScreen
// or the "Créer mon programme" CTA.
//
// The fix has two components:
//   1. prepareAuthenticatedLaunch returns 'account_not_found' when both
//      plan and progress are null (not 'ready' with null data)
//   2. preparationStateMachine treats 'account_not_found' as a non-error
//      status that blocks canRenderStack — the root layout signs out
//      locally, purges caches, and renders AccountNotFoundScreen

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
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { getRevenueCatCustomerInfo, ensureRevenueCatReadyForUser } from '@/lib/revenueCat';
import {
  canRenderStackForUser,
  canRenderOnboardingStackForUser,
  shouldShowPreparationError,
  shouldShowCustomSplash,
  createAccountNotFoundState,
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
  (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValue({ ok: true, reason: 'created' });
  (handOffFinalizedProgram as jest.Mock).mockResolvedValue({
    status: 'ready', plan: { id: 'plan-1' }, progress: { id: 'progress-1' },
  });
  (readPendingOnboardingPlan as jest.Mock).mockResolvedValue(null);
  (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValue('already_absent' as never);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15 REGRESSION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Google onboarding loop — 15 regression scenarios', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
  });

  // ── Scenario 1: New Google user (no plan, no progress, no pending) ──
  it('1. New Google user: both null → account_not_found (not error, not ready)', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-new');
    expect(r.status).toBe('account_not_found');
    expect((r as { error?: unknown }).error).toBeUndefined();
  });

  // ── Scenario 2: account_not_found does not trigger LaunchErrorScreen ──
  it('2. account_not_found state: shouldShowPreparationError=false', () => {
    const state = createAccountNotFoundState('user-new');
    expect(shouldShowPreparationError(true, state, 'user-new')).toBe(false);
  });

  // ── Scenario 3: account_not_found does NOT mount (app) — no stack mounts ──
  it('3. account_not_found state: canRenderStackForUser=false (app does NOT mount)', () => {
    const state = createAccountNotFoundState('user-new');
    expect(canRenderStackForUser(true, true, true, state, 'user-new')).toBe(false);
  });

  it('3b. account_not_found state: canRenderOnboardingStackForUser=false (no auto-redirect)', () => {
    const state = createAccountNotFoundState('user-new');
    expect(canRenderOnboardingStackForUser(true, true, true, state, 'user-new')).toBe(false);
  });

  // ── Scenario 4: account_not_found keeps splash visible during initial boot ──
  it('4. account_not_found state: shouldShowCustomSplash=true during initial boot', () => {
    const state = createAccountNotFoundState('user-new');
    const canRender = canRenderStackForUser(true, true, true, state, 'user-new');
    expect(shouldShowCustomSplash(false, true, true, canRender, false)).toBe(true);
  });

  // ── Scenario 5: Complete program (plan + progress) → ready (no onboarding) ──
  it('5. Existing user with plan+progress → ready (no needs_onboarding)', async () => {
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-existing');
    expect(r.status).toBe('ready');
  });

  // ── Scenario 6: Inconsistent state (plan only, no progress) → error ──
  it('6. Plan present, progress null → error (inconsistent_state)', async () => {
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-partial');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect((r.error as Error).message).toBe('inconsistent_state');
    }
  });

  // ── Scenario 7: Inconsistent state (progress only, no plan) → error ──
  it('7. Progress present, plan null → error (inconsistent_state)', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-partial');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect((r.error as Error).message).toBe('inconsistent_state');
    }
  });

  // ── Scenario 8: Genuine network error (plan query rejects) → error ──
  it('8. Plan query rejects → error (not needs_onboarding)', async () => {
    (fetchPlan as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-net');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.error).toBeInstanceOf(Error);
    }
  });

  // ── Scenario 9: Valid pending onboarding → finalize + handoff → ready ──
  it('9. Pending onboarding exists → finalize+handoff runs → ready', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(true);
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValue({
      flowId: 'flow-1', ownerUserId: 'user-pending',
    });
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-pending');
    expect(r.status).toBe('ready');
    expect(finalizeOnboardingV2Plan).toHaveBeenCalled();
    expect(handOffFinalizedProgram).toHaveBeenCalled();
    expect(clearPendingOnboardingIfMatches).toHaveBeenCalled();
  });

  // ── Scenario 10: Pending onboarding but finalize fails → error (no fallthrough) ──
  it('10. Pending=true, finalize fails → error (no plan/progress fallthrough)', async () => {
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(true);
    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValue({ ok: false, reason: 'persist_error' });
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-fail');
    expect(r.status).toBe('error');
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
  });

  // ── Scenario 11: No query loop — second call uses cache (no re-fetch) ──
  it('11. No loop: second call without force uses cache (fetchPlan called once)', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-loop');
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    await prepareAuthenticatedLaunch(qc, 'user-loop');
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 11b: account_not_found is the result (not needs_onboarding) ──
  it('11b. New user with no plan/progress → account_not_found (not needs_onboarding)', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const r = await prepareAuthenticatedLaunch(trackClient(), 'user-new-11b');
    expect(r.status).toBe('account_not_found');
  });

  // ── Scenario 12: account_not_found → user creates plan → next call returns ready ──
  it('12. account_not_found then plan created → force=true returns ready', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
    const qc = trackClient();
    const r1 = await prepareAuthenticatedLaunch(qc, 'user-evolve');
    expect(r1.status).toBe('account_not_found');

    qc.removeQueries({ queryKey: ['plan', 'user-evolve'] });
    qc.removeQueries({ queryKey: ['progress', 'user-evolve'] });
    (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-new' });
    (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-new' });

    const r2 = await prepareAuthenticatedLaunch(qc, 'user-evolve', { force: true });
    expect(r2.status).toBe('ready');
  });

  // ── Scenario 13: account_not_found with userId mismatch → canRenderStack=false ──
  it('13. account_not_found for user-A but current=user-B → canRenderStack=false', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-B')).toBe(false);
  });

  // ── Scenario 14: account_not_found with initialVisualReleased=false → blocked ──
  it('14. account_not_found before initialVisualReleased → canRenderStack=false', () => {
    const state = createAccountNotFoundState('user-A');
    expect(canRenderStackForUser(false, true, true, state, 'user-A')).toBe(false);
  });

  // ── Scenario 15: preparing state still blocks canRenderStack (not needs_onboarding) ──
  it('15. preparing state → canRenderStack=false (gate blocks until preparation resolves)', () => {
    const state = createPreparingState('user-A');
    expect(canRenderStackForUser(true, true, true, state, 'user-A')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Cache integrity for needs_onboarding
// ═══════════════════════════════════════════════════════════════════════════════

describe('Google onboarding — cache integrity for account_not_found', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupDefaultMocks();
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);
  });

  it('cache contains null (not undefined) for plan and progress', async () => {
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(qc.getQueryData(['plan', 'user-A'])).toBeNull();
    expect(qc.getQueryData(['progress', 'user-A'])).toBeNull();
  });

  it('pendingOnboarding cache is false (no pending for new user)', async () => {
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(qc.getQueryData(['pendingOnboarding', 'user-A'])).toBe(false);
  });

  it('non-critical queries still populate cache (reviews, profile, revenueCat)', async () => {
    const qc = trackClient();
    await prepareAuthenticatedLaunch(qc, 'user-A');
    expect(qc.getQueryData(['profile', 'user-A'])).toBeDefined();
    expect(qc.getQueryData(['revenueCatCustomerInfo', 'user-A'])).toBeDefined();
  });
});
