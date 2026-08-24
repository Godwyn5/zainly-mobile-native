// ─── Onboarding V2 draft — AsyncStorage-backed, owner-keyed ──────────────────
// This module is the single source of truth for reading/writing the
// onboarding draft. Screens must never touch any storage directly for
// this data — always go through the functions below.
//
// ── Owner isolation (v2) ───────────────────────────────────────────────
// Each draft is stored under a physical AsyncStorage key derived from its
// owner:
//   onboardingDraft:v2:user:<userId>  — owned by a Supabase userId
//   onboardingDraft:v2:guest:<flowId> — owned by a guest flowId
//
// A draft belonging to user A is NEVER visible to user B, even within the
// same JS runtime. Reads by a different owner return null because they
// read a different physical key. Writes by a different owner create a
// separate draft under a different key.
//
// The draft NEVER stores email, password, tokens, userId or any other
// secret/account-bound value. The owner identity is stored in the
// envelope for integrity verification, but the key itself is the primary
// isolation mechanism.
//
// For direct social login (Google/Apple without onboarding parcours), the
// draft starts empty and is immediately owned by session.user.id.
//
// For guest→auth transfer, claimDraftForUser validates the flowId match
// before transferring ownership. The user copy is written BEFORE the guest
// copy is deleted, so a crash never destroys the only valid copy.
//
// ── Guest flowId ───────────────────────────────────────────────────────
// A guest flowId is generated once at onboarding-v2 entry and persisted to
// AsyncStorage. It survives backgrounding and is reused for all reads,
// writes, and the eventual claim after authentication. An empty flowId is
// rejected — every guest draft must have a verifiable flow identity.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanMode } from '@/core/planEngine';

const CURRENT_DRAFT_VERSION = 1 as const;

export type OnboardingStep =
  | 'first_name'
  | 'greeting'
  | 'learning_mode'
  | 'start_surah_picker'
  | 'custom_order_picker'
  | 'known_surahs'
  | 'notifications'
  | 'program_generating'
  | 'program_summary';

const VALID_STEPS: OnboardingStep[] = [
  'first_name', 'greeting',
  'learning_mode',
  'start_surah_picker', 'custom_order_picker', 'known_surahs',
  'notifications',
  'program_generating', 'program_summary',
];

// ── Legacy step migration ────────────────────────────────────────────────
// 'motivation' / 'motivation_reassurance' / 'learning_mode_reassurance',
// plus 'experience_choice' / 'premium_confirmation' / 'free_support' were
// removed from the parcours. A draft persisted by an older app version may
// still carry one of these stale currentStep values — without remapping,
// isValidDraftShape would reject the ENTIRE draft (losing firstName,
// learningMode, etc.) since these strings are no longer valid OnboardingStep
// members. Remapping to the next valid step here preserves every other
// field and guarantees no user ever lands on a deleted route.
const LEGACY_STEP_MIGRATIONS: Record<string, (data: Record<string, unknown>) => OnboardingStep> = {
  motivation: () => 'learning_mode',
  motivation_reassurance: () => 'learning_mode',
  learning_mode_reassurance: (data) => {
    if (data.learningMode === 'start_surah') return 'start_surah_picker';
    if (data.learningMode === 'custom_order') return 'custom_order_picker';
    return 'known_surahs';
  },
  experience_choice: () => 'notifications',
  premium_confirmation: () => 'notifications',
  free_support: () => 'notifications',
  discovery_source: () => 'program_generating',
};

function migrateLegacyCurrentStep(data: Record<string, unknown>): void {
  const step = data.currentStep;
  if (typeof step === 'string' && step in LEGACY_STEP_MIGRATIONS) {
    data.currentStep = LEGACY_STEP_MIGRATIONS[step](data);
  }
}

// Reuses PlanMode as-is from the historical plan engine (src/core/planEngine)
// instead of inventing a second, incompatible vocabulary for the same
// concept — 'recommended' | 'start_surah' | 'custom_order'. The onboarding-v2
// question only displays these under different labels; the stored value is
// exactly what computePlan already expects.
export type LearningMode = PlanMode;

const VALID_LEARNING_MODES: LearningMode[] = ['recommended', 'start_surah', 'custom_order'];

// ── notifications pre-permission screen ─────────────────────────────────────
// Deliberately does NOT store a push token or schedule anything itself — it
// only remembers the user's stated intent/outcome from the onboarding-v2
// notifications screen, so it can be honoured for real (via
// src/notifications/scheduler.ts) once a real userId exists after signup.
export type NotificationPreference = 'enabled' | 'denied' | 'skipped' | 'already_granted';

const VALID_NOTIFICATION_PREFERENCES: NotificationPreference[] = [
  'enabled', 'denied', 'skipped', 'already_granted',
];

// ─── deep branch fields — mirror PlanInput exactly (src/core/planEngine.ts) ─
// knownSurahs / startingSurah / customSurahOrder / continueWithRest are the
// exact historical field names and shapes consumed by computePlan(). No new
// vocabulary is introduced here; onboardingPlanValidation.ts maps this draft
// 1:1 onto PlanInput.
export interface OnboardingDraftV1 {
  version: 1;
  createdAt: string;
  updatedAt: string;
  currentStep: OnboardingStep;
  firstName: string | null;
  learningMode: LearningMode | null;
  // Common to all 3 modes — surah numbers the user already fully knows.
  knownSurahs: number[];
  // 'start_surah' mode only.
  startingSurah: number | null;
  // 'custom_order' mode only.
  customSurahOrder: number[];
  // 'custom_order' mode only — mirrors computePlan's own default (true).
  continueWithRest: boolean;
  // ── post-niveau block ───────────────────────────────────────────────────────
  notificationPreference: NotificationPreference | null;
}

// fields that must never appear in this draft — defensive guard against
// accidental future misuse (e.g. someone spreading a session object into it)
const FORBIDDEN_KEYS = ['email', 'password', 'token', 'userId', 'secret', 'session'];

function isValidDraftShape(raw: unknown): raw is OnboardingDraftV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;

  if (d.version !== CURRENT_DRAFT_VERSION) return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
  if (typeof d.updatedAt !== 'string' || !d.updatedAt) return false;
  if (typeof d.currentStep !== 'string' || !VALID_STEPS.includes(d.currentStep as OnboardingStep)) return false;
  if (d.firstName !== null && typeof d.firstName !== 'string') return false;
  if (
    d.learningMode !== null
    && (typeof d.learningMode !== 'string' || !VALID_LEARNING_MODES.includes(d.learningMode as LearningMode))
  ) return false;
  if (
    d.notificationPreference !== null
    && (typeof d.notificationPreference !== 'string' || !VALID_NOTIFICATION_PREFERENCES.includes(d.notificationPreference as NotificationPreference))
  ) return false;
  if (!Array.isArray(d.knownSurahs) || !d.knownSurahs.every(n => typeof n === 'number')) return false;
  if (d.startingSurah !== null && typeof d.startingSurah !== 'number') return false;
  if (!Array.isArray(d.customSurahOrder) || !d.customSurahOrder.every(n => typeof n === 'number')) return false;
  if (typeof d.continueWithRest !== 'boolean') return false;
  if (FORBIDDEN_KEYS.some(k => k in d)) return false;

  return true;
}

function createDefaultDraft(step: OnboardingStep = 'first_name'): OnboardingDraftV1 {
  const now = new Date().toISOString();
  return {
    version: CURRENT_DRAFT_VERSION,
    createdAt: now,
    updatedAt: now,
    currentStep: step,
    firstName: null,
    learningMode: null,
    knownSurahs: [],
    startingSurah: null,
    customSurahOrder: [],
    continueWithRest: true,
    notificationPreference: null,
  };
}

// ── Owner types ────────────────────────────────────────────────────────
export type OnboardingDraftOwner =
  | { kind: 'authenticated'; userId: string }
  | { kind: 'guest'; flowId: string };

interface OnboardingDraftEnvelope {
  owner: OnboardingDraftOwner;
  data: OnboardingDraftV1;
}

// ── AsyncStorage key constants ──────────────────────────────────────────
const KEY_PREFIX = 'zainly:onboardingDraft:v2';
const GUEST_FLOW_KEY = `${KEY_PREFIX}:guestFlowId`;

// ── Key derivation ─────────────────────────────────────────────────────
/**
 * Computes the physical AsyncStorage key for the given owner.
 * Refuses empty userId or flowId — a draft without a verifiable owner
 * identity is never stored or read.
 * Never uses email or provider — only the canonical userId/flowId.
 */
export function draftKeyForOwner(owner: OnboardingDraftOwner): string {
  if (owner.kind === 'authenticated') {
    if (!owner.userId) throw new Error('draftKeyForOwner: userId must not be empty');
    return `${KEY_PREFIX}:user:${owner.userId}`;
  }
  if (!owner.flowId) throw new Error('draftKeyForOwner: flowId must not be empty');
  return `${KEY_PREFIX}:guest:${owner.flowId}`;
}

/**
 * Validates that an envelope's serialized owner matches the expected owner.
 * This is the second level of verification (the first is the physical key).
 * A mismatch returns false — the caller must treat the data as absent.
 */
function envelopeOwnerMatches(
  envelope: OnboardingDraftEnvelope,
  expected: OnboardingDraftOwner,
): boolean {
  if (envelope.owner.kind !== expected.kind) return false;
  if (envelope.owner.kind === 'authenticated') {
    return envelope.owner.userId === (expected as { kind: 'authenticated'; userId: string }).userId;
  }
  return envelope.owner.flowId === (expected as { kind: 'guest'; flowId: string }).flowId;
}

// ── Guest flowId management ────────────────────────────────────────────

/**
 * Module-level memoized guest flowId and its in-flight promise.
 *
 * Once generated or read from AsyncStorage, the flowId is cached in memory
 * for the lifetime of the JS runtime. This guarantees that every screen
 * and hook mount within the same app session sees the same flowId, even
 * if AsyncStorage read/write fails on a subsequent call.
 *
 * The cache is reset by clearGuestFlowId(), which is called after a
 * successful claim or when the guest flow is explicitly abandoned.
 */
let _memoizedGuestFlowId: string | null = null;
let _memoizedGuestFlowIdPromise: Promise<string> | null = null;

/**
 * Generates a sufficiently unique, non-predictable flow identifier.
 * Uses crypto.getRandomValues when available, falls back to Date.now + Math.random.
 */
function generateFlowId(): string {
  try {
    const g = globalThis as unknown as { crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array } };
    if (g.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      g.crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
  } catch { /* fall through */ }
  return `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Retrieves the existing guest flowId from AsyncStorage, or generates and
 * persists a new one if none exists. The flowId is stable for the lifetime
 * of the onboarding parcours — it survives backgrounding and is reused for
 * all reads, writes, and the eventual claim after authentication.
 *
 * The module-level memo ensures that even if AsyncStorage fails on a
 * subsequent read, all screens within the same runtime see the same
 * flowId. The first successful call caches the value; all subsequent
 * calls return the cached value without touching AsyncStorage.
 *
 * Never returns an empty string.
 */
export async function getOrCreateGuestFlowId(): Promise<string> {
  // Return cached value immediately if available
  if (_memoizedGuestFlowId) return _memoizedGuestFlowId;

  // Deduplicate concurrent calls — if a generation is already in flight,
  // await the same promise instead of generating a second flowId.
  if (_memoizedGuestFlowIdPromise) return _memoizedGuestFlowIdPromise;

  _memoizedGuestFlowIdPromise = (async () => {
    try {
      const existing = await AsyncStorage.getItem(GUEST_FLOW_KEY);
      if (existing) {
        _memoizedGuestFlowId = existing;
        return existing;
      }
    } catch { /* fall through to generate */ }

    const flowId = generateFlowId();
    try {
      await AsyncStorage.setItem(GUEST_FLOW_KEY, flowId);
    } catch {
      // AsyncStorage write failed — the in-memory cache still ensures
      // all screens in this runtime see the same flowId. On next app
      // launch, a new flowId will be generated (the draft under the
      // old key will be orphaned but cannot leak to another user).
    }
    _memoizedGuestFlowId = flowId;
    return flowId;
  })();

  try {
    return await _memoizedGuestFlowIdPromise;
  } finally {
    _memoizedGuestFlowIdPromise = null;
  }
}

/**
 * Clears the persisted guest flowId AND resets the in-memory cache.
 * Called after a successful guest→user claim or when the guest flow is
 * explicitly abandoned. After this call, the next getOrCreateGuestFlowId()
 * will generate a fresh flowId.
 */
export async function clearGuestFlowId(): Promise<void> {
  _memoizedGuestFlowId = null;
  _memoizedGuestFlowIdPromise = null;
  try {
    await AsyncStorage.removeItem(GUEST_FLOW_KEY);
  } catch { /* non-fatal */ }
}

/**
 * Cold-start cleanup for guest state. Clears the persisted guest flowId,
 * resets the in-memory memo, and removes ALL orphaned guest draft keys
 * from AsyncStorage (keys matching `onboardingDraft:v2:guest:*`).
 *
 * Does NOT touch user-owned drafts (`onboardingDraft:v2:user:*`) —
 * authenticated data is never affected.
 *
 * Called once at boot, after auth hydration confirms the user is a genuine
 * guest, and only when no pending onboarding finalization is in flight.
 * After this call, the next getOrCreateGuestFlowId() generates a fresh
 * flowId, so the user starts with an empty firstName field.
 */
export async function clearGuestDraftState(): Promise<void> {
  await clearGuestFlowId();
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const guestDraftKeys = allKeys.filter(
      k => k.startsWith(`${KEY_PREFIX}:guest:`),
    );
    if (guestDraftKeys.length > 0) {
      await AsyncStorage.multiRemove(guestDraftKeys);
    }
  } catch { /* non-fatal */ }
}

/**
 * Cold-start guest preparation. Called by AuthBootstrap BEFORE setReady()
 * when the session is null (genuine guest), to eliminate the race where an
 * onboarding screen reads a stale draft before cleanup finishes.
 *
 * Guards (injected by caller to avoid circular dependency):
 *   - hasPendingPlan: returns true if a valid pending onboarding plan exists
 *   - hasActiveAuthFlow: returns true if an active auth flow marker exists
 *
 * If either guard returns true, cleanup is skipped (auth finalization or
 * email confirmation in flight). Otherwise, clears the persisted guest
 * flowId and orphaned guest draft keys.
 *
 * Never throws — failures are absorbed so the app can still boot. The
 * in-memory flowId memo is reset by clearGuestFlowId() inside
 * clearGuestDraftState(), guaranteeing a fresh flowId for the current
 * launch regardless of AsyncStorage timing.
 */
export async function prepareGuestLaunchIfNeeded(
  hasPendingPlan: () => Promise<boolean>,
  hasActiveAuthFlow: () => Promise<unknown>,
): Promise<void> {
  try {
    const [hasPending, activeFlow] = await Promise.all([
      hasPendingPlan(),
      hasActiveAuthFlow(),
    ]);
    if (hasPending || activeFlow) return;
    await clearGuestDraftState();
  } catch { /* non-fatal — app still boots */ }
}

// ── Owner-aware read/write/clear ───────────────────────────────────────

/**
 * Reads and validates the onboarding draft for the given owner from
 * AsyncStorage. Returns null if nothing is stored, if the data is
 * corrupted, if the envelope's owner doesn't match, or if the key
 * doesn't exist. Never throws. Fail-closed on any mismatch.
 */
export async function readOnboardingDraftForOwner(
  owner: OnboardingDraftOwner,
): Promise<OnboardingDraftV1 | null> {
  const key = draftKeyForOwner(owner);
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null) return null;
  const env = envelope as Partial<OnboardingDraftEnvelope>;
  if (!env.owner || !env.data) return null;
  if (!envelopeOwnerMatches(env as OnboardingDraftEnvelope, owner)) return null;
  migrateLegacyCurrentStep(env.data as unknown as Record<string, unknown>);
  if (!isValidDraftShape(env.data)) return null;
  return env.data;
}

/**
 * Saves the given draft for the given owner to AsyncStorage under the
 * owner's physical key. The envelope includes the serialized owner for
 * integrity verification on read.
 */
export async function saveOnboardingDraftForOwner(
  owner: OnboardingDraftOwner,
  draft: OnboardingDraftV1,
): Promise<void> {
  const key = draftKeyForOwner(owner);
  const envelope: OnboardingDraftEnvelope = { owner, data: draft };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

/**
 * Clears the draft for the given owner only. If the draft belongs to a
 * different owner, it is left intact (targeted cleanup). Never throws.
 */
export async function clearOnboardingDraftForOwner(
  owner: OnboardingDraftOwner,
): Promise<void> {
  const key = draftKeyForOwner(owner);
  try {
    await AsyncStorage.removeItem(key);
  } catch { /* non-fatal */ }
}

/**
 * Returns the draft owner from the envelope stored at the given owner's key.
 * Used by finalization guards to verify owner matches the active session.
 * Returns null if no draft exists or if the envelope is corrupted.
 *
 * @deprecated Use inspectDraftForOwner for a discriminated result that
 *   distinguishes absent, valid, corrupt, and owner_mismatch.
 */
export async function getDraftOwner(
  owner: OnboardingDraftOwner,
): Promise<OnboardingDraftOwner | null> {
  const inspection = await inspectDraftForOwner(owner);
  if (inspection.status === 'valid') return inspection.owner;
  return null;
}

// ── Discriminated draft inspection ──────────────────────────────────────

export type DraftInspectionResult =
  | { status: 'absent' }
  | { status: 'valid'; owner: OnboardingDraftOwner; data: OnboardingDraftV1 }
  | { status: 'corrupt' }
  | { status: 'owner_mismatch'; envelopeOwner: OnboardingDraftOwner };

/**
 * Inspects the draft stored under the given owner's physical key and
 * returns a discriminated result that distinguishes:
 *
 *   - absent: no data stored under the key
 *   - valid: a well-formed envelope with matching owner
 *   - corrupt: data exists but is invalid JSON, missing fields, or
 *     has an invalid draft shape
 *   - owner_mismatch: a well-formed envelope exists but its serialized
 *     owner does not match the expected owner — this indicates data
 *     corruption or a physical key collision. The caller must NOT
 *     treat this as an ordinary absence.
 *
 * This replaces the ambiguous getDraftOwner() which returned null for
 * both absent and mismatched envelopes, making it impossible for the
 * finalization guard to distinguish a legitimate "no draft" from a
 * corrupted or cross-owner envelope.
 */
export async function inspectDraftForOwner(
  owner: OnboardingDraftOwner,
): Promise<DraftInspectionResult> {
  const key = draftKeyForOwner(owner);
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { status: 'absent' };
  }
  if (raw === null) return { status: 'absent' };

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }
  if (typeof envelope !== 'object' || envelope === null) {
    return { status: 'corrupt' };
  }
  const env = envelope as Partial<OnboardingDraftEnvelope>;
  if (!env.owner || !env.data) {
    return { status: 'corrupt' };
  }
  if (!isValidDraftShape(env.data)) {
    return { status: 'corrupt' };
  }
  if (!envelopeOwnerMatches(env as OnboardingDraftEnvelope, owner)) {
    return { status: 'owner_mismatch', envelopeOwner: env.owner };
  }
  migrateLegacyCurrentStep(env.data as unknown as Record<string, unknown>);
  if (!isValidDraftShape(env.data)) {
    return { status: 'corrupt' };
  }
  return { status: 'valid', owner: env.owner, data: env.data };
}

// ── Owner-aware update ─────────────────────────────────────────────────

/**
 * Owner-aware update: reads the current draft for the given owner (or starts
 * a fresh one if none/corrupted exists), merges the given patch, bumps
 * updatedAt, persists it, and returns the resulting draft.
 */
export async function updateOnboardingDraftForOwner(
  owner: OnboardingDraftOwner,
  patch: Partial<Pick<
    OnboardingDraftV1,
    | 'currentStep' | 'firstName' | 'learningMode'
    | 'knownSurahs' | 'startingSurah' | 'customSurahOrder' | 'continueWithRest'
    | 'notificationPreference'
  >>
): Promise<OnboardingDraftV1> {
  const existing = await readOnboardingDraftForOwner(owner);
  const base = existing ?? createDefaultDraft();
  const next: OnboardingDraftV1 = {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await saveOnboardingDraftForOwner(owner, next);
  return next;
}

/**
 * Owner-aware: sets learningMode and, whenever it actually CHANGES to a
 * different mode than the one already stored, wipes the fields that only
 * make sense for the PREVIOUS mode.
 */
export async function setLearningModeAndCleanupBranchForOwner(
  owner: OnboardingDraftOwner,
  mode: LearningMode,
): Promise<OnboardingDraftV1> {
  const existing = await readOnboardingDraftForOwner(owner);
  const modeChanged = existing != null && existing.learningMode !== null && existing.learningMode !== mode;
  return updateOnboardingDraftForOwner(owner, {
    learningMode: mode,
    ...(modeChanged ? { startingSurah: null, customSurahOrder: [], continueWithRest: true } : {}),
  });
}

// ── Guest → user claim (crash-resistant) ───────────────────────────────

export interface ClaimResult {
  ok: boolean;
  reason: 'claimed' | 'already_owned' | 'no_guest_draft' | 'flow_mismatch' | 'session_changed' | 'write_failed';
}

/**
 * Claims the guest draft for an authenticated userId. Used during
 * guest→auth transfer.
 *
 * Crash-resistant order of operations:
 *   1. Validate flowId is non-empty
 *   2. Read the guest draft from guest:<flowId>
 *   3. Verify the envelope and its owner
 *   4. Check if user:<userId> already exists (idempotent retry)
 *   5. Write the user copy to user:<userId>
 *   6. Confirm the write succeeded by reading back
 *   7. Only then delete the guest copy from guest:<flowId>
 *   8. Clear the persisted guest flowId
 *
 * If a crash happens after step 5 but before step 7, both copies exist.
 * On retry, step 4 detects the user copy and returns 'already_owned'.
 * The guest copy is then cleaned up as stale.
 *
 * If both copies exist after a crash, the user copy is authoritative —
 * no merging of divergent data ever happens.
 *
 * @param getSessionUserId  Function to read the current session userId.
 *                          If it doesn't match targetUserId, the claim
 *                          fails closed (session_changed).
 */
export async function claimDraftForUser(
  targetUserId: string,
  expectedFlowId: string,
  getSessionUserId?: () => string | undefined,
): Promise<ClaimResult> {
  if (!expectedFlowId) return { ok: false, reason: 'flow_mismatch' };
  if (!targetUserId) return { ok: false, reason: 'flow_mismatch' };

  const checkSession = () => {
    if (getSessionUserId && getSessionUserId() !== targetUserId) {
      return false;
    }
    return true;
  };

  // Step 4: check if user copy already exists (idempotent retry after crash)
  const userOwner: OnboardingDraftOwner = { kind: 'authenticated', userId: targetUserId };
  const existingUserDraft = await readOnboardingDraftForOwner(userOwner);
  if (existingUserDraft !== null) {
    // User copy already exists — crash recovery or repeated claim.
    // Clean up stale guest copy if it still exists.
    if (!checkSession()) return { ok: false, reason: 'session_changed' };
    await clearOnboardingDraftForOwner({ kind: 'guest', flowId: expectedFlowId }).catch(() => {});
    await clearGuestFlowId();
    return { ok: true, reason: 'already_owned' };
  }

  // Step 2-3: read the guest draft
  const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: expectedFlowId };
  const guestDraft = await readOnboardingDraftForOwner(guestOwner);
  if (guestDraft === null) {
    return { ok: false, reason: 'no_guest_draft' };
  }

  // Session check before writing
  if (!checkSession()) return { ok: false, reason: 'session_changed' };

  // Step 5: write the user copy
  try {
    await saveOnboardingDraftForOwner(userOwner, guestDraft);
  } catch {
    return { ok: false, reason: 'write_failed' };
  }

  // Step 6: confirm the write succeeded
  const confirmed = await readOnboardingDraftForOwner(userOwner);
  if (confirmed === null) {
    return { ok: false, reason: 'write_failed' };
  }

  // Session check before deleting guest copy
  if (!checkSession()) return { ok: false, reason: 'session_changed' };

  // Step 7: delete the guest copy (user copy is safe).
  // Non-fatal: if this fails, the user copy is already durable. The stale
  // guest copy is orphaned but harmless — a retry via the already_owned path
  // will clean it up. This is NOT a security-critical write; the authorization
  // (proof + handoff) was validated before this point.
  await clearOnboardingDraftForOwner(guestOwner).catch(() => {});

  // Step 8: clear the persisted guest flowId
  await clearGuestFlowId();

  return { ok: true, reason: 'claimed' };
}

// ── Global purge (explicit reset only, never automatic) ────────────────

/**
 * Removes ALL onboarding draft keys from AsyncStorage. This is a global
 * purge for explicit local reset scenarios only — NEVER called
 * automatically during a simple session change. Use
 * clearOnboardingDraftForOwner for targeted cleanup instead.
 */
export async function purgeAllOnboardingDrafts(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const draftKeys = allKeys.filter(k => k.startsWith(KEY_PREFIX));
    if (draftKeys.length > 0) {
      await AsyncStorage.multiRemove(draftKeys);
    }
  } catch { /* non-fatal */ }
}

// ─── first name domain validation ──────────────────────────────────────────
// Kept alongside the draft module since it is the only consumer of this
// field's format rules for now.

const FIRST_NAME_MIN_LENGTH = 2;
const FIRST_NAME_MAX_LENGTH = 40;
// first + last char must be a letter/mark; interior allows letters, marks,
// spaces, hyphens and apostrophes (straight or curly) — accepts any Unicode
// script, not just Latin.
const FIRST_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\-' \u2019]{0,38}[\p{L}\p{M}]$/u;

/** Collapses internal whitespace runs and trims leading/trailing spaces. */
export function normalizeFirstName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Validates a first name against length + character rules, after normalization. */
export function isValidFirstName(raw: string): boolean {
  const normalized = normalizeFirstName(raw);
  if (normalized.length < FIRST_NAME_MIN_LENGTH || normalized.length > FIRST_NAME_MAX_LENGTH) {
    return false;
  }
  return FIRST_NAME_PATTERN.test(normalized);
}
