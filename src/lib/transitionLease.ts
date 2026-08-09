// ─── Transition lease — atomic state machine for onboarding finalization ────
//
// State machine:
//   IDLE → ACTIVE → READY_UNACKNOWLEDGED → READY_COMMITTED → IDLE
//
// ACTIVE: signup/login screen is mounted, finalize+handoff is running.
//   _layout.tsx treats user as unauthenticated (guest=true).
//
// READY_UNACKNOWLEDGED: finalize+handoff+clear+cache-verification all succeeded.
//   The lease is no longer active for routing, AND the verified handoff
//   identity is available in the SAME snapshot. _layout.tsx reads the
//   snapshot synchronously during render and computes matchingReadyHandoff.
//   If it matches, canRenderStack=true and showMinimalScreen=false for that
//   exact render — no beige screen.
//
// READY_COMMITTED: _layout.tsx has committed the durable accountPreparation
//   state to 'ready' via setState. The handoff token is no longer needed.
//
// IDLE: token cleared, no observable side effects.

export type LeasePhase = 'idle' | 'active' | 'ready_unacknowledged' | 'ready_committed';

export interface LeaseSnapshot {
  phase: LeasePhase;
  leaseId: string | null;
  flowId: string | null;
  userId: string | null;
  cacheVerified: boolean;
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
  cacheVerified: false,
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
export function createTransitionLease(flowId: string): string {
  if (_snapshot.phase === 'active' || _snapshot.phase === 'ready_unacknowledged') {
    throw new Error('A transition lease is already active');
  }
  const leaseId = `${flowId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setSnapshot({
    phase: 'active',
    leaseId,
    flowId,
    userId: null,
    cacheVerified: false,
  });
  return leaseId;
}

/**
 * Releases the transition lease WITHOUT a verified handoff.
 * Used on error paths (finalize failure, handoff failure, etc.).
 * Only releases if the leaseId matches the active lease.
 * Transitions directly to IDLE — no READY_UNACKNOWLEDGED state.
 */
export function releaseTransitionLease(leaseId: string): void {
  if (_snapshot.leaseId === leaseId) {
    setSnapshot(IDLE_SNAPSHOT);
  }
}

/**
 * Atomically transitions the lease from ACTIVE to READY_UNACKNOWLEDGED.
 * This is the single mutation+notification that makes both:
 *   - the lease inactive for routing (authed can become true)
 *   - the verified handoff available in the same render
 *
 * Must be called ONLY after cache verification succeeds.
 * Requires the leaseId to match.
 */
export function completeTransitionLease(
  leaseId: string,
  userId: string,
  flowId: string,
): void {
  if (_snapshot.leaseId !== leaseId) return;
  if (_snapshot.phase !== 'active') return;
  setSnapshot({
    phase: 'ready_unacknowledged',
    leaseId,
    flowId,
    userId,
    cacheVerified: true,
  });
}

/**
 * Promotes from READY_UNACKNOWLEDGED to READY_COMMITTED.
 * Called by _layout.tsx AFTER it has committed the durable
 * accountPreparation state to 'ready'. This prevents the handoff
 * token from being consumed before the durable state is committed.
 */
export function commitTransitionLease(leaseId: string): void {
  if (_snapshot.leaseId !== leaseId) return;
  if (_snapshot.phase !== 'ready_unacknowledged') return;
  setSnapshot({
    ..._snapshot,
    phase: 'ready_committed',
  });
}

/**
 * Clears the token after the durable state is committed.
 * Transitions from READY_COMMITTED to IDLE.
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

// ── Synchronous snapshot readers (for useSyncExternalStore) ────────────────

/**
 * Returns true if a transition lease is currently active (phase=active).
 * READY_UNACKNOWLEDGED is NOT active — routing can proceed.
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

// ── Legacy handoff API (deprecated, replaced by snapshot) ──────────────────
// These are kept for backward compatibility with tests but should not
// be used in new code. The snapshot-based API is the source of truth.

export function setVerifiedHandoff(userId: string, flowId: string): void {
  // No-op in the new state machine — handoff is part of the snapshot.
  // Kept for backward compatibility.
  void userId;
  void flowId;
}

export function consumeVerifiedHandoff(userId: string): VerifiedHandoff | null {
  if (_snapshot.phase === 'ready_unacknowledged' && _snapshot.userId === userId) {
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
  // No-op in the new state machine — clearing is done via clearTransitionLease.
}
