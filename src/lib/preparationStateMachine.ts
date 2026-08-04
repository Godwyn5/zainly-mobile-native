// ─── Preparation state machine — pure logic for multi-account safety ──────
// Extracted from app/_layout.tsx so the generation/acceptance logic can be
// unit-tested without rendering React components.

export type PreparationStatus = 'idle' | 'preparing' | 'ready' | 'error';

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
 * Creates an "error" state for a given userId.
 */
export function createErrorState(userId: string, error: unknown): PreparationState {
  return { userId, status: 'error', error };
}

/**
 * Returns true if the gate should render the Stack (user is authenticated
 * and preparation is ready for the current userId).
 */
export function canRenderStackForUser(
  initialVisualReleased: boolean,
  authReady: boolean,
  authed: boolean,
  preparation: PreparationState,
  currentUserId: string | null,
): boolean {
  if (!initialVisualReleased || !authReady) return false;
  if (!authed) return true; // guest can render
  if (preparation.userId !== currentUserId) return false;
  return preparation.status === 'ready';
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
