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

const CURRENT_DRAFT_VERSION = 1 as const;

export type OnboardingStep = 'first_name' | 'greeting';

const VALID_STEPS: OnboardingStep[] = ['first_name', 'greeting'];

export interface OnboardingDraftV1 {
  version: 1;
  createdAt: string;
  updatedAt: string;
  currentStep: OnboardingStep;
  firstName: string | null;
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
  patch: Partial<Pick<OnboardingDraftV1, 'currentStep' | 'firstName'>>
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
