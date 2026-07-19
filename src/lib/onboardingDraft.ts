// ─── Onboarding V2 anonymous draft — in-memory only, pre-account ───────────
// This module is the single source of truth for reading/writing the
// anonymous onboarding draft. Screens must never touch any storage
// directly for this data — always go through the functions below.
//
// Deliberately in-memory (module-scoped), NOT persisted to disk: the draft
// must survive plain in-session navigation between onboarding screens, but
// must NEVER survive a full app kill + relaunch. A cold start always spins
// up a brand new JS runtime, so `memoryDraft` naturally resets to null —
// the user is guaranteed to restart the onboarding narrative (Splash →
// Welcome → prénom) with no leftover firstName. Backgrounding the app
// without killing it does not reset the JS runtime, so the draft correctly
// survives that case too.
//
// The draft NEVER stores email, password, tokens, userId or any other
// secret/account-bound value.

import type { PlanMode } from '@/core/planEngine';

const CURRENT_DRAFT_VERSION = 1 as const;

export type OnboardingStep =
  | 'first_name'
  | 'greeting'
  | 'motivation'
  | 'learning_mode'
  | 'start_surah_picker'
  | 'custom_order_picker'
  | 'known_surahs'
  | 'experience_choice'
  | 'premium_confirmation'
  | 'free_support'
  | 'notifications'
  | 'discovery_source'
  | 'program_generating'
  | 'program_summary';

const VALID_STEPS: OnboardingStep[] = [
  'first_name', 'greeting',
  'motivation', 'learning_mode',
  'start_surah_picker', 'custom_order_picker', 'known_surahs',
  'experience_choice',
  'premium_confirmation', 'free_support',
  'notifications', 'discovery_source',
  'program_generating', 'program_summary',
];

export type MotivationReason =
  | 'closer_to_allah'
  | 'memorize_all'
  | 'memorize_surahs'
  | 'build_consistency'
  | 'personal_goal'
  | 'other';

const VALID_MOTIVATION_REASONS: MotivationReason[] = [
  'closer_to_allah', 'memorize_all', 'memorize_surahs',
  'build_consistency', 'personal_goal', 'other',
];

// Reuses PlanMode as-is from the historical plan engine (src/core/planEngine)
// instead of inventing a second, incompatible vocabulary for the same
// concept — 'recommended' | 'start_surah' | 'custom_order'. The onboarding-v2
// question only displays these under different labels; the stored value is
// exactly what computePlan already expects.
export type LearningMode = PlanMode;

const VALID_LEARNING_MODES: LearningMode[] = ['recommended', 'start_surah', 'custom_order'];

// No pre-existing draft/DB field maps to this intent — it deliberately does
// NOT touch RevenueCat/paywall/is_premium; it only remembers the user's
// stated preference for later use in the flow.
export type ExperienceChoice = 'unlimited' | 'daily_limited';

const VALID_EXPERIENCE_CHOICES: ExperienceChoice[] = ['unlimited', 'daily_limited'];

// ── notifications pre-permission screen ─────────────────────────────────────
// Deliberately does NOT store a push token or schedule anything itself — it
// only remembers the user's stated intent/outcome from the onboarding-v2
// notifications screen, so it can be honoured for real (via
// src/notifications/scheduler.ts) once a real userId exists after signup.
export type NotificationPreference = 'enabled' | 'denied' | 'skipped' | 'already_granted';

const VALID_NOTIFICATION_PREFERENCES: NotificationPreference[] = [
  'enabled', 'denied', 'skipped', 'already_granted',
];

// ── discovery-source question ───────────────────────────────────────────────
export type DiscoverySource =
  | 'tiktok' | 'instagram' | 'youtube' | 'google'
  | 'app_store' | 'word_of_mouth' | 'other';

const VALID_DISCOVERY_SOURCES: DiscoverySource[] = [
  'tiktok', 'instagram', 'youtube', 'google',
  'app_store', 'word_of_mouth', 'other',
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
  motivationReason: MotivationReason | null;
  learningMode: LearningMode | null;
  // Common to all 3 modes — surah numbers the user already fully knows.
  knownSurahs: number[];
  // 'start_surah' mode only.
  startingSurah: number | null;
  // 'custom_order' mode only.
  customSurahOrder: number[];
  // 'custom_order' mode only — mirrors computePlan's own default (true).
  continueWithRest: boolean;
  experienceChoice: ExperienceChoice | null;
  // ── post-experience-choice block — never touches computePlan/PlanInput ──
  notificationPreference: NotificationPreference | null;
  discoverySource: DiscoverySource | null;
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
    d.motivationReason !== null
    && (typeof d.motivationReason !== 'string' || !VALID_MOTIVATION_REASONS.includes(d.motivationReason as MotivationReason))
  ) return false;
  if (
    d.learningMode !== null
    && (typeof d.learningMode !== 'string' || !VALID_LEARNING_MODES.includes(d.learningMode as LearningMode))
  ) return false;
  if (
    d.experienceChoice !== null
    && (typeof d.experienceChoice !== 'string' || !VALID_EXPERIENCE_CHOICES.includes(d.experienceChoice as ExperienceChoice))
  ) return false;
  if (
    d.notificationPreference !== null
    && (typeof d.notificationPreference !== 'string' || !VALID_NOTIFICATION_PREFERENCES.includes(d.notificationPreference as NotificationPreference))
  ) return false;
  if (
    d.discoverySource !== null
    && (typeof d.discoverySource !== 'string' || !VALID_DISCOVERY_SOURCES.includes(d.discoverySource as DiscoverySource))
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
    motivationReason: null,
    learningMode: null,
    knownSurahs: [],
    startingSurah: null,
    customSurahOrder: [],
    continueWithRest: true,
    experienceChoice: null,
    notificationPreference: null,
    discoverySource: null,
  };
}

// Module-scoped, in-memory only — this is what makes the draft a pure
// navigation-session state: it lives exactly as long as the JS runtime
// does, and a full app kill always creates a brand new one, reset to null.
let memoryDraft: OnboardingDraftV1 | null = null;

/**
 * Reads and validates the in-memory onboarding draft.
 * Returns null if nothing has been set yet, or if the current value is
 * corrupted / unrecognized — in that case it is discarded automatically.
 * Never throws. Kept async so existing call sites (`await` / `.then()`)
 * do not need to change.
 */
export async function readOnboardingDraft(): Promise<OnboardingDraftV1 | null> {
  if (memoryDraft === null) return null;
  if (!isValidDraftShape(memoryDraft)) {
    memoryDraft = null;
    return null;
  }
  return memoryDraft;
}

/** Keeps the given draft in memory for the rest of this app session. */
export async function saveOnboardingDraft(draft: OnboardingDraftV1): Promise<void> {
  memoryDraft = draft;
}

/** Removes the draft entirely. Never throws. */
export async function clearOnboardingDraft(): Promise<void> {
  memoryDraft = null;
}

/**
 * Reads the current draft (or starts a fresh one if none/corrupted exists),
 * merges the given patch, bumps updatedAt, persists it, and returns the
 * resulting draft.
 */
export async function updateOnboardingDraft(
  patch: Partial<Pick<
    OnboardingDraftV1,
    | 'currentStep' | 'firstName' | 'motivationReason' | 'learningMode'
    | 'knownSurahs' | 'startingSurah' | 'customSurahOrder' | 'continueWithRest'
    | 'experienceChoice' | 'notificationPreference' | 'discoverySource'
  >>
): Promise<OnboardingDraftV1> {
  const existing = await readOnboardingDraft();
  const base = existing ?? createDefaultDraft();
  const next: OnboardingDraftV1 = {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await saveOnboardingDraft(next);
  return next;
}

/**
 * Sets learningMode and, whenever it actually CHANGES to a different mode
 * than the one already stored, wipes the fields that only make sense for
 * the PREVIOUS mode (startingSurah / customSurahOrder / continueWithRest).
 * knownSurahs is intentionally preserved — it is a common answer, not tied
 * to a specific mode (mission requirement: never re-send stale branch data
 * to computePlan after a mode change, but keep compatible common answers).
 */
export async function setLearningModeAndCleanupBranch(
  mode: LearningMode
): Promise<OnboardingDraftV1> {
  const existing = await readOnboardingDraft();
  const modeChanged = existing != null && existing.learningMode !== null && existing.learningMode !== mode;
  return updateOnboardingDraft({
    learningMode: mode,
    ...(modeChanged ? { startingSurah: null, customSurahOrder: [], continueWithRest: true } : {}),
  });
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
