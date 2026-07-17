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
// to know whether a reminder should be scheduled — never firstName, never
// motivationReason, never any RevenueCat/auth/token data.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LearningMode, NotificationPreference, DiscoverySource, ExperienceChoice } from './onboardingDraft';

const STORAGE_KEY = 'zainly:onboardingV2:pendingPlan';
const CURRENT_VERSION = 1 as const;
const TTL_MS = 72 * 60 * 60 * 1000; // 72h

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
}

export type PendingPlanInput = Omit<PendingOnboardingPlanV1, 'version' | 'createdAt'>;

function isValidShape(raw: unknown): raw is PendingOnboardingPlanV1 {
  if (typeof raw !== 'object' || raw === null) return false;
  const d = raw as Record<string, unknown>;

  if (d.version !== CURRENT_VERSION) return false;
  if (typeof d.createdAt !== 'string' || !d.createdAt) return false;
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
 */
export async function savePendingOnboardingPlan(
  input: PendingPlanInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const payload: PendingOnboardingPlanV1 = {
      version: CURRENT_VERSION,
      createdAt: new Date().toISOString(),
      ...input,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
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
      return null;
    }
    return parsed;
  } catch {
    await clearPendingOnboardingPlan();
    return null;
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
