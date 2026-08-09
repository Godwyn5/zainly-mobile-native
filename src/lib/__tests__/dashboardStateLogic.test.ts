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
  pendingLoading: boolean;
  pendingHasPending: boolean;
  finalizeStatus: 'idle' | 'running' | 'success' | 'error'
    | 'premium_sync_failed' | 'premium_entitlement_missing';
}

function computeDashboardState(input: DashboardStateInput) {
  const hasNoPlan = !input.planData || !input.progressData;
  const isFinalizingOnboardingV2 =
    hasNoPlan &&
    (input.pendingLoading ||
      input.pendingHasPending ||
      input.finalizeStatus === 'running' ||
      input.finalizeStatus === 'error' ||
      input.finalizeStatus === 'premium_sync_failed' ||
      input.finalizeStatus === 'premium_entitlement_missing');
  const showFinalizeCard = isFinalizingOnboardingV2;
  const showLegacyCTA = hasNoPlan && !isFinalizingOnboardingV2;
  const showNormalDashboard = !hasNoPlan;
  return { hasNoPlan, isFinalizingOnboardingV2, showFinalizeCard, showLegacyCTA, showNormalDashboard };
}

describe('Dashboard state logic (Parcours B)', () => {
  it('plan=null, progress=null, pending present → finalize card', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('plan present, progress=null, pending present → finalize card (not legacy CTA)', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: null,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('plan=null, orphan progress present, pending present → finalize card', () => {
    const s = computeDashboardState({
      planData: null, progressData: { current_surah: 50 },
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(false);
  });

  it('complete pair, pending still present after interruption → normal dashboard', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: { current_surah: 1 },
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(false);
    expect(s.isFinalizingOnboardingV2).toBe(false);
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showLegacyCTA).toBe(false);
    expect(s.showNormalDashboard).toBe(true);
  });

  it('complete pair, no pending → normal dashboard', () => {
    const s = computeDashboardState({
      planData: { id: 'plan-A' }, progressData: { current_surah: 1 },
      pendingLoading: false, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(false);
    expect(s.showNormalDashboard).toBe(true);
    expect(s.showFinalizeCard).toBe(false);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('pending loading → finalize card regardless of plan/progress state', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      pendingLoading: true, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.isFinalizingOnboardingV2).toBe(true);
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('finalize running → finalize card, not legacy CTA', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'running',
    });
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('finalize error → finalize card with retry, not legacy CTA', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      pendingLoading: false, pendingHasPending: true,
      finalizeStatus: 'error',
    });
    expect(s.showFinalizeCard).toBe(true);
    expect(s.showLegacyCTA).toBe(false);
  });

  it('no pending, no plan → legacy CTA (genuine new user)', () => {
    const s = computeDashboardState({
      planData: null, progressData: null,
      pendingLoading: false, pendingHasPending: false,
      finalizeStatus: 'idle',
    });
    expect(s.hasNoPlan).toBe(true);
    expect(s.isFinalizingOnboardingV2).toBe(false);
    expect(s.showLegacyCTA).toBe(true);
    expect(s.showFinalizeCard).toBe(false);
  });
});
