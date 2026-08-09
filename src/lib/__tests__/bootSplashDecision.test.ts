/// <reference types="jest" />
// ─── Boot splash decision tests ─────────────────────────────────────────────
// Tests that the custom branded splash is shown ONLY for authenticated users
// during the initial boot process, and never for guests, post-boot events,
// or after logout.

import {
  canRenderStackForUser,
  shouldShowCustomSplash,
  shouldShowPreparationError,
  createInitialPreparationState,
  createPreparingState,
  createReadyState,
  createErrorState,
} from '../preparationStateMachine';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bootState(opts: {
  bootCompleted?: boolean;
  ready?: boolean;
  authed?: boolean;
  canRender?: boolean;
  hasError?: boolean;
}) {
  return shouldShowCustomSplash(
    opts.bootCompleted ?? false,
    opts.ready ?? true,
    opts.authed ?? false,
    opts.canRender ?? false,
    opts.hasError ?? false,
  );
}

// ─── 1. First install with no session → Welcome without custom splash ───────

describe('Boot splash decision', () => {
  it('1. first install (no session) → no custom splash', () => {
    // ready=true, authed=false → guest → no splash
    expect(bootState({ ready: true, authed: false, canRender: true })).toBe(false);
  });

  // ─── 2. Boot with valid session → splash then authenticated journey ──────

  it('2. valid session at boot → custom splash shown until preparation ready', () => {
    // During preparation: authed, not yet ready to render, boot not complete
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: false })).toBe(true);
    // Once ready: splash hidden
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: true })).toBe(false);
  });

  // ─── 3. Expired or unusable session → Welcome without old dashboard ──────

  it('3. expired session (unauthenticated) → no splash, no old dashboard', () => {
    // Session expired → authed=false → guest path → no splash
    expect(bootState({ ready: true, authed: false, canRender: true })).toBe(false);
    // canRenderStackForUser: guest can render immediately
    expect(canRenderStackForUser(false, true, false, createInitialPreparationState(), null)).toBe(true);
  });

  // ─── 4. In-app logout → Welcome without splash ───────────────────────────

  it('4. logout → no splash replayed (bootCompleted stays true)', () => {
    // After boot completed, even if authed becomes false, no splash
    expect(bootState({ bootCompleted: true, ready: true, authed: false, canRender: true })).toBe(false);
    // Even if somehow authed and canRender false after boot, no splash
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: false })).toBe(false);
  });

  // ─── 5. Restart after logout → Welcome without splash ────────────────────

  it('5. restart after logout → no splash (fresh boot, no session)', () => {
    // Fresh boot: bootCompleted=false, but no session → guest → no splash
    expect(bootState({ bootCompleted: false, ready: true, authed: false, canRender: true })).toBe(false);
  });

  // ─── 6. Return from background → no splash replayed ──────────────────────

  it('6. background return → no splash replayed (bootCompleted is true)', () => {
    // Boot already completed, returning from background
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: true })).toBe(false);
    expect(bootState({ bootCompleted: true, ready: true, authed: false, canRender: true })).toBe(false);
  });

  // ─── 7. Auth state change after boot → no splash replayed ────────────────

  it('7. onAuthStateChange after boot → no splash replayed', () => {
    // Session refresh, token rotation, etc. after boot — no splash
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: true })).toBe(false);
  });

  // ─── 8. Login from Welcome → current flow preserved, no opening splash ───

  it('8. in-app login → no splash (bootCompleted may or may not be true)', () => {
    // If boot already completed (guest saw Welcome, then logged in):
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: false })).toBe(false);
    // If boot not yet completed but user was guest (canRender was true for guest):
    // After login, authed=true, canRender=false (preparation not ready),
    // but bootCompleted is already true because guest could render.
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: false })).toBe(false);
  });

  // ─── 9. Authenticated user with incomplete onboarding → destination preserved

  it('9. authed with incomplete onboarding → splash during boot, then routing', () => {
    // During boot: splash shown
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: false })).toBe(true);
    // Once preparation ready (pending onboarding in cache): splash hidden
    // canRenderStackForUser returns true when preparation is ready
    expect(canRenderStackForUser(true, true, true, createReadyState('user-A'), 'user-A')).toBe(true);
    // Splash not shown
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: true })).toBe(false);
  });

  // ─── 10. No decision based solely on cache or old user ID ────────────────

  it('10. decision is based on current session, not cache or old userId', () => {
    // shouldShowCustomSplash takes authed (derived from session), not userId or cache
    // If authed=false (no session), no splash regardless of any other state
    expect(bootState({ bootCompleted: false, ready: true, authed: false, canRender: false })).toBe(false);
    // If authed=true but bootCompleted=true (post-boot), no splash
    expect(bootState({ bootCompleted: true, ready: true, authed: true, canRender: false })).toBe(false);
  });

  // ─── 11. No flash of old account data ────────────────────────────────────

  it('11. no flash of old account data (guest renders immediately after ready)', () => {
    // Guest doesn't need initialVisualReleased
    expect(canRenderStackForUser(false, true, false, createInitialPreparationState(), null)).toBe(true);
    // During resolving (!ready), neither stack nor branded splash is shown
    expect(bootState({ ready: false, authed: false, canRender: false })).toBe(false);
    expect(bootState({ ready: false, authed: true, canRender: false })).toBe(false);
  });

  // ─── 12. No artificial delay on unauthenticated path ─────────────────────

  it('12. no artificial delay for guest (initialVisualReleased not required)', () => {
    // Guest can render even when initialVisualReleased=false
    expect(canRenderStackForUser(false, true, false, createInitialPreparationState(), null)).toBe(true);
    // No splash for guest
    expect(bootState({ bootCompleted: false, ready: true, authed: false, canRender: true })).toBe(false);
  });

  // ─── 13. Deep links and public callbacks not overwritten ─────────────────

  it('13. deep links preserved (public routes accessible for guests)', () => {
    // Guest can render stack → public routes including (auth) group available
    expect(canRenderStackForUser(false, true, false, createInitialPreparationState(), null)).toBe(true);
    // No splash blocking the view for guests
    expect(bootState({ bootCompleted: false, ready: true, authed: false, canRender: true })).toBe(false);
  });

  // ─── 14. Authenticated boot preserves preloading before dashboard ────────

  it('14. authed boot: splash shown during preparation, hidden when ready', () => {
    // Preparation in progress: splash shown
    const prepState = createPreparingState('user-A');
    const canRender = canRenderStackForUser(true, true, true, prepState, 'user-A');
    expect(canRender).toBe(false);
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender })).toBe(true);

    // Preparation ready: splash hidden, dashboard can mount with full cache
    const readyState = createReadyState('user-A');
    const canRenderReady = canRenderStackForUser(true, true, true, readyState, 'user-A');
    expect(canRenderReady).toBe(true);
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: canRenderReady })).toBe(false);
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it('preparation error during initial boot → no splash, error screen instead', () => {
    const errState = createErrorState('user-A', 'timeout');
    const hasError = shouldShowPreparationError(true, errState, 'user-A');
    expect(hasError).toBe(true);
    // Splash not shown when error should be shown
    expect(bootState({ bootCompleted: false, ready: true, authed: true, canRender: false, hasError: true })).toBe(false);
  });

  it('resolving state → no splash (neither guest nor authed)', () => {
    // !ready → resolving → no splash (minimal beige screen shown by layout)
    expect(bootState({ ready: false, authed: false, canRender: false })).toBe(false);
    expect(bootState({ ready: false, authed: true, canRender: false })).toBe(false);
  });
});
