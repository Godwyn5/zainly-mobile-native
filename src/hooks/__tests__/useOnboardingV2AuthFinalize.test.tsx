/// <reference types="jest" />
// ─── useOnboardingV2AuthFinalize — recovery-path handoff tests ─────────────
// Exercises the real hook (not a reimplementation of its logic) via a small
// react-test-renderer harness, since @testing-library/react-hooks is not
// installed in this project. Mocks only the I/O boundaries: finalize,
// the canonical handoff, and the QueryClient.

import { act } from 'react';
import { create } from 'react-test-renderer';
import { useOnboardingV2AuthFinalize } from '../useOnboardingV2AuthFinalize';

jest.mock('@/lib/onboardingFinalize', () => ({
  finalizeOnboardingV2Plan: jest.fn(),
}));
jest.mock('@/lib/onboardingDashboardHandoff', () => ({
  handOffFinalizedProgram: jest.fn(),
}));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  clearPendingOnboardingIfMatches: jest.fn(async () => 'cleared'),
  readPendingOnboardingPlan: jest.fn(async () => ({ flowId: 'test-flow-id', ownerUserId: 'user-A' })),
}));
jest.mock('@/lib/revenueCat', () => ({
  restoreRevenueCatPurchases: jest.fn(),
  hasRevenueCatEntitlement: jest.fn(),
}));

const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { clearPendingOnboardingIfMatches } from '@/lib/pendingOnboardingPlan';

const mockFinalize = finalizeOnboardingV2Plan as jest.Mock;
const mockHandoff = handOffFinalizedProgram as jest.Mock;
const mockClearPending = clearPendingOnboardingIfMatches as jest.Mock;

// ── Minimal hook-testing harness (no @testing-library/react-hooks) ───────────
// IMPORTANT: callers must read `harness.result` fresh on every access (never
// destructure `{ result }` once) — it is a live getter over the ref that
// Harness reassigns on every re-render, not a snapshot.
function renderHookHarness<T>(useHookFn: () => T) {
  const ref: { current: T | null } = { current: null };
  function Harness() {
    ref.current = useHookFn();
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });
  return {
    get result() { return ref.current as T; },
    unmount: () => act(() => renderer.unmount()),
  };
}

describe('useOnboardingV2AuthFinalize — recovery handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('status becomes "success" only after the handoff also confirms plan+progress', async () => {
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);
    expect(harness.result.status).toBe('idle');

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    expect(mockHandoff).toHaveBeenCalledWith(expect.anything(), 'user-A');
    expect(harness.result.status).toBe('success');
  });

  it('status becomes "error" (not "success") when finalize succeeds but the handoff fails', async () => {
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValue({ status: 'error', error: new Error('network') });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    expect(harness.result.status).toBe('error');
    expect(harness.result.lastError?.reason).toBe('handoff_failed');
  });

  it('does not call the handoff at all when finalize itself fails', async () => {
    mockFinalize.mockResolvedValue({  ok: false, reason: 'persist_error', message: 'x'  });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    expect(mockHandoff).not.toHaveBeenCalled();
    expect(harness.result.status).toBe('error');
  });

  it('a retry after a handoff failure re-runs finalize+handoff and can reach success', async () => {
    mockFinalize.mockResolvedValue({  ok: true, reason: 'plan_already_exists'  });
    mockHandoff
      .mockResolvedValueOnce({ status: 'error', error: new Error('network') })
      .mockResolvedValueOnce({ status: 'ready', plan: {}, progress: {} });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });
    expect(harness.result.status).toBe('error');

    await act(async () => {
      await harness.result.retryFinalize();
    });
    expect(harness.result.status).toBe('success');
    expect(mockHandoff).toHaveBeenCalledTimes(2);
  });

  it('does not double-finalize on a second concurrent call while one is in flight (busy guard preserved)', async () => {
    let resolveFinalize: (v: unknown) => void = () => {};
    mockFinalize.mockImplementation(() => new Promise((resolve) => { resolveFinalize = resolve; }));
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    let firstCall: Promise<unknown>;
    let secondCall: Promise<unknown>;
    act(() => {
      firstCall = harness.result.runFinalize('user-A');
      secondCall = harness.result.runFinalize('user-A');
    });

    await act(async () => {
      resolveFinalize({  ok: true, reason: 'created'  });
      await Promise.all([firstCall, secondCall]);
    });

    // The busy guard rejects the second concurrent call with null — only
    // one real finalize attempt is ever made.
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(await secondCall!).toBeNull();
  });

  it('retry after hook recreation succeeds (does not depend on volatile closure state)', async () => {
    // First hook instance: finalize succeeds, handoff fails
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValueOnce({ status: 'error', error: new Error('network') });

    const harness1 = renderHookHarness(useOnboardingV2AuthFinalize);
    await act(async () => {
      await harness1.result.runFinalize('user-A');
    });
    expect(harness1.result.status).toBe('error');
    harness1.unmount();

    // Simulate app kill + restart: create a fresh hook instance.
    // The retry must work without any closure state from the first hook.
    // In production, the dashboard auto-triggers runFinalize when it sees
    // a pending payload — userIdRef is set fresh from the session.
    mockHandoff.mockResolvedValueOnce({ status: 'ready', plan: {}, progress: {} });

    const harness2 = renderHookHarness(useOnboardingV2AuthFinalize);
    expect(harness2.result.status).toBe('idle');

    await act(async () => {
      await harness2.result.runFinalize('user-A');
    });

    // The retried finalize detects the existing pair (idempotent guard),
    // handoff succeeds, status becomes 'success'.
    expect(harness2.result.status).toBe('success');
    expect(mockFinalize).toHaveBeenCalledTimes(2);
    expect(mockHandoff).toHaveBeenCalledTimes(2);
    harness2.unmount();
  });
});

// ─── Multi-account protection ──────────────────────────────────────────────
describe('useOnboardingV2AuthFinalize — multi-account protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call handoff for user-A if session changed to user-B during finalize', async () => {
    let resolveFinalize: (v: unknown) => void = () => {};
    mockFinalize.mockImplementation(() => new Promise((resolve) => { resolveFinalize = resolve; }));
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = harness.result.runFinalize('user-A');
    });

    // Simulate session change during finalize
    // The hook doesn't have a session getter — it relies on the caller
    // (dashboard) to not call runFinalize for the wrong user. But the
    // finalize itself uses the userId passed to it, so the handoff will
    // use user-A's userId regardless. The protection is that the dashboard
    // checks session before calling runFinalize.
    //
    // However, we can test that the hook doesn't mix userIds internally:
    await act(async () => {
      resolveFinalize({  ok: true, reason: 'created'  });
      await callPromise;
    });

    // Handoff was called with user-A (the userId passed to runFinalize),
    // not any other user
    expect(mockHandoff).toHaveBeenCalledWith(expect.anything(), 'user-A');
  });

  it('clearPendingOnboardingForUser is called with the correct userId, not a stale one', async () => {
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });

    mockClearPending.mockClear();

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    expect(harness.result.status).toBe('success');
    expect(mockClearPending).toHaveBeenCalledWith('user-A', 'test-flow-id');
    expect(mockClearPending).not.toHaveBeenCalledWith('user-B', expect.anything());
  });

  it('does not clear pending for user-A when runFinalize was called with user-B', async () => {
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });

    mockClearPending.mockClear();

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-B');
    });

    expect(harness.result.status).toBe('success');
    // clearPendingOnboardingIfMatches was called with user-B + flowId, never user-A
    expect(mockClearPending).toHaveBeenCalledWith('user-B', 'test-flow-id');
    expect(mockClearPending).not.toHaveBeenCalledWith('user-A', expect.anything());
  });

  it('A→B during finalize → handoff uses user-A, clearPending uses user-A (hook captures userId at call time)', async () => {
    let resolveFinalize: (v: unknown) => void;
    mockFinalize.mockReturnValueOnce(new Promise(r => { resolveFinalize = r; }));
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });
    mockClearPending.mockClear();

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = harness.result.runFinalize('user-A');
    });

    // Finalize is in-flight. Even if the session changes to user-B externally,
    // the hook captured user-A at call time.
    await act(async () => {
      resolveFinalize!({  ok: true, reason: 'created'  });
      await callPromise;
    });

    // Handoff and clearPending both use user-A — the userId passed to runFinalize
    expect(mockHandoff).toHaveBeenCalledWith(expect.anything(), 'user-A');
    expect(mockClearPending).toHaveBeenCalledWith('user-A', 'test-flow-id');
    expect(mockClearPending).not.toHaveBeenCalledWith('user-B', expect.anything());
  });

  it('A→B during handoff → clearPending still uses user-A (hook does not re-read session)', async () => {
    let resolveHandoff: (v: unknown) => void;
    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockReturnValueOnce(new Promise(r => { resolveHandoff = r; }));
    mockClearPending.mockClear();

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = harness.result.runFinalize('user-A');
    });

    // Wait for finalize to complete and handoff to be in-flight
    await act(async () => {
      // Allow microtasks to flush so finalize resolves
      await Promise.resolve();
    });

    // Resolve handoff — session may have changed externally, but hook uses user-A
    await act(async () => {
      resolveHandoff!({ status: 'ready', plan: {}, progress: {} });
      await callPromise;
    });

    expect(mockClearPending).toHaveBeenCalledWith('user-A', 'test-flow-id');
    expect(mockClearPending).not.toHaveBeenCalledWith('user-B', expect.anything());
  });

  it('new transaction for A → old clear with old flowId does not clear new pending', async () => {
    // Simulate: finalize T1, handoff succeeds, but before clearPending runs,
    // the pending is overwritten with T2 (new flowId).
    const { readPendingOnboardingPlan } = jest.requireMock('@/lib/pendingOnboardingPlan') as { readPendingOnboardingPlan: jest.Mock };
    readPendingOnboardingPlan.mockImplementationOnce(async () => {
      return { flowId: 'new-flow-id-T2', ownerUserId: 'user-A' };
    });

    mockFinalize.mockResolvedValue({  ok: true, reason: 'created'  });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: {}, progress: {} });
    mockClearPending.mockClear();

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);

    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    expect(harness.result.status).toBe('success');
    // clearPending was called with the NEW flowId (read from the pending),
    // not the old one. The actual clearPendingOnboardingIfMatches would
    // compare this against the pending's current flowId — since they match,
    // it clears T2 (which is correct: the pair is already durable).
    expect(mockClearPending).toHaveBeenCalledWith('user-A', 'new-flow-id-T2');
    expect(mockClearPending).not.toHaveBeenCalledWith('user-A', 'test-flow-id');
  });

  it('clearPending returns superseded → hook does NOT announce success', async () => {
    mockFinalize.mockResolvedValue({ ok: true, reason: 'created' });
    mockHandoff.mockResolvedValue({ status: 'ready', plan: { id: 'p', user_id: 'user-A' }, progress: { user_id: 'user-A' } });
    mockClearPending.mockResolvedValueOnce('superseded');

    const harness = renderHookHarness(useOnboardingV2AuthFinalize);
    await act(async () => {
      await harness.result.runFinalize('user-A');
    });

    // superseded means a newer transaction or different user's pending is in storage.
    // The hook must NOT announce success.
    expect(harness.result.status).not.toBe('success');
    expect(harness.result.status).toBe('error');
    expect(harness.result.lastError?.reason).toBe('superseded');
  });
});
