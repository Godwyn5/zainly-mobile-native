// ─── Transition lease — prevents route group swap during onboarding finalization ──
// When the user taps "Créer mon compte" or "Se connecter" from an onboarding-v2
// parcours, a transition lease is created BEFORE supabase.auth.signUp/signIn.
// While the lease is active, _layout.tsx treats the user as still
// unauthenticated — Stack.Protected does NOT swap to the (app) group, the
// signup/login screen stays mounted, and prepareAuthenticatedLaunch is skipped.
//
// The handler then runs finalize → handoff → clear → cache verification
// synchronously after signUp returns, and releases the lease only when the
// cache is confirmed populated. The route group swap then happens naturally,
// and the dashboard mounts with canonical data on its first frame.
//
// On any failure (finalize, handoff, premium gate, session change), the lease
// is released but the handler sets an error state on the signup/login screen
// itself — the dashboard never mounts with incomplete data.

interface ActiveLease {
  flowId: string;
  leaseId: string;
  userId: string | null;
}

export interface VerifiedHandoff {
  userId: string;
  flowId: string;
  handoffId: string;
}

let _activeLease: ActiveLease | null = null;
let _verifiedHandoff: VerifiedHandoff | null = null;
const _subscribers = new Set<() => void>();

function notify(): void {
  _subscribers.forEach((fn) => fn());
}

/**
 * Creates a transition lease identified by the onboarding flowId.
 * Returns a unique leaseId that must be passed to releaseTransitionLease.
 * Throws if a lease is already active (double-tap guard).
 */
export function createTransitionLease(flowId: string): string {
  if (_activeLease) {
    throw new Error('A transition lease is already active');
  }
  const leaseId = `${flowId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  _activeLease = { flowId, leaseId, userId: null };
  notify();
  return leaseId;
}

/**
 * Releases the transition lease. Only releases if the leaseId matches
 * the active lease (prevents stale releases from a superseded flow).
 */
export function releaseTransitionLease(leaseId: string): void {
  if (_activeLease?.leaseId === leaseId) {
    _activeLease = null;
    notify();
  }
}

/**
 * Force-releases the active lease (e.g. on unmount cleanup).
 */
export function forceReleaseTransitionLease(): void {
  if (_activeLease) {
    _activeLease = null;
    notify();
  }
}

/**
 * Returns true if a transition lease is currently active.
 */
export function hasActiveTransitionLease(): boolean {
  return _activeLease !== null;
}

/**
 * Returns the flowId of the active lease, or null if no lease is active.
 */
export function getActiveTransitionLeaseFlowId(): string | null {
  return _activeLease?.flowId ?? null;
}

/**
 * Returns the userId of the active lease, or null if not yet set.
 */
export function getActiveTransitionLeaseUserId(): string | null {
  return _activeLease?.userId ?? null;
}

/**
 * Sets the userId on the active lease (after signUp returns with a session).
 */
export function setTransitionLeaseUserId(userId: string): void {
  if (_activeLease) {
    _activeLease = { ..._activeLease, userId };
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

/**
 * Stores a verified handoff — called by runOnboardingTransition AFTER
 * cache verification succeeds, BEFORE releasing the lease.
 * The handoff proves that plan+progress are canonically cached for this
 * exact userId/flowId, so _layout.tsx can skip the preparing state.
 */
export function setVerifiedHandoff(userId: string, flowId: string): void {
  _verifiedHandoff = {
    userId,
    flowId,
    handoffId: `${flowId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Atomically reads and clears the verified handoff.
 * Returns the handoff if it exists and matches the given userId.
 * Returns null if no handoff exists or the userId doesn't match
 * (prevents cross-account bypass).
 *
 * Called by _layout.tsx when the lease is released.
 */
export function consumeVerifiedHandoff(userId: string): VerifiedHandoff | null {
  if (_verifiedHandoff && _verifiedHandoff.userId === userId) {
    const handoff = _verifiedHandoff;
    _verifiedHandoff = null;
    return handoff;
  }
  _verifiedHandoff = null;
  return null;
}

/**
 * Clears any stored handoff without returning it.
 * Called on logout, session change, or force-release.
 */
export function clearVerifiedHandoff(): void {
  _verifiedHandoff = null;
}
