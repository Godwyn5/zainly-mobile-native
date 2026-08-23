// ─── Preparation state machine — pure logic for multi-account safety ──────
// Extracted from app/_layout.tsx so the generation/acceptance logic can be
// unit-tested without rendering React components.

export type PreparationStatus = 'idle' | 'preparing' | 'ready' | 'needs_onboarding' | 'account_not_found' | 'error';

export interface PreparationIdentity {
  userId: string;
  generation: number;
}

export interface PreparationState {
  userId: string | null;
  status: PreparationStatus;
  error?: unknown;
}

/**
 * Returns true if a preparation result (ready or error) should be accepted
 * for the current state. Checks three conditions:
 * 1. The generation at completion matches the generation at start.
 * 2. The userId at completion matches the userId at start.
 * 3. The session userId still matches (caller must verify externally).
 */
export function acceptResultForUser(
  startGeneration: number,
  currentGeneration: number,
  startUserId: string,
  currentUserId: string | null,
): boolean {
  if (currentGeneration !== startGeneration) return false;
  if (currentUserId !== startUserId) return false;
  return true;
}

/**
 * Creates the initial preparation state.
 */
export function createInitialPreparationState(): PreparationState {
  return { userId: null, status: 'idle' };
}

/**
 * Creates a "preparing" state for a given userId.
 */
export function createPreparingState(userId: string): PreparationState {
  return { userId, status: 'preparing' };
}

/**
 * Creates a "ready" state for a given userId.
 */
export function createReadyState(userId: string): PreparationState {
  return { userId, status: 'ready' };
}

/**
 * Creates a "needs_onboarding" state for a given userId.
 * The user authenticated successfully but no Zainly account (plan +
 * progress) is associated with this identity, and no onboarding handoff
 * is active. The root layout mounts the onboarding-only Stack and
 * navigates to /onboarding-v2/name.
 */
export function createNeedsOnboardingState(userId: string): PreparationState {
  return { userId, status: 'needs_onboarding' };
}

/**
 * Creates an "account_not_found" state for a given userId.
 * The user authenticated successfully but no Zainly account (plan +
 * progress) is associated with this identity, and no onboarding handoff
 * is active. The root layout reacts by performing a fail-closed local
 * sign-out and targeted cache purge, then lets the guest auth stack show
 * the "Compte introuvable" message. (app) is NEVER mounted for this state.
 */
export function createAccountNotFoundState(userId: string): PreparationState {
  return { userId, status: 'account_not_found' };
}

/**
 * Creates an "error" state for a given userId.
 */
export function createErrorState(userId: string, error: unknown): PreparationState {
  return { userId, status: 'error', error };
}

/**
 * Returns true if the gate should render the Stack with the (app) group
 * for an authenticated user. This means the user is authenticated AND
 * preparation is 'ready' for the current userId.
 *
 * 'needs_onboarding' and 'account_not_found' do NOT allow the (app) stack
 * to render — the root layout handles them separately.
 *
 * Guests can render immediately after authReady — they do not need
 * initialVisualReleased (the 1200ms branded-splash timer is authed-only).
 */
export function canRenderStackForUser(
  initialVisualReleased: boolean,
  authReady: boolean,
  authed: boolean,
  preparation: PreparationState,
  currentUserId: string | null,
): boolean {
  if (!authReady) return false;
  if (!authed) return true; // guest can render immediately
  if (!initialVisualReleased) return false;
  if (preparation.userId !== currentUserId) return false;
  return preparation.status === 'ready';
}

/**
 * Returns true if the branded custom splash should be shown.
 * The splash is shown ONLY for authenticated users during the initial
 * boot process (before the stack can be rendered). It is never shown
 * for guests, during resolving, after boot completes, or when an error
 * screen should be shown instead.
 */
export function shouldShowCustomSplash(
  bootCompleted: boolean,
  authReady: boolean,
  authed: boolean,
  canRender: boolean,
  hasPreparationError: boolean,
): boolean {
  if (!authReady) return false;
  if (!authed) return false;
  if (bootCompleted) return false;
  if (hasPreparationError) return false;
  return !canRender;
}

/**
 * Returns true if the gate should show the preparation error screen.
 */
export function shouldShowPreparationError(
  authed: boolean,
  preparation: PreparationState,
  currentUserId: string | null,
): boolean {
  if (!authed) return false;
  if (preparation.userId !== currentUserId) return false;
  return preparation.status === 'error';
}

/**
 * Returns true if the gate should perform the fail-closed sign-out for
 * account_not_found. This is the transient window between the preparation
 * effect resolving 'account_not_found' and the local session actually
 * being cleared — (app) must never mount and no error screen is shown
 * during this window, only the beige minimal overlay (via
 * shouldShowMinimalOverlay's generic authed-but-not-ready branch).
 */
export function shouldSignOutForAccountNotFound(
  authed: boolean,
  preparation: PreparationState,
  currentUserId: string | null,
): boolean {
  if (!authed) return false;
  if (preparation.userId !== currentUserId) return false;
  return preparation.status === 'account_not_found';
}

/**
 * Returns true if the gate should mount the onboarding-only Stack
 * (onboarding-v2 routes only, no (app) group). This is true when the
 * user is authenticated, initialVisualReleased is true, and the
 * preparation status is 'needs_onboarding' for the current userId.
 */
export function canRenderOnboardingStackForUser(
  initialVisualReleased: boolean,
  authReady: boolean,
  authed: boolean,
  preparation: PreparationState,
  currentUserId: string | null,
): boolean {
  if (!authReady) return false;
  if (!authed) return false;
  if (!initialVisualReleased) return false;
  if (preparation.userId !== currentUserId) return false;
  return preparation.status === 'needs_onboarding';
}

/**
 * Pure function that determines whether the root layout should navigate
 * to /onboarding-v2/name. Returns the userId if navigation should fire,
 * or null otherwise. The caller tracks a ref of the last userId navigated
 * to prevent duplicate navigation.
 */
export function shouldNavigateToOnboarding(
  canRenderOnboardingStack: boolean,
  userId: string | null,
  lastNavigatedUserId: string | null,
): string | null {
  if (!canRenderOnboardingStack) return null;
  if (!userId) return null;
  if (lastNavigatedUserId === userId) return null;
  return userId;
}

// ─── Route decision — pure function extracted from _layout.tsx ──────────────
// Encapsulates the root layout's routing decision so it can be unit-tested
// without rendering Expo Router components.

export type RouteDecision =
  | 'splash'          // branded splash (initial boot, authed)
  | 'minimal'         // beige screen (resolving, post-boot preparation, account_not_found sign-out in flight)
  | 'error'           // LaunchErrorScreen
  | 'onboarding'      // Stack with ONLY onboarding-v2 routes (needs_onboarding)
  | 'app';            // Stack with (app) + public + onboarding routes (ready/guest)

export interface RouteDecisionInput {
  authReady: boolean;
  authed: boolean;
  bootCompleted: boolean;
  initialVisualReleased: boolean;
  preparation: PreparationState;
  currentUserId: string | null;
  matchingReadyHandoff: boolean;
}

/**
 * Pure function that determines which route surface the root layout should
 * render. The decision tree is:
 *
 * 1. Not authReady → minimal (session unknown)
 * 2. Authed + preparation error → error screen
 * 3. Authed + needs_onboarding + initialVisualReleased → onboarding stack
 * 4. Authed + ready (or matchingReadyHandoff) + initialVisualReleased → app
 * 5. Authed + account_not_found → minimal (fail-closed sign-out in flight;
 *    once the sign-out completes, the user becomes a guest and this
 *    function naturally returns 'app' — the guest auth stack)
 * 6. Authed + not yet released → splash (initial boot) or minimal (post-boot)
 * 7. Guest → app (public routes)
 */
export function computeRouteDecision(input: RouteDecisionInput): RouteDecision {
  const {
    authReady, authed, bootCompleted, initialVisualReleased,
    preparation, currentUserId, matchingReadyHandoff,
  } = input;

  if (!authReady) return 'minimal';

  if (authed) {
    if (shouldShowPreparationError(authed, preparation, currentUserId)) {
      return 'error';
    }

    // needs_onboarding → onboarding-only stack (if initialVisualReleased)
    if (initialVisualReleased &&
        preparation.userId === currentUserId &&
        preparation.status === 'needs_onboarding') {
      return 'onboarding';
    }

    const canApp = canRenderStackForUser(
      initialVisualReleased, authReady, authed,
      { userId: currentUserId, status: matchingReadyHandoff ? 'ready' : preparation.status },
      currentUserId,
    );
    if (canApp) return 'app';

    // Authed but not yet released or still preparing (includes the
    // transient account_not_found window while sign-out is in flight).
    if (!bootCompleted && initialVisualReleased === false) {
      // Still in initial boot — show branded splash
      // But only if canRender is false (which it is here)
      if (!shouldShowPreparationError(authed, preparation, currentUserId)) {
        return 'splash';
      }
    }
    return 'minimal';
  }

  // Guest
  if (!authReady) return 'minimal';
  return 'app';
}

/**
 * Pure function that determines whether the minimal beige overlay should
 * be visible.
 *
 * The overlay must be visible:
 *   - When the session is not yet resolved (!authReady)
 *   - During post-boot preparation (authed, not ready, not error) —
 *     this includes the transient account_not_found sign-out window,
 *     since canRenderStack is false and showPreparationError is false
 *     for that status too.
 *   - During needs_onboarding BEFORE the onboarding route is active.
 *
 * The overlay must NOT be visible:
 *   - When the status is 'error' (LaunchErrorScreen is shown instead)
 *   - When the status is 'ready' (the app Stack is mounted)
 *   - When onboardingRouteActive is true (user is on /onboarding-v2/* route)
 */
export function shouldShowMinimalOverlay(
  authReady: boolean,
  authed: boolean,
  bootCompleted: boolean,
  canRenderStack: boolean,
  canRenderOnboardingStack: boolean,
  showPreparationError: boolean,
  onboardingRouteActive: boolean,
): boolean {
  if (!authReady) return true;
  if (bootCompleted && authed && !canRenderStack && !showPreparationError) return true;
  if (authed && canRenderOnboardingStack && !onboardingRouteActive) return true;
  return false;
}
