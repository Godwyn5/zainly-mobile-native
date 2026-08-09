/// <reference types="jest" />
// ─── Dashboard state logic tests (Parcours B) ───────────────────────────────
// Tests the exact boolean conditions that decide which UI state the dashboard
// renders: hasNoPlan, isFinalizingOnboardingV2, the finalize card, the legacy
// CTA, and the normal dashboard. These are pure functions of plan/progress/
// pending/finalize-status — extracted here so the tests don't need a full
// Expo render harness.

interface DashboardStateInput {
  planData: unknown | null;
  progressData: unknown | null;
  planLoading: boolean;
  progressLoading: boolean;
  pendingLoading: boolean;
  pendingHasPending: boolean;
  finalizeStatus: 'idle' | 'running' | 'success' | 'error'
    | 'premium_sync_failed' | 'premium_entitlement_missing';
}

function computeDashboardState(input: DashboardStateInput) {
  const hasNoPlan = !input.planData || !input.progressData;
  const isLoading = input.planLoading || input.progressLoading;
  const isFinalizingOnboardingV2 =
    hasNoPlan &&
    (input.pendingLoading ||
      input.pendingHasPending ||
      input.finalizeStatus === 'running' ||
      input.finalizeStatus === 'error' ||
      input.finalizeStatus === 'premium_sync_failed' ||
      input.finalizeStatus === 'premium_entitlement_missing');

  // Early returns in render order:
  // 1. isLoading → recovery card (safety net, gate prevents in normal operation)
  // 2. hasError → error card
  // 3. isFinalizingOnboardingV2 → finalize card
  // 4. hasNoPlan (alone) → legacy CTA
  // 5. else → normal dashboard
  let visibleState: 'recovery_card' | 'finalize_card' | 'legacy_cta' | 'normal_dashboard';
  if (isLoading) {
    visibleState = 'recovery_card';
  } else if (isFinalizingOnboardingV2) {
    visibleState = 'finalize_card';
  } else if (hasNoPlan) {
    visibleState = 'legacy_cta';
  } else {
    visibleState = 'normal_dashboard';
  }

  return {
    hasNoPlan,
    isFinalizingOnboardingV2,
    visibleState,
    showFinalizeCard: visibleState === 'finalize_card',
    showLegacyCTA: visibleState === 'legacy_cta',
    showNormalDashboard: visibleState === 'normal_dashboard',
    showRecoveryCard: visibleState === 'recovery_card',
  };
}

describe('Dashboard state logic (Parcours B)', () => {
  it('1. plan=null, progress=null, pending owned → finalize card', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.visibleState).toBe('finalize_card');
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('2. plan present, progress=null, pending owned → finalize card (not legacy CTA)', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: null,
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.visibleState).toBe('finalize_card');
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('3. plan=null, orphan progress present, pending owned → finalize card', () => {
    const s = computeDashboardState({
      planData: null, progressData: { current_surah: 50 },
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.visibleState).toBe('finalize_card');
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('4. complete pair, pending residual → normal dashboard (idempotent cleanup in background)', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: { current_surah: 1 },
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(false);
    expect(s.isFinalizingOnboardingV2).toBe(false);
    expect(s.visibleState).toBe('normal_dashboard');
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('5. complete pair, no pending → normal dashboard', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: { current_surah: 1 },
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(false);
    expect(s.visibleState).toBe('normal_dashboard');
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('6. partial state (plan present, progress=null) without pending → legacy CTA', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: null,
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(false);
    expect(s.visibleState).toBe('legacy_cta');
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('7. plan/progress queries still loading → recovery card (safety net)', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      planLoading: true, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.visibleState).toBe('recovery_card');
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('8. finalize error with partial state (plan present, progress=null) → finalize card with retry', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: null,
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'error',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.visibleState).toBe('finalize_card');
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('no pending, no plan → legacy CTA (genuine new user)', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      planLoading: false, progressLoading: false,
      pendingLoading: false, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(false);
    expect(s.visibleState).toBe('legacy_cta');
    expect(s.showFinalizeCard).toBe(false);
  });
});
