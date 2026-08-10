// ─── Transition lease — atomic state machine for onboarding finalization ────
//
// State machine:
//   IDLE → ACTIVE → DATA_READY_COVERED → DASHBOARD_READY → IDLE
//
// ACTIVE: signup/login screen is mounted, finalize+handoff is running.
//   _layout.tsx treats user as unauthenticated (guest=true).
//
// DATA_READY_COVERED: finalize+handoff+clear+cache-verification all succeeded.
//   The lease is no longer active for routing, AND the verified handoff
//   identity is available in the SAME snapshot. _layout.tsx reads the
//   snapshot synchronously during render and computes matchingReadyHandoff.
//   canRenderStack=true so the Stack renders with (app) mounting behind.
//   A signup cover overlay is shown on top until the dashboard signals ready.
//
// DASHBOARD_READY: the dashboard has confirmed its first onLayout with
//   plan+progress present and all identities matching. accountPreparation
//   is committed to 'ready'. The cover is removed.
//
// IDLE: token cleared, no observable side effects.

export type LeasePhase = 'idle' | 'active' | 'data_ready_covered' | 'dashboard_ready';

export type SurfaceType = 'signup' | 'login';

export interface SignupVisualSnapshot {
  surfaceType: SurfaceType;
  email: string;
  password: string;
  confirm: string;
  showPw: boolean;
  showConfirm: boolean;
}

export interface LeaseSnapshot {
  phase: LeasePhase;
  leaseId: string | null;
  flowId: string | null;
  userId: string | null;
  sessionGen: string | null;
  cacheVerified: boolean;
  visual: SignupVisualSnapshot | null;
}

export interface VerifiedHandoff {
  userId: string;
  flowId: string;
  leaseId: string;
  cacheVerified: boolean;
}

const IDLE_SNAPSHOT: LeaseSnapshot = {
  phase: 'idle',
  leaseId: null,
  flowId: null,
  userId: null,
  sessionGen: null,
  cacheVerified: false,
  visual: null,
};

let _snapshot: LeaseSnapshot = IDLE_SNAPSHOT;
const _subscribers = new Set<() => void>();

function notify(): void {
  _subscribers.forEach((fn) => fn());
}

function setSnapshot(next: LeaseSnapshot): void {
  _snapshot = next;
  notify();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates a transition lease identified by the onboarding flowId.
 * Returns a unique leaseId that must be passed to releaseTransitionLease
 * and completeTransitionLease.
 * Throws if a lease is already active (double-tap guard).
 */
export function createTransitionLease(
  flowId: string,
  visual: SignupVisualSnapshot | null = null,
): string {
  if (_snapshot.phase === 'active' || _snapshot.phase === 'data_ready_covered') {
    throw new Error('A transition lease is already active');
  }
  const leaseId = `${flowId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setSnapshot({
    phase: 'active',
    leaseId,
    flowId,
    userId: null,
    sessionGen: null,
    cacheVerified: false,
    // Populated immediately (not only at completion) so the cover overlay
    // in _layout.tsx can already be mounted, as the SAME instance, before
    // Stack.Protected ever swaps route groups — closing the native-stack
    // transition race where a NEWLY mounted overlay (previously only
    // mounted at DATA_READY_COVERED, the exact same tick as the guard
    // flip) could be outrun by react-native-screens' own transition.
    visual,
  });
  return leaseId;
}

/**
 * Releases the transition lease WITHOUT a verified handoff.
 * Used on error paths (finalize failure, handoff failure, etc.).
 * Only releases if the leaseId matches the active lease.
 * Transitions directly to IDLE — no DATA_READY_COVERED state.
 */
export function releaseTransitionLease(leaseId: string): void {
  if (_snapshot.leaseId === leaseId) {
    setSnapshot(IDLE_SNAPSHOT);
  }
}

/**
 * Atomically transitions the lease from ACTIVE to DATA_READY_COVERED.
 * Single mutation+notification: lease becomes inactive for routing,
 * verified handoff is available, and visual snapshot is stored for
 * the cover overlay — all in the same render.
 */
export function completeTransitionLease(
  leaseId: string,
  userId: string,
  flowId: string,
  sessionGen: string,
  visual: SignupVisualSnapshot,
): void {
  if (_snapshot.leaseId !== leaseId) return;
  if (_snapshot.phase !== 'active') return;
  setSnapshot({
    phase: 'data_ready_covered',
    leaseId,
    flowId,
    userId,
    sessionGen,
    cacheVerified: true,
    visual,
  });
}

/**
 * Transitions from DATA_READY_COVERED to DASHBOARD_READY.
 * Called by the dashboard bridge when plan+progress are present
 * and onLayout has fired, with all identities matching.
 * Idempotent — calling multiple times with matching identities is safe.
 */
export function signalDashboardReady(
  leaseId: string,
  flowId: string,
  userId: string,
  sessionGen: string,
): boolean {
  if (_snapshot.leaseId !== leaseId) return false;
  if (_snapshot.phase !== 'data_ready_covered') return false;
  if (_snapshot.flowId !== flowId) return false;
  if (_snapshot.userId !== userId) return false;
  if (_snapshot.sessionGen !== sessionGen) return false;
  setSnapshot({
    ..._snapshot,
    phase: 'dashboard_ready',
  });
  return true;
}

/**
 * Clears the token after DASHBOARD_READY.
 */
export function clearTransitionLease(leaseId: string): void {
  if (_snapshot.leaseId !== leaseId) return;
  setSnapshot(IDLE_SNAPSHOT);
}

/**
 * Force-clears the lease to IDLE regardless of current state.
 * Used on unmount cleanup, logout, session change.
 */
export function forceReleaseTransitionLease(): void {
  if (_snapshot.phase !== 'idle') {
    setSnapshot(IDLE_SNAPSHOT);
  }
}

// ── Synchronous snapshot readers ───────────────────────────────────────────

/**
 * Returns true if a transition lease is currently active (phase=active).
 * DATA_READY_COVERED is NOT active — routing can proceed.
 */
export function hasActiveTransitionLease(): boolean {
  return _snapshot.phase === 'active';
}

/**
 * Returns the current snapshot. Used by useSyncExternalStore.
 * The snapshot contains the full handoff identity so _layout.tsx
 * can compute matchingReadyHandoff synchronously during render.
 */
export function getLeaseSnapshot(): LeaseSnapshot {
  return _snapshot;
}

/**
 * Returns the flowId of the active lease, or null.
 */
export function getActiveTransitionLeaseFlowId(): string | null {
  return _snapshot.phase === 'active' ? _snapshot.flowId : null;
}

/**
 * Returns the userId of the active lease, or null.
 */
export function getActiveTransitionLeaseUserId(): string | null {
  return _snapshot.phase === 'active' ? _snapshot.userId : null;
}

/**
 * Sets the userId on the active lease (after signUp returns with a session).
 */
export function setTransitionLeaseUserId(userId: string): void {
  if (_snapshot.phase === 'active') {
    setSnapshot({ ..._snapshot, userId });
  }
}

/**
 * Subscribes to lease state changes. Returns an unsubscribe function.
 * Used by _layout.tsx via useSyncExternalStore.
 */
export function subscribeToTransitionLease(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

// ── Legacy handoff API (deprecated) ────────────────────────────────────────

export function setVerifiedHandoff(_userId: string, _flowId: string): void {
  void _userId;
  void _flowId;
}

export function consumeVerifiedHandoff(userId: string): VerifiedHandoff | null {
  if ((_snapshot.phase === 'data_ready_covered' || _snapshot.phase === 'dashboard_ready') && _snapshot.userId === userId) {
    return {
      userId: _snapshot.userId,
      flowId: _snapshot.flowId!,
      leaseId: _snapshot.leaseId!,
      cacheVerified: _snapshot.cacheVerified,
    };
  }
  return null;
}

export function clearVerifiedHandoff(): void {
  // No-op — clearing is done via clearTransitionLease.
}
