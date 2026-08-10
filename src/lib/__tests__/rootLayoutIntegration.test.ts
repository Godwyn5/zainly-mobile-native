/// <reference types="jest" />
import {
  createTransitionLease,
  releaseTransitionLease,
  forceReleaseTransitionLease,
  hasActiveTransitionLease,
  setTransitionLeaseUserId,
  completeTransitionLease,
  signalDashboardReady,
  clearTransitionLease,
  getLeaseSnapshot,
  type SignupVisualSnapshot,
} from '../transitionLease';

const VISUAL: SignupVisualSnapshot = {
  surfaceType: 'signup',
  email: 'user@test.com',
  password: 'pass123',
  confirm: 'pass123',
  showPw: false,
  showConfirm: false,
};

// ── Helpers that mirror the decision logic in _layout.tsx ──────────────
function computeLeaseActive(phase: string): boolean {
  return phase === 'active';
}

function computeMatchingReadyHandoff(
  phase: string,
  snapshotUserId: string | null,
  cacheVerified: boolean,
  currentUserId: string | null,
): boolean {
  return (
    (phase === 'data_ready_covered' || phase === 'dashboard_ready') &&
    snapshotUserId === currentUserId &&
    cacheVerified === true
  );
}

// Mirrors _layout.tsx's `showCoverOverlay` exactly: mounted from ACTIVE
// (as soon as the lease carries a visual snapshot) through
// DATA_READY_COVERED, so the SAME overlay instance is already on top
// BEFORE Stack.Protected ever swaps route groups.
function computeShowCoverOverlay(
  phase: string,
  snapshotUserId: string | null,
  cacheVerified: boolean,
  currentUserId: string | null,
): boolean {
  return (
    phase === 'active' ||
    (phase === 'data_ready_covered' &&
      snapshotUserId === currentUserId &&
      cacheVerified === true)
  );
}

// Mirrors the JSX render guard: `showCoverOverlay && leaseSnapshot.visual`.
// The overlay never actually paints without a visual snapshot.
function computeOverlayRendered(
  phase: string,
  snapshotUserId: string | null,
  cacheVerified: boolean,
  currentUserId: string | null,
  visual: unknown,
): boolean {
  return computeShowCoverOverlay(phase, snapshotUserId, cacheVerified, currentUserId) && !!visual;
}

function computeAuthed(
  ready: boolean,
  hasSession: boolean,
  leaseActive: boolean,
): boolean {
  return ready && hasSession && !leaseActive;
}

function computeGuest(
  ready: boolean,
  hasSession: boolean,
  leaseActive: boolean,
): boolean {
  return ready && (!hasSession || leaseActive);
}

describe('Root layout integration — 8 scenarios', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
  });

  // ── Scenario 1: IDLE state — no lease, no session ──
  it('1. IDLE: guest routes visible, no cover, no matching handoff', () => {
    const snapshot = getLeaseSnapshot();
    const userId = null;
    const ready = true;
    const hasSession = false;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const guest = computeGuest(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('idle');
    expect(authed).toBe(false);
    expect(guest).toBe(true);
    expect(matching).toBe(false);
    expect(cover).toBe(false);
    expect(hasActiveTransitionLease()).toBe(false);
  });

  // ── Scenario 2: ACTIVE state — lease active, session exists but guest routing ──
  it('2. ACTIVE: lease blocks auth, guest=true, no matching handoff (cover overlay\n     is a separate concern from routing — see scenario 2b)', () => {
    createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';
    const ready = true;
    const hasSession = true;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const guest = computeGuest(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('active');
    expect(leaseActive).toBe(true);
    expect(authed).toBe(false);
    expect(guest).toBe(true);
    expect(matching).toBe(false);
    expect(hasActiveTransitionLease()).toBe(true);
  });

  // ── Scenario 2b: ACTIVE with an early visual snapshot — the signup cover
  // is ALREADY mounted, well before any route swap, closing the
  // native-stack transition race that produced the beige frame. ──
  it('2b. ACTIVE with visual: overlay already rendered before any route swap', () => {
    createTransitionLease('flow-123', VISUAL);
    setTransitionLeaseUserId('user-A');
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';

    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const rendered = computeOverlayRendered(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId, snapshot.visual,
    );

    expect(snapshot.phase).toBe('active');
    expect(snapshot.visual).toEqual(VISUAL);
    expect(cover).toBe(true);
    expect(rendered).toBe(true);
  });

  // ── Scenario 2c: ACTIVE without a visual snapshot (e.g. a caller that
  // omits it) — showCoverOverlay is true but the overlay never actually
  // paints, matching the JSX guard. No beige, no blank overlay either. ──
  it('2c. ACTIVE without visual: overlay flag true but nothing renders', () => {
    createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';

    const rendered = computeOverlayRendered(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId, snapshot.visual,
    );

    expect(snapshot.visual).toBeNull();
    expect(rendered).toBe(false);
  });

  // ── Scenario 3: DATA_READY_COVERED — authed=true, matching handoff, cover visible ──
  it('3. DATA_READY_COVERED: authed=true, matchingReadyHandoff=true, cover=true', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';
    const ready = true;
    const hasSession = true;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const guest = computeGuest(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const rendered = computeOverlayRendered(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId, snapshot.visual,
    );

    expect(snapshot.phase).toBe('data_ready_covered');
    expect(leaseActive).toBe(false);
    expect(authed).toBe(true);
    expect(guest).toBe(false);
    expect(matching).toBe(true);
    expect(cover).toBe(true);
    expect(rendered).toBe(true);
    expect(snapshot.cacheVerified).toBe(true);
    expect(snapshot.visual).toEqual(VISUAL);
    expect(snapshot.sessionGen).toBe('gen-1');
  });

  // ── Scenario 4: DASHBOARD_READY — authed=true, matching=true, cover removed ──
  it('4. DASHBOARD_READY: authed=true, matching=true, cover=false', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-1');
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';
    const ready = true;
    const hasSession = true;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('dashboard_ready');
    expect(authed).toBe(true);
    expect(matching).toBe(true);
    expect(cover).toBe(false);
  });

  // ── Scenario 5: IDLE after DASHBOARD_READY → clearTransitionLease ──
  it('5. IDLE after clear: durable state persists, no cover, no matching', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-1');
    clearTransitionLease(leaseId);
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';
    const ready = true;
    const hasSession = true;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('idle');
    expect(authed).toBe(true);
    expect(matching).toBe(false);
    expect(cover).toBe(false);
  });

  // ── Scenario 6: Error during ACTIVE → releaseTransitionLease → IDLE ──
  it('6. Error path: releaseTransitionLease → IDLE, no cover, no matching', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    releaseTransitionLease(leaseId);
    const snapshot = getLeaseSnapshot();
    const userId = 'user-A';
    const ready = true;
    const hasSession = true;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('idle');
    expect(snapshot.cacheVerified).toBe(false);
    expect(authed).toBe(true);
    expect(matching).toBe(false);
    expect(cover).toBe(false);
  });

  // ── Scenario 7: Account switch — userId mismatch → no matching, no cover ──
  it('7. Account switch: DATA_READY_COVERED for user-A but current=user-B → no match', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const snapshot = getLeaseSnapshot();
    const currentUserId = 'user-B';

    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, currentUserId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, currentUserId,
    );

    expect(snapshot.phase).toBe('data_ready_covered');
    expect(snapshot.userId).toBe('user-A');
    expect(matching).toBe(false);
    expect(cover).toBe(false);
  });

  // ── Scenario 8: Logout — forceReleaseTransitionLease from DATA_READY_COVERED ──
  it('8. Logout: forceRelease from DATA_READY_COVERED → IDLE, no cover', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');

    forceReleaseTransitionLease();
    const snapshot = getLeaseSnapshot();
    const userId = null;
    const ready = true;
    const hasSession = false;

    const leaseActive = computeLeaseActive(snapshot.phase);
    const authed = computeAuthed(ready, hasSession, leaseActive);
    const guest = computeGuest(ready, hasSession, leaseActive);
    const matching = computeMatchingReadyHandoff(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );
    const cover = computeShowCoverOverlay(
      snapshot.phase, snapshot.userId, snapshot.cacheVerified, userId,
    );

    expect(snapshot.phase).toBe('idle');
    expect(snapshot.cacheVerified).toBe(false);
    expect(snapshot.visual).toBeNull();
    expect(authed).toBe(false);
    expect(guest).toBe(true);
    expect(matching).toBe(false);
    expect(cover).toBe(false);
  });
});
