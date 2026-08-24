// ─── Pending onboarding-v2 plan — durable, minimal, pre-auth safety net ────
// The in-memory onboarding draft (onboardingDraft.ts) is intentionally lost
// on app kill — that is correct for as long as the user is still answering
// questions. It stops being acceptable the moment the plan has been
// validated/generated and the user has tapped "Commencer mon Hifz": from
// that instant, losing the app (email confirmation flow, background kill,
// crash) must never lose the program itself.
//
// This module is that single, narrow safety net — written to AsyncStorage
// (already a project dependency) ONLY at that one moment
// (program-summary.tsx, right before navigating to signup), never earlier.
//
// Deliberately stores the strict minimum needed to rebuild a PlanInput and
// to know whether a reminder should be scheduled — never motivationReason,
// never any RevenueCat/auth/token data. firstName IS included (added
// alongside profiles.first_name persistence in onboardingFinalize.ts) so a
// finalization surviving an app kill / email-confirmation detour can still
// personalize the account it creates.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LearningMode, NotificationPreference, DiscoverySource } from './onboardingDraft';
import { purgeAllOnboardingDrafts, claimDraftForUser, readOnboardingDraftForOwner, clearOnboardingDraftForOwner, getOrCreateGuestFlowId, clearGuestFlowId } from './onboardingDraft';

const STORAGE_KEY = 'zainly:onboardingV2:pendingPlan';
const HANDOFF_KEY = 'zainly:onboardingV2:authHandoff';
const ACTIVE_AUTH_FLOW_KEY = 'zainly:onboardingV2:activeAuthFlow';
const GUEST_DRAFT_HANDOFF_KEY = 'zainly:onboardingV2:guestDraftHandoff';
const COMPLETED_AUTH_PROOF_KEY = 'zainly:onboardingV2:completedAuthProof';
const CURRENT_VERSION = 1 as const;
const TTL_MS = 72 * 60 * 60 * 1000; // 72h
const HANDOFF_TTL_MS = 72 * 60 * 60 * 1000; // 72h — same as payload
const ACTIVE_AUTH_FLOW_TTL_MS = 72 * 60 * 60 * 1000; // 72h
const GUEST_DRAFT_HANDOFF_TTL_MS = 72 * 60 * 60 * 1000; // 72h
const COMPLETED_AUTH_PROOF_TTL_MS = 72 * 60 * 60 * 1000; // 72h

/**
 * Generates a sufficiently unique, non-predictable flow identifier.
 * Uses crypto.getRandomValues when available (React Native 0.73+),
 * falls back to Date.now + Math.random for older runtimes.
 * Format: 8-4-4-4-12 hex (UUID v4-like).
 */
function generateFlowId(): string {
  try {
    // React Native polyfills crypto.getRandomValues via expo-random or the
    // built-in polyfill in RN 0.73+.
    const g = globalThis as unknown as { crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array } };
    if (g.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      g.crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
  } catch { /* fall through */ }
  // Fallback: still unique enough for app-level flow correlation
  return `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const VALID_LEARNING_MODES: LearningMode[] = ['recommended', 'start_surah', 'custom_order'];
const VALID_NOTIFICATION_PREFERENCES: NotificationPreference[] = [
  'enabled', 'denied', 'skipped', 'already_granted',
];
const VALID_DISCOVERY_SOURCES: DiscoverySource[] = [
  'tiktok', 'instagram', 'youtube', 'google', 'app_store', 'word_of_mouth', 'other',
];

export interface PendingOnboardingPlanV1 {
  version: 1;
  createdAt: string;
  firstName: string | null;
  learningMode: LearningMode;
  knownSurahs: number[];
  startingSurah: number | null;
  customSurahOrder: number[];
  continueWithRest: boolean;
  notificationPreference: NotificationPreference | null;
  discoverySource: DiscoverySource | null;
  // userId of the account that claimed this payload during finalization.
  // null means the payload was created pre-auth and is still unclaimed.
  // Once set, only that userId may use it.
  ownerUserId?: string | null;
  // Cryptographically unique flow identifier, generated at program-summary
  // when the payload is saved. The same flowId is stored in the authHandoff
  // marker. After auth, the payload can only be claimed if both flowIds
  // match. Legacy payloads without flowId are rejected (not auto-claimed).
  flowId?: string | null;
}

export type PendingPlanInput = Omit<PendingOnboardingPlanV1, 'version' | 'createdAt'>;

// ─── Active onboarding auth flow marker ─────────────────────────────────────
// Written to AsyncStorage exactly once: when the user confirms leaving
// program-summary toward auth (signup or login). This is the durable,
// cold-start-safe proof that the current auth session originated from an
// onboarding-v2 parcours. It survives app kills, unlike _sessionAuthFlowId.
//
// Lifecycle:
//   Created: program-summary navigates to signup-methods / login-methods
//   Cleared: claim success, logout, abandon toward Welcome, expiry
//   NOT created: normal Welcome login, deep link unrelated to onboarding V2
//   NOT read: during a Welcome-only auth flow (activeAuthFlow check is
//              gated by a runtime condition in claimPendingOnboardingPlanForUser)

export interface ActiveOnboardingAuthFlowV1 {
  version: 1;
  flowId: string;
  createdAt: string;
  source: 'onboarding-v2';
}

function isValidActiveAuthFlow(raw: unknown): raw is ActiveOnboardingAuthFlowV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.flowId !== 'string' || !d.flowId) return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
  if (d.source !== 'onboarding-v2') return false;
  return true;
}

function isActiveAuthFlowExpired(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  return Date.now() - created > ACTIVE_AUTH_FLOW_TTL_MS;
}

/**
 * Persists the active onboarding auth flow marker. Called by program-summary
 * right before navigating to auth. Survives app kills — unlike the in-memory
 * _sessionAuthFlowId. Never throws.
 */
export async function saveActiveOnboardingAuthFlow(flowId: string): Promise<void> {
  try {
    const marker: ActiveOnboardingAuthFlowV1 = {
      version: 1,
      flowId,
      createdAt: new Date().toISOString(),
      source: 'onboarding-v2',
    };
    await AsyncStorage.setItem(ACTIVE_AUTH_FLOW_KEY, JSON.stringify(marker));
  } catch {
    // Non-fatal — _sessionAuthFlowId remains the in-session fallback.
  }
}

/**
 * Reads the active onboarding auth flow marker. Returns null if missing,
 * corrupted, wrongly versioned, or expired. Never throws.
 */
export async function readActiveOnboardingAuthFlow(): Promise<ActiveOnboardingAuthFlowV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_AUTH_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidActiveAuthFlow(parsed) || isActiveAuthFlowExpired(parsed.createdAt)) {
      await clearActiveOnboardingAuthFlow();
      return null;
    }
    return parsed;
  } catch {
    await clearActiveOnboardingAuthFlow();
    return null;
  }
}

/** Removes the active auth flow marker. Never throws. */
export async function clearActiveOnboardingAuthFlow(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_AUTH_FLOW_KEY);
  } catch {
    // Non-fatal
  }
}

// ─── Auth handoff marker ──────────────────────────────────────────────────
// A separate AsyncStorage key, written alongside the pending payload at
// program-summary, that records the flowId of the onboarding parcours that
// created the payload. After auth, the claim function reads both the payload
// and the handoff, and only accepts the claim if both flowIds match and both
// are non-expired. This prevents a pending payload from being claimed by an
// auth flow that did not originate from the same onboarding parcours.

export interface AuthHandoffV1 {
  version: 1;
  flowId: string;
  createdAt: string;
}

function isValidHandoff(raw: unknown): raw is AuthHandoffV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.flowId !== 'string' || !d.flowId) return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
  return true;
}

function isHandoffExpired(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  return Date.now() - created > HANDOFF_TTL_MS;
}

function isValidShape(raw: unknown): raw is PendingOnboardingPlanV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;

  if (d.version !== CURRENT_VERSION) return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
  if (d.firstName !== null && typeof d.firstName !== 'string') return false;
  if (typeof d.learningMode !== 'string' || !VALID_LEARNING_MODES.includes(d.learningMode as LearningMode)) return false;
  if (!Array.isArray(d.knownSurahs) || !d.knownSurahs.every(n => typeof n === 'number')) return false;
  if (d.startingSurah !== null && typeof d.startingSurah !== 'number') return false;
  if (!Array.isArray(d.customSurahOrder) || !d.customSurahOrder.every(n => typeof n === 'number')) return false;
  if (typeof d.continueWithRest !== 'boolean') return false;
  if (
    d.notificationPreference !== null
    && (typeof d.notificationPreference !== 'string' || !VALID_NOTIFICATION_PREFERENCES.includes(d.notificationPreference as NotificationPreference))
  ) return false;
  if (
    d.discoverySource !== null
    && (typeof d.discoverySource !== 'string' || !VALID_DISCOVERY_SOURCES.includes(d.discoverySource as DiscoverySource))
  ) return false;
  if (d.ownerUserId !== undefined && d.ownerUserId !== null && typeof d.ownerUserId !== 'string') return false;
  if (d.flowId !== undefined && d.flowId !== null && typeof d.flowId !== 'string') return false;

  return true;
}

function isExpired(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true; // corrupted date — treat as expired
  return Date.now() - created > TTL_MS;
}

/**
 * Persists the minimal plan-finalization payload. Called exactly once,
 * right before leaving program-summary for signup — never at the start of
 * onboarding. Never throws: returns a typed result so the caller can show a
 * sober error and let the user retry instead of navigating away silently.
 * On success, returns the generated flowId so the caller can pass it through
 * the auth routes as explicit proof of the originating onboarding parcours.
 */
export function savePendingOnboardingPlan(
  input: PendingPlanInput
): Promise<{ ok: true; flowId: string } | { ok: false; error: string }> {
  return serializeClaim(async () => {
    try {
      const flowId = generateFlowId();
      const payload: PendingOnboardingPlanV1 = {
        version: CURRENT_VERSION,
        createdAt: new Date().toISOString(),
        ...input,
        flowId,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

      // Write the auth handoff marker with the same flowId — the claim
      // function will verify both match before allowing the payload to be
      // used by the authenticated user.
      const handoff: AuthHandoffV1 = {
        version: 1,
        flowId,
        createdAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));

      return { ok: true, flowId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
    }
  });
}

/**
 * Reads the pending payload. Returns null (and silently deletes the stored
 * value) if it is missing, corrupted, wrongly versioned, or older than the
 * 72h TTL — never hands back stale or malformed data to a caller.
 */
export async function readPendingOnboardingPlan(): Promise<PendingOnboardingPlanV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidShape(parsed) || isExpired(parsed.createdAt)) {
      await clearPendingOnboardingPlan();
      await clearAuthHandoff();
      return null;
    }
    return parsed;
  } catch {
    await clearPendingOnboardingPlan();
    await clearAuthHandoff();
    return null;
  }
}

/**
 * Read-only convenience check for callers that only need to know WHETHER a
 * still-valid pending payload exists (e.g. the dashboard deciding whether
 * an onboarding-v2 finalization may still be in flight) — never exposes
 * the payload itself. Reuses readPendingOnboardingPlan() as the single
 * source of TTL/shape validation; never duplicates that logic, and never
 * throws (readPendingOnboardingPlan() already swallows every error case).
 */
export async function hasValidPendingOnboardingPlan(): Promise<boolean> {
  const pending = await readPendingOnboardingPlan();
  return pending !== null;
}

/**
 * userId-aware variant of hasValidPendingOnboardingPlan. Returns true only if
 * a still-valid pending payload exists, has a flowId, a matching authHandoff
 * exists with the same flowId, both are non-expired, and the ownerUserId is
 * either null (unclaimed) or matches the given userId.
 *
 * Legacy payloads without flowId are rejected (returns false, clears them).
 * Payloads owned by a different user are rejected and cleared.
 * Payloads with no matching handoff are rejected but NOT cleared — the
 * handoff may arrive later (e.g. same-session auth still in flight).
 */
export async function hasValidPendingOnboardingPlanForUser(
  userId: string
): Promise<boolean> {
  const pending = await readPendingOnboardingPlan();
  if (!pending) return false;

  // Legacy payload without flowId — not auto-claimable, clear it.
  if (!pending.flowId) {
    await clearPendingOnboardingPlan();
    await clearAuthHandoff();
    return false;
  }

  // Owned by a different user — clear and reject.
  if (pending.ownerUserId && pending.ownerUserId !== userId) {
    await clearPendingOnboardingPlan();
    await clearAuthHandoff();
    return false;
  }

  // Verify handoff exists and matches.
  const handoff = await readAuthHandoff();
  if (!handoff || handoff.flowId !== pending.flowId) {
    // Don't clear — handoff may arrive later in same session.
    return false;
  }

  return true;
}

// ─── Session auth flow ID ─────────────────────────────────────────────────
// In-memory proof that the current auth session originated from an
// onboarding-v2 parcours. Set by signup-email/login-email when
// context=onboarding is present in their route params. Never persisted
// to AsyncStorage — intentionally does NOT survive app kills (cold-start
// requires explicit re-entry through the onboarding auth flow).
// Cleared by clearAllPendingOnboardingData() and after successful claim.
let _sessionAuthFlowId = '';

/** Called by signup-email/login-email when context=onboarding is confirmed. */
export function setSessionAuthFlowId(flowId: string): void {
  _sessionAuthFlowId = flowId;
}

/** Read by finalizeOnboardingV2Plan / useOnboardingV2AuthFinalize. */
export function getSessionAuthFlowId(): string {
  return _sessionAuthFlowId;
}

/** Clears the in-memory session proof. Called after claim or full data clear. */
export function clearSessionAuthFlowId(): void {
  _sessionAuthFlowId = '';
}

// ─── Pending mutation serializer ──────────────────────────────────────────
// AsyncStorage is not transactional. Two concurrent operations (save, claim,
// clear) could interleave their read-modify-write cycles and corrupt the
// pending payload or clear the wrong transaction. The serializer ensures
// only one mutation body executes at a time within the current JS process.
//
// ALL pending mutations use this chain:
//   - savePendingOnboardingPlan (creates a new payload + handoff marker)
//   - claimPendingOnboardingPlanForUser (writes ownerUserId)
//   - clearPendingOnboardingIfMatches (conditional delete)
//
// Guarantee: within a single JS process, no two pending mutations execute
// concurrently. A save that starts after a clear will wait for the clear to
// finish, and vice versa. AsyncStorage's own internal queue is not relied
// upon for ordering — the chain provides deterministic ordering here.
//
// This does NOT provide cross-process or cross-device atomicity. If the app
// is killed mid-mutation, AsyncStorage may have a partial write. The TTL and
// shape validation in readPendingOnboardingPlan handle that case.
let _claimChain: Promise<unknown> = Promise.resolve();

function serializeClaim<T>(fn: () => Promise<T>): Promise<T> {
  const next = _claimChain.then(fn, fn) as Promise<T>;
  // Chain must never reject — absorb errors inside fn, not here.
  _claimChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Claims the pending payload for the given userId + authFlowId.
 *
 * The authFlowId is resolved in priority order:
 *   1. The explicit param (set by signup-email/login-email from route params).
 *   2. The stored activeAuthFlow (cold-start/callback: app killed between
 *      program-summary and auth completion, but marker was persisted).
 *   3. The in-memory _sessionAuthFlowId (same-session fallback).
 *
 * A Welcome → login flow that never received a flowId from program-summary,
 * and has no activeAuthFlow, cannot claim any pending payload.
 *
 * Three-way match required: payload.flowId === handoff.flowId === resolvedFlowId.
 * Serialized: only one claim executes at a time.
 *
 * Returns null if the claim is rejected for any reason.
 * Legacy payloads without flowId are rejected and cleared.
 */
export function claimPendingOnboardingPlanForUser(
  userId: string,
  authFlowId: string
): Promise<PendingOnboardingPlanV1 | null> {
  return serializeClaim(async () => {
    const pending = await readPendingOnboardingPlan();
    if (!pending) return null;

    // Legacy payload without flowId — not auto-claimable.
    if (!pending.flowId) {
      await clearPendingOnboardingPlan();
      await clearAuthHandoff();
      return null;
    }

    // Resolve the effective flowId: explicit param > stored activeAuthFlow > in-memory.
    let resolvedFlowId = authFlowId;
    if (!resolvedFlowId) {
      const storedFlow = await readActiveOnboardingAuthFlow();
      resolvedFlowId = storedFlow?.flowId ?? '';
    }
    if (!resolvedFlowId) {
      resolvedFlowId = _sessionAuthFlowId;
    }

    // If no proof of onboarding parcours exists, reject without clearing.
    if (!resolvedFlowId || pending.flowId !== resolvedFlowId) {
      return null;
    }

    // Owned by a different user — reject and clear.
    if (pending.ownerUserId && pending.ownerUserId !== userId) {
      await clearPendingOnboardingPlan();
      await clearAuthHandoff();
      return null;
    }

    // Verify handoff exists and flowId matches (three-way: payload ↔ handoff ↔ resolvedFlowId).
    const handoff = await readAuthHandoff();
    if (!handoff || handoff.flowId !== pending.flowId) {
      return null; // handoff missing or mismatched — don't clear
    }

    // Write ownerUserId before any network operation — this is the atomic
    // claim step. If the app crashes after this write, the payload is owned
    // by userId and no other user can claim it.
    try {
      const claimed: PendingOnboardingPlanV1 = {
        ...pending,
        ownerUserId: userId,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(claimed));
      // Consume the handoff and the activeAuthFlow — they have served their purpose.
      await clearAuthHandoff();
      await clearActiveOnboardingAuthFlow();
      _sessionAuthFlowId = '';
      return claimed;
    } catch {
      return null; // AsyncStorage write failed — claim not completed
    }
  });
}

/**
 * Resumes a payload that was ALREADY claimed by this userId in a previous
 * session (e.g. claim succeeded but the app was killed before finalizeOnboardingV2Plan
 * could persist the plan to Supabase). Does NOT require authFlowId — the
 * ownerUserId written during claim is the durable proof.
 *
 * Rejects:
 *   - unclaimed payloads (ownerUserId null) — use claimPendingOnboardingPlanForUser
 *   - payloads owned by a different user — clears and rejects
 *   - expired, corrupted, or missing payloads
 *
 * Never throws.
 */
export async function readOwnedPendingOnboardingPlanForUser(
  userId: string
): Promise<PendingOnboardingPlanV1 | null> {
  const pending = await readPendingOnboardingPlan();
  if (!pending) return null;

  // Unclaimed — caller must use claimPendingOnboardingPlanForUser.
  if (!pending.ownerUserId) return null;

  // Owned by a different user — clear and reject.
  if (pending.ownerUserId !== userId) {
    await clearPendingOnboardingPlan();
    await clearAuthHandoff();
    return null;
  }

  return pending;
}

/**
 * Reads the auth handoff marker. Returns null if missing, corrupted,
 * or expired. Never throws.
 */
export async function readAuthHandoff(): Promise<AuthHandoffV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidHandoff(parsed) || isHandoffExpired(parsed.createdAt)) {
      await clearAuthHandoff();
      return null;
    }
    return parsed;
  } catch {
    await clearAuthHandoff();
    return null;
  }
}

/** Removes the auth handoff marker. Never throws. */
export async function clearAuthHandoff(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HANDOFF_KEY);
  } catch {
    // Non-fatal
  }
}

// ─── Guest-draft handoff — transaction-binding envelope ───────────────────
// Binds the pending-plan transactionFlowId to the exact guest draft
// sourceGuestDraftFlowId. This is the durable proof that the current
// authentication originated from a specific guest onboarding parcours.
//
// Without this binding, sourceGuestFlowId (from GUEST_FLOW_KEY) is just a
// persisted value that exists for any app launch — it does NOT prove an
// active onboarding transaction. The claim decision must verify this
// envelope before authorizing a guest draft transfer.
//
// CRITICAL: The transactionFlowId passed to claimGuestDraftWithHandoff must
// come from an INDEPENDENT source — never from readGuestDraftHandoff() itself.
// An envelope cannot authenticate itself. The independent source is
// resolveCurrentAuthFlowId(), which reads:
//   1. getSessionAuthFlowId() — in-memory, set by auth routes from route params
//   2. readActiveOnboardingAuthFlow() — persisted, survives app kills
// A direct Google/Apple login with no onboarding context produces '' from both.
//
// Lifecycle:
//   Created: saveGuestDraftHandoff called by program-summary right before
//            navigating to auth, alongside savePendingOnboardingPlan.
//   Consumed: claimGuestDraftWithHandoff marks status='claimed' and sets
//             claimedByUserId after the draft is transferred.
//   Cleared: clearGuestDraftHandoff on logout, session expiry, or full data
//            clear.
//   Expired: 72h TTL, same as the pending payload.

/**
 * CompletedAuthProofV1 — persisted ONLY after a Supabase authentication
 * result confirms the user identity. Unlike ActiveOnboardingAuthFlowV1
 * (a pre-auth marker), this proof is created exclusively post-auth and
 * binds the onboarding transactionFlowId to the actual authenticated userId.
 *
 * Created: runOnboardingTransition() calls saveCompletedAuthProof() after
 *   supabase.auth.signUp/signInWithPassword/signInWithIdToken returns a
 *   valid session. This is the shared path for ALL onboarding auth methods.
 * Consumed: claimGuestDraftWithHandoff() marks status='consumed' after a
 *   successful claim. Exactly-once consumption prevents replay.
 * Cleared: clearAllPendingOnboardingData, invalidateStaleOnboardingAuthorization.
 *
 * TRUST BOUNDARY:
 *   ActiveOnboardingAuthFlowV1 = "authentication was prepared" (pre-auth)
 *   CompletedAuthProofV1       = "authentication succeeded for this user" (post-auth)
 *
 * A guest draft claim requires the COMPLETED proof, never the pre-auth marker.
 */
export interface CompletedAuthProofV1 {
  version: 1;
  transactionFlowId: string;
  userId: string;
  status: 'authenticated' | 'consumed';
  createdAt: string;
}

function isValidCompletedAuthProof(raw: unknown): raw is CompletedAuthProofV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.version === 1 &&
    typeof r.transactionFlowId === 'string' &&
    typeof r.userId === 'string' &&
    (r.status === 'authenticated' || r.status === 'consumed') &&
    typeof r.createdAt === 'string';
}

export async function saveCompletedAuthProof(
  transactionFlowId: string,
  userId: string,
): Promise<void> {
  if (!transactionFlowId || !userId) {
    throw new Error('saveCompletedAuthProof: missing transactionFlowId or userId');
  }
  const proof: CompletedAuthProofV1 = {
    version: 1,
    transactionFlowId,
    userId,
    status: 'authenticated',
    createdAt: new Date().toISOString(),
  };
  // Write — must throw on failure
  await AsyncStorage.setItem(COMPLETED_AUTH_PROOF_KEY, JSON.stringify(proof));
  // Readback — verify the write landed
  const readback = await readCompletedAuthProof();
  if (!readback) {
    throw new Error('saveCompletedAuthProof: readback returned null after write');
  }
  if (readback.transactionFlowId !== transactionFlowId ||
      readback.userId !== userId ||
      readback.status !== 'authenticated' ||
      readback.version !== 1) {
    throw new Error('saveCompletedAuthProof: readback field mismatch');
  }
}

export async function readCompletedAuthProof(): Promise<CompletedAuthProofV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(COMPLETED_AUTH_PROOF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidCompletedAuthProof(parsed)) {
      await AsyncStorage.removeItem(COMPLETED_AUTH_PROOF_KEY);
      return null;
    }
    // TTL check
    const age = Date.now() - new Date(parsed.createdAt).getTime();
    if (age > COMPLETED_AUTH_PROOF_TTL_MS) {
      await AsyncStorage.removeItem(COMPLETED_AUTH_PROOF_KEY);
      return null;
    }
    return parsed;
  } catch {
    try { await AsyncStorage.removeItem(COMPLETED_AUTH_PROOF_KEY); } catch { /* best-effort */ }
    return null;
  }
}

export async function consumeCompletedAuthProof(): Promise<void> {
  const proof = await readCompletedAuthProof();
  if (!proof) return;
  if (proof.status === 'consumed') return;
  if (proof.status !== 'authenticated') return;
  const consumed: CompletedAuthProofV1 = {
    ...proof,
    status: 'consumed',
  };
  // Write — must throw on failure
  await AsyncStorage.setItem(COMPLETED_AUTH_PROOF_KEY, JSON.stringify(consumed));
  // Readback — verify the write landed
  const readback = await readCompletedAuthProof();
  if (!readback || readback.status !== 'consumed') {
    throw new Error('consumeCompletedAuthProof: readback status is not consumed');
  }
}

export async function clearCompletedAuthProof(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COMPLETED_AUTH_PROOF_KEY);
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidates all stale onboarding authorization state. Called when a user
 * begins a DIRECT authentication (Google/Apple/email) without onboarding
 * context. This ensures that abandoned pre-auth markers from a previous
 * onboarding session cannot authorize a guest draft claim for the new,
 * unrelated authentication.
 *
 * Clears:
 *   - _sessionAuthFlowId (in-memory pre-auth marker)
 *   - ActiveOnboardingAuthFlowV1 (persisted pre-auth marker)
 *   - GuestDraftHandoffV1 (persisted handoff envelope)
 *   - CompletedAuthProofV1 (any stale completed proof)
 *
 * Does NOT clear:
 *   - The guest draft itself (isolated AsyncStorage data, harmless without authorization)
 *   - The pending onboarding plan (may be cleared separately if needed)
 *
 * Throws if any AsyncStorage.removeItem fails — callers must handle the
 * error to avoid silently continuing with stale authorization present.
 */
export async function invalidateStaleOnboardingAuthorization(): Promise<void> {
  clearSessionAuthFlowId();
  // Use direct AsyncStorage.removeItem calls — NOT the swallowing wrappers.
  // If any removal fails, the error propagates so the caller can fail-closed
  // instead of silently continuing with stale authorization still present.
  await Promise.all([
    AsyncStorage.removeItem(ACTIVE_AUTH_FLOW_KEY),
    AsyncStorage.removeItem(GUEST_DRAFT_HANDOFF_KEY),
    AsyncStorage.removeItem(COMPLETED_AUTH_PROOF_KEY),
  ]);
}

export interface GuestDraftHandoffV1 {
  version: 1;
  transactionFlowId: string;
  sourceGuestDraftFlowId: string;
  status: 'awaiting_auth' | 'claimed';
  claimedByUserId: string | null;
  createdAt: string;
}

function isValidGuestDraftHandoff(raw: unknown): raw is GuestDraftHandoffV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.transactionFlowId !== 'string' || !d.transactionFlowId) return false;
  if (typeof d.sourceGuestDraftFlowId !== 'string' || !d.sourceGuestDraftFlowId) return false;
  if (d.status !== 'awaiting_auth' && d.status !== 'claimed') return false;
  if (d.claimedByUserId !== null && typeof d.claimedByUserId !== 'string') return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
  return true;
}

function isGuestDraftHandoffExpired(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  return Date.now() - created > GUEST_DRAFT_HANDOFF_TTL_MS;
}

/**
 * Persists the guest-draft handoff envelope, binding the pending-plan
 * transactionFlowId to the exact guest draft sourceGuestDraftFlowId.
 * Called by program-summary right before navigating to auth.
 * Never throws.
 */
export async function saveGuestDraftHandoff(
  transactionFlowId: string,
  sourceGuestDraftFlowId: string,
): Promise<void> {
  try {
    const envelope: GuestDraftHandoffV1 = {
      version: 1,
      transactionFlowId,
      sourceGuestDraftFlowId,
      status: 'awaiting_auth',
      claimedByUserId: null,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(GUEST_DRAFT_HANDOFF_KEY, JSON.stringify(envelope));
  } catch {
    // Non-fatal — but callers must check via readGuestDraftHandoff before
    // authorizing a claim. If the write failed, no claim can proceed.
  }
}

/**
 * Reads the guest-draft handoff envelope. Returns null if missing,
 * corrupted, wrongly versioned, or expired (and clears stale entries).
 * Never throws.
 */
export async function readGuestDraftHandoff(): Promise<GuestDraftHandoffV1 | null> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_DRAFT_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidGuestDraftHandoff(parsed) || isGuestDraftHandoffExpired(parsed.createdAt)) {
      await clearGuestDraftHandoff();
      return null;
    }
    return parsed;
  } catch {
    await clearGuestDraftHandoff();
    return null;
  }
}

/** Removes the guest-draft handoff envelope. Never throws. */
export async function clearGuestDraftHandoff(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_DRAFT_HANDOFF_KEY);
  } catch {
    // Non-fatal
  }
}

// ─── Guest-draft claim orchestration ──────────────────────────────────────
// The dedicated claim decision function. useDraftOwner() describes ownership;
// it does NOT authorize handoffs. This function is the single authority that
// validates the transaction-binding envelope before transferring a guest
// draft to an authenticated user.
//
// Required invariant — ALL must be true:
//   1. A guest-draft handoff exists and is valid (not expired/corrupt)
//   2. The handoff's transactionFlowId matches currentAuthFlowId — an
//      independently resolved value from resolveCurrentAuthFlowId(), NOT
//      from readGuestDraftHandoff(). An envelope cannot authenticate itself.
//   3. The handoff's sourceGuestDraftFlowId matches the given guestFlowId
//   4. The handoff status is 'awaiting_auth' (not already claimed)
//   5. The current session user matches targetUserId
//   6. The handoff has not been claimed by another user
//
// Crash-safe and idempotent claim steps:
//   1. Validate active handoff and current session
//   2. Read the exact bound guest draft
//   3. Write and verify the user-owned copy
//   4. Mark/consume the handoff for that user
//   5. Delete the exact guest copy
//   6. Clear the guest flow only when it still matches the consumed flow

export type GuestDraftClaimResult = {
  ok: boolean;
  reason:
    | 'claimed'
    | 'already_owned'
    | 'no_handoff'
    | 'handoff_mismatch'
    | 'already_claimed'
    | 'no_guest_draft'
    | 'session_changed'
    | 'write_failed';
};

/**
 * Orchestrates the guest-to-user draft claim with full transaction-binding
 * validation. Delegates the actual draft transfer to claimDraftForUser from
 * onboardingDraft.ts, but ONLY after verifying BOTH:
 *
 *   1. A CompletedAuthProofV1 exists with status='authenticated', proving
 *      that a Supabase authentication result confirmed this exact user
 *      for this exact onboarding transaction. This proof is created ONLY
 *      after successful auth (in runOnboardingTransition), never before.
 *
 *   2. A GuestDraftHandoffV1 envelope exists with status='awaiting_auth',
 *      binding the transactionFlowId to the guest draft flowId.
 *
 * The claim is authorized ONLY when:
 *   handoff.transactionFlowId === proof.transactionFlowId
 *   proof.userId === targetUserId
 *   proof.status === 'authenticated'
 *
 * The proof is read from its own AsyncStorage key — it is NEVER passed
 * from the caller. This eliminates any possibility of circularity.
 *
 * @param targetUserId   The authenticated user claiming the draft.
 * @param guestFlowId    The guest draft flowId to claim (from useDraftOwner).
 * @param getSessionUserId Function to read the current session userId.
 */
export async function claimGuestDraftWithHandoff(
  targetUserId: string,
  guestFlowId: string,
  getSessionUserId?: () => string | undefined,
): Promise<GuestDraftClaimResult> {
  if (!targetUserId || !guestFlowId) {
    return { ok: false, reason: 'handoff_mismatch' };
  }

  // Step 1: Read the completed auth proof (independently persisted post-auth)
  const proof = await readCompletedAuthProof();
  if (!proof) {
    return { ok: false, reason: 'no_handoff' };
  }

  // A consumed proof means the claim already succeeded. We allow it through
  // so the idempotent retry path (handoff.status === 'claimed') can detect
  // the existing user copy and return 'already_owned'. A consumed proof
  // cannot authorize a NEW claim — the handoff will be 'claimed' and the
  // user copy check will handle it.
  if (proof.status !== 'authenticated' && proof.status !== 'consumed') {
    return { ok: false, reason: 'no_handoff' };
  }

  // The proof must bind to the exact user claiming the draft
  if (proof.userId !== targetUserId) {
    return { ok: false, reason: 'handoff_mismatch' };
  }

  // Step 2: Validate the handoff envelope
  const handoff = await readGuestDraftHandoff();
  if (!handoff) {
    return { ok: false, reason: 'no_handoff' };
  }

  // The handoff's transaction must match the completed proof's transaction
  if (handoff.transactionFlowId !== proof.transactionFlowId) {
    return { ok: false, reason: 'handoff_mismatch' };
  }
  if (handoff.sourceGuestDraftFlowId !== guestFlowId) {
    return { ok: false, reason: 'handoff_mismatch' };
  }

  // Verify handoff is still active and unconsumed
  if (handoff.status === 'claimed') {
    // Idempotent retry: if claimed by the same user, check if user copy exists
    if (handoff.claimedByUserId === targetUserId) {
      // Session must still match even for idempotent retry
      if (getSessionUserId && getSessionUserId() !== targetUserId) {
        return { ok: false, reason: 'session_changed' };
      }
      // Check if the user already has the draft (crash recovery)
      const existing = await readOnboardingDraftForOwner({ kind: 'authenticated', userId: targetUserId });
      if (existing !== null) {
        // Clean up stale guest copy if it still exists
        await clearOnboardingDraftForOwner({ kind: 'guest', flowId: guestFlowId }).catch(() => {});
        await clearGuestFlowId();
        // If proof is still 'authenticated' (consumption failed on previous run),
        // attempt to consume it now. This is idempotent — if already consumed,
        // consumeCompletedAuthProof is a no-op.
        if (proof.status === 'authenticated') {
          try {
            await consumeCompletedAuthProof();
          } catch {
            // Non-fatal — claim already succeeded, handoff is marked.
            // A future retry will attempt consumption again.
          }
        }
        return { ok: true, reason: 'already_owned' };
      }
      // Handoff says claimed but user copy is gone — cannot re-claim
      return { ok: false, reason: 'already_claimed' };
    }
    // Claimed by a different user
    return { ok: false, reason: 'already_claimed' };
  }

  // Safety-net guard: a consumed proof with an unconsumed handoff should
  // never occur under the strict write order (handoff is marked before proof
  // is consumed). This guard handles legacy data or storage corruption.
  // If the user copy exists, the claim already succeeded — return already_owned.
  // If not, reject as a potential replay.
  if (proof.status === 'consumed') {
    const existing = await readOnboardingDraftForOwner({ kind: 'authenticated', userId: targetUserId });
    if (existing !== null) {
      // User copy exists — claim already succeeded, clean up and return
      await clearOnboardingDraftForOwner({ kind: 'guest', flowId: guestFlowId }).catch(() => {});
      await clearGuestFlowId();
      return { ok: true, reason: 'already_owned' };
    }
    // No user copy — genuine replay attempt, reject
    return { ok: false, reason: 'already_claimed' };
  }

  // Verify current session matches target user
  if (getSessionUserId && getSessionUserId() !== targetUserId) {
    return { ok: false, reason: 'session_changed' };
  }

  // Steps 2-6: delegate to claimDraftForUser (crash-resistant)
  const claimResult = await claimDraftForUser(targetUserId, guestFlowId, getSessionUserId);

  if (!claimResult.ok) {
    // Map claimDraftForUser reasons to our result type
    if (claimResult.reason === 'no_guest_draft') {
      return { ok: false, reason: 'no_guest_draft' };
    }
    if (claimResult.reason === 'session_changed') {
      return { ok: false, reason: 'session_changed' };
    }
    if (claimResult.reason === 'write_failed') {
      return { ok: false, reason: 'write_failed' };
    }
    // flow_mismatch or other — treat as handoff mismatch
    return { ok: false, reason: 'handoff_mismatch' };
  }

  // Claim succeeded — durably mark the handoff as claimed for this user.
  // This MUST succeed before we consume the proof. If it fails, the proof
  // remains 'authenticated' and a retry will detect the existing user copy,
  // re-attempt the handoff mark, and only then consume the proof.
  const claimedHandoff: GuestDraftHandoffV1 = {
    ...handoff,
    status: 'claimed',
    claimedByUserId: targetUserId,
  };
  try {
    await AsyncStorage.setItem(GUEST_DRAFT_HANDOFF_KEY, JSON.stringify(claimedHandoff));
  } catch {
    // Handoff write failed — proof must remain authenticated.
    // Return write_failed so the caller knows the transition is incomplete.
    // A retry will find: user copy exists, handoff=awaiting_auth, proof=authenticated.
    return { ok: false, reason: 'write_failed' };
  }
  // Readback — verify the handoff write landed
  const handoffReadback = await readGuestDraftHandoff();
  if (!handoffReadback || handoffReadback.status !== 'claimed' || handoffReadback.claimedByUserId !== targetUserId) {
    // Handoff readback failed — proof must remain authenticated.
    return { ok: false, reason: 'write_failed' };
  }

  // Handoff is durably marked claimed — now consume the completed auth proof.
  // This is the exactly-once consumption that prevents replay. If this fails,
  // a retry will find: user copy exists, handoff=claimed, proof=authenticated.
  // The retry will see handoff.status=claimed and return already_owned, then
  // attempt to consume the proof again idempotently.
  try {
    await consumeCompletedAuthProof();
  } catch {
    // Proof consumption failed — but the claim already succeeded and the
    // handoff is durably marked. A retry will return already_owned and
    // re-attempt consumption. This is safe.
  }

  // Clear the guest flow only when it still matches the consumed flow
  // (claimDraftForUser already does this, but we ensure it here too)
  try {
    const currentFlow = await getOrCreateGuestFlowId();
    if (currentFlow === guestFlowId) {
      await clearGuestFlowId();
    }
  } catch {
    // Non-fatal — guest flow ID cleanup is cosmetic
  }

  return { ok: true, reason: claimResult.reason === 'already_owned' ? 'already_owned' : 'claimed' };
}

/** Removes the pending payload. Never throws. Safe to call even if absent. */
export async function clearPendingOnboardingPlan(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal — a leftover expired/invalid entry is harmless and will be
    // discarded on its next read anyway.
  }
}

/**
 * Result of {@link clearPendingOnboardingIfMatches}.
 *
 * - `cleared`: the pending payload was found, matched (correct userId AND
 *   flowId), and successfully deleted from AsyncStorage.
 * - `already_absent`: no pending payload exists in storage at all. Nothing
 *   was deleted. The caller may proceed only if the session and generation
 *   are still those of the original operation.
 * - `superseded`: a pending payload exists, but its userId or flowId differs
 *   from the given values. A newer transaction or a different user's pending
 *   is in storage. The caller's operation is obsolete — it must NOT navigate
 *   or announce success. The existing pending is left untouched.
 * - `storage_error`: the pending payload matched (correct userId and flowId)
 *   but the AsyncStorage delete operation failed. The pending still exists
 *   and a retry should be attempted. The caller must NOT navigate.
 */
export type ClearPendingResult =
  | 'cleared'
  | 'already_absent'
  | 'superseded'
  | 'storage_error';

/**
 * Clears the pending payload and associated auth markers ONLY if:
 *   1. The payload exists and is owned by the given userId (not unclaimed).
 *   2. The payload's flowId matches the given transactionId.
 *
 * This prevents:
 *   - Clearing an unclaimed pending created for another parcours.
 *   - Clearing a pending owned by a different user.
 *   - Clearing a NEWER pending belonging to the same user (different flowId).
 *
 * Serialized via the same _claimChain as claimPendingOnboardingPlanForUser
 * to prevent a race where a new pending is written between the read and the
 * clear.
 *
 * Returns {@link ClearPendingResult} so the caller can distinguish between
 * a successful clear, a transaction mismatch, and a real storage failure.
 * A `storage_error` means the pending still exists and should be retried —
 * the caller must NOT treat it as success.
 *
 * Called by the orchestration layer AFTER handOffFinalizedProgram succeeds,
 * making the pending payload a durable transaction marker that survives
 * handoff failures, app kills, and process restarts.
 *
 * Never throws.
 */
export function clearPendingOnboardingIfMatches(
  userId: string,
  transactionId: string,
): Promise<ClearPendingResult> {
  return serializeClaim(async () => {
    try {
      const pending = await readPendingOnboardingPlan();
      if (!pending) return 'already_absent' as ClearPendingResult;
      // Must be owned by this user — unclaimed pending or another user's
      // pending must never be cleared here.
      if (!pending.ownerUserId || pending.ownerUserId !== userId) {
        return 'superseded' as ClearPendingResult;
      }
      // Must match the transaction that was finalized — a newer pending
      // from a different onboarding parcours must survive.
      if (!pending.flowId || pending.flowId !== transactionId) {
        return 'superseded' as ClearPendingResult;
      }
      // Call AsyncStorage.removeItem directly (not via the swallowing
      // wrappers) so that a real storage failure is detectable.
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(HANDOFF_KEY);
      await AsyncStorage.removeItem(ACTIVE_AUTH_FLOW_KEY);
      clearSessionAuthFlowId();
      return 'cleared' as ClearPendingResult;
    } catch {
      // Storage error — the pending matched but the delete failed.
      // The pending still exists; the caller should retry.
      return 'storage_error' as ClearPendingResult;
    }
  }).then(
    (v) => v as ClearPendingResult,
    () => 'storage_error' as ClearPendingResult,
  );
}

/**
 * Clears both the pending payload and the auth handoff marker.
 * Used by logout, session expiry, and finalization success.
 * Never throws.
 */
export async function clearAllPendingOnboardingData(): Promise<void> {
  clearSessionAuthFlowId();
  await Promise.all([
    clearPendingOnboardingPlan(),
    clearAuthHandoff(),
    clearActiveOnboardingAuthFlow(),
    clearGuestDraftHandoff(),
    clearCompletedAuthProof(),
  ]);
}

/**
 * Auth-boundary cleanup for session expiry (_layout.tsx clearInvalidAuthSession).
 *
 * All onboarding drafts are purged — session expiry is an explicit reset
 * scenario, not a simple session change. The physical key isolation means
 * user B's draft was never visible to user A anyway, but purging on
 * session expiry ensures no stale drafts linger.
 *
 * The durable pending payload is cleared only if it is owned by a specific
 * user (ownerUserId is set). An unclaimed pre-auth payload (ownerUserId null)
 * may belong to a new onboarding flow started after the session expired, so
 * it is left intact.
 *
 * Never throws.
 */
export async function clearOnboardingStateForSessionExpiry(): Promise<void> {
  await purgeAllOnboardingDrafts();
  try {
    const pending = await readPendingOnboardingPlan();
    if (pending?.ownerUserId) {
      await clearAllPendingOnboardingData();
    }
  } catch {
    // Non-fatal — draft was already cleared, which is the critical part.
  }
}
