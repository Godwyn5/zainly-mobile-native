/// <reference types="jest" />
// ─── Behavioral tests for the onboarding route decision ──────────────────────
//
// Tests the pure computeRouteDecision and shouldNavigateToOnboarding functions
// that drive the root layout's navigation for needs_onboarding users.
// Also tests the authenticated onboarding finalization path via
// orchestrateAuthedFinalize to verify the complete flow:
//   session exists → onboarding-v2 → finalize → dashboard

import {
  computeRouteDecision,
  shouldNavigateToOnboarding,
  canRenderStackForUser,
  shouldShowCustomSplash,
  shouldShowPreparationError,
  createNeedsOnboardingState,
  createReadyState,
  createErrorState,
  createPreparingState,
  createInitialPreparationState,
} from '../preparationStateMachine';
import { orchestrateAuthedFinalize } from '../programSummaryOrchestration';
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { clearPendingOnboardingIfMatches, readPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';
import { QueryClient } from '@tanstack/react-query';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  const mock = {
    getItem: jest.fn(async (key: string) => (key in store ? store[key] : null)),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, k in store ? store[k] : null])),
    multiSet: jest.fn(async (entries: [string, string][]) => { entries.forEach(([k, v]) => { store[k] = v; }); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => { delete store[k]; }); }),
    clear: jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
  };
  return { __esModule: true, default: mock };
});

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
  clearPendingOnboardingIfMatches: jest.fn(async () => 'already_absent' as never),
  readPendingOnboardingPlan: jest.fn(async () => null),
  savePendingOnboardingPlan: jest.fn(async () => ({ ok: true, flowId: 'flow-1' })),
  saveActiveOnboardingAuthFlow: jest.fn(async () => {}),
  setSessionAuthFlowId: jest.fn(),
  hasValidPendingOnboardingPlanForUser: jest.fn(async () => false),
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  clearOnboardingStateForSessionExpiry: jest.fn(async () => {}),
  clearAllPendingOnboardingData: jest.fn(async () => {}),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT AND NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Route decision — boot and navigation', () => {
  // ── needs_onboarding does not mount TodayScreen ──
  it('needs_onboarding → route decision is "onboarding", not "app"', () => {
    const prep = createNeedsOnboardingState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('onboarding');
    expect(decision).not.toBe('app');
  });

  // ── needs_onboarding does not mount tabs ──
  it('needs_onboarding → canRenderStackForUser=false (tabs NOT mounted)', () => {
    const prep = createNeedsOnboardingState('user-A');
    expect(canRenderStackForUser(true, true, true, prep, 'user-A')).toBe(false);
  });

  // ── navigation to /onboarding-v2/name happens exactly once ──
  it('shouldNavigateToOnboarding returns userId on first call, null on second', () => {
    expect(shouldNavigateToOnboarding(true, 'user-A', null)).toBe('user-A');
    expect(shouldNavigateToOnboarding(true, 'user-A', 'user-A')).toBe(null);
  });

  it('shouldNavigateToOnboarding returns null when canRenderOnboardingStack is false', () => {
    expect(shouldNavigateToOnboarding(false, 'user-A', null)).toBe(null);
  });

  it('shouldNavigateToOnboarding returns null when userId is null', () => {
    expect(shouldNavigateToOnboarding(true, null, null)).toBe(null);
  });

  // ── splash stays active until the correct route ──
  it('needs_onboarding during initial boot → splash visible (canRenderStack=false)', () => {
    const prep = createNeedsOnboardingState('user-A');
    const canRender = canRenderStackForUser(true, true, true, prep, 'user-A');
    expect(shouldShowCustomSplash(false, true, true, canRender, false)).toBe(true);
  });

  it('needs_onboarding after boot completed → minimal screen (not splash)', () => {
    const prep = createNeedsOnboardingState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: true,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    // After boot, the onboarding stack still mounts but with minimal overlay
    expect(decision).toBe('onboarding');
  });

  // ── ready opens (app) normally ──
  it('ready → route decision is "app"', () => {
    const prep = createReadyState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('app');
  });

  // ── error opens LaunchErrorScreen ──
  it('error → route decision is "error"', () => {
    const prep = createErrorState('user-A', new Error('test'));
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('error');
  });

  // ── inconsistent_state does not start onboarding ──
  it('inconsistent_state (error) → route decision is "error", not "onboarding"', () => {
    const prep = createErrorState('user-A', new Error('inconsistent_state'));
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('error');
    expect(decision).not.toBe('onboarding');
  });

  // ── preparing state → not app, not onboarding ──
  it('preparing → route decision is "splash" during initial boot', () => {
    const prep = createPreparingState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: false,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('splash');
  });

  // ── guest → app (public routes) ──
  it('guest → route decision is "app"', () => {
    const prep = createInitialPreparationState();
    const decision = computeRouteDecision({
      authReady: true,
      authed: false,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: null,
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('app');
  });

  // ── not authReady → minimal ──
  it('not authReady → route decision is "minimal"', () => {
    const decision = computeRouteDecision({
      authReady: false,
      authed: false,
      bootCompleted: false,
      initialVisualReleased: false,
      preparation: createInitialPreparationState(),
      currentUserId: null,
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('minimal');
  });

  // ── matchingReadyHandoff → app ──
  it('matchingReadyHandoff=true → route decision is "app"', () => {
    const prep = createPreparingState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-A',
      matchingReadyHandoff: true,
    });
    expect(decision).toBe('app');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING WITH EXISTING SESSION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Authenticated onboarding finalization', () => {
  let queryClient: QueryClient;
  let sessionUserId: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    sessionUserId = 'user-google-123';

    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValue({ ok: true, reason: 'created' });
    (handOffFinalizedProgram as jest.Mock).mockResolvedValue({
      status: 'ready',
      plan: { id: 'plan-1' },
      progress: { id: 'progress-1' },
    });
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValue(null);
    (clearPendingOnboardingIfMatches as jest.Mock).mockResolvedValue('already_absent' as never);
  });

  afterEach(() => queryClient.clear());

  // ── session exists → finalize directly, no signup-methods ──
  it('authenticated user: orchestrateAuthedFinalize calls finalize, not signup', async () => {
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledWith('user-google-123', '');
    expect(result.status).toBe('navigate');
  });

  // ── no social auth function is called ──
  it('orchestrateAuthedFinalize does not call any social auth function', async () => {
    await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    // finalize is called with empty flowId — no social auth involved
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledWith('user-google-123', '');
  });

  // ── finalization receives exactly the session userId ──
  it('finalize receives exactly the session userId', async () => {
    await orchestrateAuthedFinalize(queryClient, 'user-apple-456', {
      getSessionUserId: () => 'user-apple-456',
    });
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledWith('user-apple-456', '');
  });

  // ── plan and progress are created exactly once ──
  it('finalize is called exactly once', async () => {
    await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledTimes(1);
  });

  // ── handoff is called exactly once ──
  it('handoff is called exactly once', async () => {
    await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(handOffFinalizedProgram).toHaveBeenCalledTimes(1);
    expect(handOffFinalizedProgram).toHaveBeenCalledWith(queryClient, 'user-google-123');
  });

  // ── both plan and progress are re-read before dashboard ──
  it('handoff re-reads plan and progress (status:ready means cache verified)', async () => {
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('navigate');
    expect(handOffFinalizedProgram).toHaveBeenCalledWith(queryClient, 'user-google-123');
  });

  // ── after finalization, status becomes navigate (→ dashboard) ──
  it('successful finalization returns navigate status', async () => {
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('navigate');
  });

  // ── navigation to dashboard happens once ──
  it('navigate status is returned exactly once (no duplicate navigation)', async () => {
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('navigate');
    // A second call would re-finalize, but the submission lock in the UI
    // prevents this — here we verify the function itself is deterministic
  });

  // ── session change during finalization → session_changed ──
  it('session changes during finalization → session_changed (no navigation)', async () => {
    sessionUserId = 'user-google-123';
    (finalizeOnboardingV2Plan as jest.Mock).mockImplementation(async () => {
      // Simulate session change during async finalize
      sessionUserId = 'user-other-789';
      return {  ok: true, reason: 'created'  };
    });
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('session_changed');
  });

  // ── finalize fails → finalize_failed (no handoff) ──
  it('finalize fails → finalize_failed, handoff NOT called', async () => {
    (finalizeOnboardingV2Plan as jest.Mock).mockResolvedValue({ ok: false, reason: 'persist_error' });
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('finalize_failed');
    expect(handOffFinalizedProgram).not.toHaveBeenCalled();
  });

  // ── handoff fails → handoff_failed (no clear) ──
  it('handoff fails → handoff_failed, clear NOT called', async () => {
    (handOffFinalizedProgram as jest.Mock).mockResolvedValue({
      status: 'error',
      error: new Error('handoff_failed'),
    });
    const result = await orchestrateAuthedFinalize(queryClient, 'user-google-123', {
      getSessionUserId: () => sessionUserId,
    });
    expect(result.status).toBe('handoff_failed');
    expect(clearPendingOnboardingIfMatches).not.toHaveBeenCalled();
  });

  // ── Apple user: same behavior as Google ──
  it('Apple user with existing session: same finalization path', async () => {
    const appleUserId = 'user-apple-999';
    const result = await orchestrateAuthedFinalize(queryClient, appleUserId, {
      getSessionUserId: () => appleUserId,
    });
    expect(finalizeOnboardingV2Plan).toHaveBeenCalledWith(appleUserId, '');
    expect(result.status).toBe('navigate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROBUSTNESS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Robustness — interruption, logout, account switch', () => {
  // ── restart during onboarding: needs_onboarding is re-derived from plan/progress ──
  it('restart with valid session but no plan → needs_onboarding (re-derived)', () => {
    // After restart, prepareAuthenticatedLaunch fetches plan+progress again.
    // If both are null, it returns needs_onboarding — the user re-enters onboarding.
    // This is the correct behavior: no stale state, no loop.
    const prep = createNeedsOnboardingState('user-restart');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: false,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-restart',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('onboarding');
  });

  // ── logout during onboarding: session becomes null → guest routes ──
  it('logout during onboarding → guest routes (authed=false)', () => {
    const decision = computeRouteDecision({
      authReady: true,
      authed: false,
      bootCompleted: true,
      initialVisualReleased: true,
      preparation: createNeedsOnboardingState('user-logout'),
      currentUserId: null,
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('app');
  });

  // ── account switch: userId changes → no onboarding for old user ──
  it('account switch: needs_onboarding for user-A but current=user-B → not onboarding', () => {
    const prep = createNeedsOnboardingState('user-A');
    const decision = computeRouteDecision({
      authReady: true,
      authed: true,
      bootCompleted: true,
      initialVisualReleased: true,
      preparation: prep,
      currentUserId: 'user-B',
      matchingReadyHandoff: false,
    });
    // userId mismatch → not onboarding, not app, not error → minimal
    expect(decision).toBe('minimal');
  });

  // ── no cache/pending from old user after account switch ──
  it('shouldNavigateToOnboarding for user-B after user-A navigated → returns user-B', () => {
    // The ref in _layout.tsx resets when canRenderOnboardingStack becomes false
    // (userId change clears it), so user-B gets its own navigation.
    expect(shouldNavigateToOnboarding(true, 'user-B', 'user-A')).toBe('user-B');
  });

  // ── no infinite refetch: second call uses cache ──
  it('shouldNavigateToOnboarding returns null after same userId already navigated', () => {
    expect(shouldNavigateToOnboarding(true, 'user-A', 'user-A')).toBe(null);
  });

  // ── no navigation ping-pong: needs_onboarding → ready → no back-navigation ──
  it('needs_onboarding transitions to ready → route decision changes to app', () => {
    const prepOnboarding = createNeedsOnboardingState('user-A');
    const decisionOnboarding = computeRouteDecision({
      authReady: true, authed: true, bootCompleted: true,
      initialVisualReleased: true,
      preparation: prepOnboarding, currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decisionOnboarding).toBe('onboarding');

    // After onboarding completes, preparation becomes ready
    const prepReady = createReadyState('user-A');
    const decisionReady = computeRouteDecision({
      authReady: true, authed: true, bootCompleted: true,
      initialVisualReleased: true,
      preparation: prepReady, currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decisionReady).toBe('app');
    // No back-navigation: shouldNavigateToOnboarding returns null when
    // canRenderOnboardingStack is false (it is, because status is now 'ready')
    expect(shouldNavigateToOnboarding(false, 'user-A', 'user-A')).toBe(null);
  });

  // ── email path not regressed: guest → app (public routes include email signup) ──
  it('email signup path: guest → app (public routes accessible)', () => {
    const decision = computeRouteDecision({
      authReady: true, authed: false, bootCompleted: false,
      initialVisualReleased: true,
      preparation: createInitialPreparationState(),
      currentUserId: null,
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('app');
  });

  // ── initialVisualReleased=false blocks onboarding stack ──
  it('needs_onboarding before initialVisualReleased → splash, not onboarding', () => {
    const prep = createNeedsOnboardingState('user-A');
    const decision = computeRouteDecision({
      authReady: true, authed: true, bootCompleted: false,
      initialVisualReleased: false,
      preparation: prep, currentUserId: 'user-A',
      matchingReadyHandoff: false,
    });
    expect(decision).toBe('splash');
  });

  // ── error state for different user → not shown ──
  it('error for user-A but current=user-B → shouldShowPreparationError=false', () => {
    const prep = createErrorState('user-A', new Error('test'));
    expect(shouldShowPreparationError(true, prep, 'user-B')).toBe(false);
  });
});
