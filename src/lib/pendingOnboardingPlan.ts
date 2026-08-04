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
import type { LearningMode, NotificationPreference, DiscoverySource, ExperienceChoice } from './onboardingDraft';

const STORAGE_KEY = 'zainly:onboardingV2:pendingPlan';
const HANDOFF_KEY = 'zainly:onboardingV2:authHandoff';
const ACTIVE_AUTH_FLOW_KEY = 'zainly:onboardingV2:activeAuthFlow';
const CURRENT_VERSION = 1 as const;
const TTL_MS = 72 * 60 * 60 * 1000; // 72h
const HANDOFF_TTL_MS = 72 * 60 * 60 * 1000; // 72h — same as payload
const ACTIVE_AUTH_FLOW_TTL_MS = 72 * 60 * 60 * 1000; // 72h

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
const VALID_EXPERIENCE_CHOICES: ExperienceChoice[] = ['unlimited', 'daily_limited'];

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
  // Never used to GRANT premium access — RevenueCat entitlement remains the
  // only source of truth for that. Its sole purpose is letting
  // onboardingFinalize.ts know, after auth, whether this finalization came
  // from a parcours that requires a strict RevenueCat entitlement check
  // before the plan is finalized and this payload is cleared.
  experienceChoice: ExperienceChoice | null;
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
  if (
    d.experienceChoice !== null
    && (typeof d.experienceChoice !== 'string' || !VALID_EXPERIENCE_CHOICES.includes(d.experienceChoice as ExperienceChoice))
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
export async function savePendingOnboardingPlan(
  input: PendingPlanInput
): Promise<{ ok: true; flowId: string } | { ok: false; error: string }> {
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

// ─── Claim serializer ─────────────────────────────────────────────────────
// AsyncStorage is not transactional. Two concurrent claim calls for different
// userId/authFlowId combinations could both read the same unclaimed payload
// and both attempt to write ownerUserId. The serializer ensures only one
// claim body executes at a time; the chain survives rejections.
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
  ]);
}
