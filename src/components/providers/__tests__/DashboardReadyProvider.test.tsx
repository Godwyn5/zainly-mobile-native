/// <reference types="jest" />
// ─── DashboardReadyProvider / onDashboardLayout ─────────────────────────────
// The dashboard-ready SIGNAL contract (this file) is unchanged by the fix in
// app/(app)/(tabs)/index.tsx — only WHEN that screen calls onDashboardLayout
// changed (moved from Screen's onLayout, which resolves on mere mount, to the
// entrance-animation completion callback, so the cover is never removed
// before the hero/cards have actually faded in). These tests are a
// regression guard on the unchanged contract: phase must be
// data_ready_covered, identity must match the CURRENT session, and the
// plan/progress cache must actually be populated.
//
// app/(app)/(tabs)/index.tsx itself is excluded from Jest (testPathIgnorePatterns
// includes <rootDir>/app/), so the new completion-callback gate it adds
// (finished && mounted && isRealDashboard) is proven separately below as a
// pure mirror — the same pattern already used in rootLayoutIntegration.test.ts
// for _layout.tsx.

import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardReadyProvider, useDashboardReady } from '../DashboardReadyProvider';
import {
  createTransitionLease,
  setTransitionLeaseUserId,
  completeTransitionLease,
  forceReleaseTransitionLease,
  getLeaseSnapshot,
  type SignupVisualSnapshot,
} from '@/lib/transitionLease';
import { useAuthStore } from '@/store/authStore';
import { planQueryOptions, progressQueryOptions } from '@/queries';

// @/queries transitively imports @/db/client (AsyncStorage), which isn't
// available under Jest. Only the queryKey shape is needed here — mock with
// the exact same keys the real module produces.
jest.mock('@/queries', () => ({
  planQueryOptions: (userId?: string) => ({ queryKey: ['plan', userId] }),
  progressQueryOptions: (userId?: string) => ({ queryKey: ['progress', userId] }),
}));

const VISUAL: SignupVisualSnapshot = {
  surfaceType: 'signup',
  email: 'test@test.com',
  password: 'pass123',
  confirm: 'pass123',
  showPw: false,
  showConfirm: false,
};

function setSession(userId: string) {
  useAuthStore.getState().setSession({ user: { id: userId } } as never);
}
function clearSession() {
  useAuthStore.getState().setSession(null);
}

function TestHarness({ capture }: { capture: (fn: () => void) => void }) {
  const { onDashboardLayout } = useDashboardReady();
  capture(onDashboardLayout);
  return null;
}

describe('DashboardReadyProvider / onDashboardLayout', () => {
  let queryClient: QueryClient;
  let renderer: ReturnType<typeof create> | null = null;

  afterEach(() => {
    // Unmount before releasing/mutating shared state so the still-subscribed
    // provider (useSyncExternalStore) doesn't receive a notify() outside act().
    act(() => { renderer?.unmount(); });
    renderer = null;
    forceReleaseTransitionLease();
    clearSession();
  });

  function renderHarness(): () => void {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let captured: (() => void) | null = null;
    act(() => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <DashboardReadyProvider>
            <TestHarness capture={(fn) => { captured = fn; }} />
          </DashboardReadyProvider>
        </QueryClientProvider>,
      );
    });
    return () => captured!();
  }

  it('promotes to dashboard_ready when phase=data_ready_covered, identity matches, and plan+progress are cached', () => {
    const leaseId = createTransitionLease('flow-1', VISUAL);
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-1', 'gen-1', VISUAL);
    setSession('user-A');
    const onDashboardLayout = renderHarness();
    queryClient.setQueryData(planQueryOptions('user-A').queryKey, { id: 'plan-1' });
    queryClient.setQueryData(progressQueryOptions('user-A').queryKey, { id: 'progress-1' });

    act(() => { onDashboardLayout(); });

    expect(getLeaseSnapshot().phase).toBe('dashboard_ready');
  });

  it('does not promote when phase is ACTIVE (transition still running)', () => {
    createTransitionLease('flow-1', VISUAL);
    setTransitionLeaseUserId('user-A');
    setSession('user-A');
    const onDashboardLayout = renderHarness();
    queryClient.setQueryData(planQueryOptions('user-A').queryKey, { id: 'plan-1' });
    queryClient.setQueryData(progressQueryOptions('user-A').queryKey, { id: 'progress-1' });

    act(() => { onDashboardLayout(); });

    expect(getLeaseSnapshot().phase).toBe('active');
  });

  it('does not promote when the cache is not actually populated yet — presence of a lease is not proof of a painted dashboard', () => {
    const leaseId = createTransitionLease('flow-1', VISUAL);
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-1', 'gen-1', VISUAL);
    setSession('user-A');
    const onDashboardLayout = renderHarness();
    // No cache populated.

    act(() => { onDashboardLayout(); });

    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });

  it('ignores a stale signal belonging to a different session (userId mismatch)', () => {
    const leaseId = createTransitionLease('flow-1', VISUAL);
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-1', 'gen-1', VISUAL);
    setSession('user-B'); // current session switched
    const onDashboardLayout = renderHarness();
    queryClient.setQueryData(planQueryOptions('user-B').queryKey, { id: 'plan-1' });
    queryClient.setQueryData(progressQueryOptions('user-B').queryKey, { id: 'progress-1' });

    act(() => { onDashboardLayout(); });

    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });

  it('logout (no session) never promotes the lease', () => {
    const leaseId = createTransitionLease('flow-1', VISUAL);
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-1', 'gen-1', VISUAL);
    clearSession();
    const onDashboardLayout = renderHarness();

    act(() => { onDashboardLayout(); });

    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });
});

// ─── index.tsx entrance-animation completion gate (mirrored) ───────────────
// app/(app)/(tabs)/index.tsx is excluded from Jest. This mirrors its added
// gate exactly: `seq.start(({ finished }) => { if (finished && mountedRef.
// current && isRealDashboardRef.current) onDashboardLayout(); })`.
function shouldSignalDashboardReady(
  finished: boolean,
  mounted: boolean,
  isRealDashboard: boolean,
): boolean {
  return finished && mounted && isRealDashboard;
}

describe('index.tsx entrance-animation completion gate (mirrored)', () => {
  it('signals once the entrance animation finished, the screen is still mounted, and this is the real hydrated branch', () => {
    expect(shouldSignalDashboardReady(true, true, true)).toBe(true);
  });

  it('does not signal if the animation was stopped early (unmount / Strict Mode double-invoke cleanup)', () => {
    expect(shouldSignalDashboardReady(false, true, true)).toBe(false);
  });

  it('does not signal if the screen unmounted before the animation completed', () => {
    expect(shouldSignalDashboardReady(true, false, true)).toBe(false);
  });

  it('does not signal from a loading/error/finalizing/no-plan branch — only the final hydrated branch may remove the cover', () => {
    expect(shouldSignalDashboardReady(true, true, false)).toBe(false);
  });
});
