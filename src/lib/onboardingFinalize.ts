// ─── Onboarding V2 → real account finalization ─────────────────────────────
// Single place that turns a completed onboarding-v2 answer set into a real,
// persisted plan for a just-authenticated user. Called from signup.tsx and
// login.tsx right after a session is obtained — never invents a second
// plan-generation system: it only calls the existing, pure computePlan()
// (src/core/planEngine.ts) and the existing persistence helpers
// (upsertPlan / upsertProgress), exactly like the legacy
// app/onboarding/index.tsx SeriousQuestionnaire.handleCreatePlan() already
// does for its own flow.
//
// Source of truth, in order:
//   1. the in-memory draft (onboardingDraft.ts) — present when signup/login
//      happens in the very same app session as program-summary;
//   2. the durable pending-plan payload (pendingOnboardingPlan.ts) —
//      present when the draft was lost (email confirmation flow, app kill)
//      but the user already reached and validated program-summary;
//   3. neither → `no_source`, not an error: the user simply did not come
//      through onboarding-v2 (a direct signup/login).

import { computePlan, isPlanError } from '@/core/planEngine';
import { upsertPlan } from '@/db/plans';
import { upsertProgress } from '@/db/progress';
import { readOnboardingDraft, clearOnboardingDraft } from './onboardingDraft';
import {
  buildPlanInputFromDraft, isPlanValidationError, PlanInputSource,
} from './onboardingPlanValidation';
import { readPendingOnboardingPlan, clearPendingOnboardingPlan } from './pendingOnboardingPlan';
import { scheduleDailyHifzReminder } from '@/notifications/scheduler';
import { saveNotificationSettings } from '@/notifications/storage';
import { DEFAULT_SETTINGS } from '@/notifications/types';
import type { NotificationPreference, ExperienceChoice } from './onboardingDraft';
import { syncRevenueCatUserAfterAuth } from '@/lib/revenueCat';

export type FinalizeOnboardingV2Result =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_source' | 'invalid_draft' | 'plan_error' | 'persist_error';
      message?: string;
    };

// Module-scoped in-flight guard — deduplicates concurrent calls (e.g. a
// double network retry, or signup.tsx and login.tsx both racing to
// finalize) so upsertPlan/upsertProgress/scheduleDailyHifzReminder are never
// run twice in parallel for the same finalization attempt.
let inFlight: Promise<FinalizeOnboardingV2Result> | null = null;

export async function finalizeOnboardingV2Plan(userId: string): Promise<FinalizeOnboardingV2Result> {
  if (inFlight) return inFlight;
  inFlight = runFinalize(userId).finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Reads (never clears) the experienceChoice from whichever source
 * finalization would use — the in-memory draft first, then the durable
 * pending payload. Read-only peek: used only to decide whether a strict
 * RevenueCat entitlement check is required before finalizing, never to
 * grant premium access itself (RevenueCat entitlement remains the only
 * source of truth for that).
 */
async function peekOnboardingV2ExperienceChoice(): Promise<ExperienceChoice | null> {
  const draft = await readOnboardingDraft();
  if (draft) return draft.experienceChoice;
  const pending = await readPendingOnboardingPlan();
  if (pending) return pending.experienceChoice;
  return null;
}

/**
 * Discriminated result of finalizeOnboardingV2PlanWithPremiumGate() below.
 */
export type PremiumGatedFinalizeResult =
  | { status: 'finalized'; finalize: FinalizeOnboardingV2Result }
  | { status: 'premium_sync_failed'; reason: 'configure_failed' | 'login_failed' | 'customer_info_failed' }
  | { status: 'premium_entitlement_missing' };

/**
 * The premium-aware entry point signup.tsx/login.tsx must call instead of
 * finalizeOnboardingV2Plan() directly. Free/daily_limited parcours (or any
 * signup/login with no onboarding-v2 source at all) are entirely unaffected
 * — they go straight to finalization, never blocked on RevenueCat. A
 * 'unlimited' parcours is only ever finalized (plan persisted, pending
 * payload cleared) once syncRevenueCatUserAfterAuth() confirms a real,
 * active entitlement — a pre-auth purchase that hasn't linked yet must never
 * be silently treated as free, and a payload that merely CLAIMS 'unlimited'
 * without a real purchase must never be granted access either.
 *
 * On unsupported_platform (Android — Zainly+ is iOS-only), the check is
 * skipped and finalization proceeds normally: there is nothing to verify
 * and free users must never be blocked because of a RevenueCat platform
 * limitation that predates this patch.
 */
export async function finalizeOnboardingV2PlanWithPremiumGate(
  userId: string
): Promise<PremiumGatedFinalizeResult> {
  const experienceChoice = await peekOnboardingV2ExperienceChoice();

  if (experienceChoice === 'unlimited') {
    const sync = await syncRevenueCatUserAfterAuth(userId);

    if (!sync.ok && sync.reason !== 'unsupported_platform') {
      return { status: 'premium_sync_failed', reason: sync.reason };
    }
    if (sync.ok && !sync.entitlementActive) {
      return { status: 'premium_entitlement_missing' };
    }
    // sync.ok && entitlementActive, OR unsupported_platform (nothing to
    // verify) — fall through to finalize normally.
  }

  const finalize = await finalizeOnboardingV2Plan(userId);
  return { status: 'finalized', finalize };
}

async function runFinalize(userId: string): Promise<FinalizeOnboardingV2Result> {
  const draft = await readOnboardingDraft();

  let source: PlanInputSource | null = null;
  let notificationPreference: NotificationPreference | null = null;

  if (draft) {
    source = draft;
    notificationPreference = draft.notificationPreference;
  } else {
    const pending = await readPendingOnboardingPlan();
    if (!pending) return { ok: false, reason: 'no_source' };
    source = pending;
    notificationPreference = pending.notificationPreference;
  }

  const validation = buildPlanInputFromDraft(source, userId);
  if (isPlanValidationError(validation)) {
    // A structurally invalid source (should not happen — program-summary
    // already validates before saving) is never silently discarded: the
    // pending payload (if any) is kept so a future retry can be attempted
    // once the underlying issue is understood, instead of losing it.
    return { ok: false, reason: 'invalid_draft', message: validation.error };
  }

  const planResult = computePlan(validation.planInput);
  if (isPlanError(planResult)) {
    return { ok: false, reason: 'plan_error', message: planResult.error };
  }

  try {
    await upsertPlan(userId, planResult.planPayload);
    await upsertProgress(userId, planResult.progressPayload);
  } catch (err) {
    // Real Supabase failure — nothing is cleared, so the exact same source
    // (draft or pending payload) can be retried on the next login attempt.
    return {
      ok: false,
      reason: 'persist_error',
      message: err instanceof Error ? err.message : 'Erreur de sauvegarde.',
    };
  }

  // Best-effort — a reminder-scheduling failure must never block the user
  // from reaching their freshly created, already-persisted plan.
  // 'already_granted' means the OS permission was already active before the
  // user even reached the notifications screen — Zainly can schedule the
  // reminder exactly as if they had just tapped "Activer les rappels".
  // scheduleDailyHifzReminder() already cancels any previously scheduled
  // reminder for this user before creating a new one (see
  // src/notifications/scheduler.ts), so repeated finalizations (signup then
  // login, retried logins, etc.) never accumulate duplicate notifications.
  if (notificationPreference === 'enabled' || notificationPreference === 'already_granted') {
    try {
      const settings = { ...DEFAULT_SETTINGS, enabled: true };
      const scheduled = await scheduleDailyHifzReminder(userId, settings);
      if (scheduled.ok) {
        await saveNotificationSettings(userId, settings);
      }
    } catch {
      // Non-fatal — the plan itself is already safely persisted above.
    }
  }

  // Only reached after plan + progress are both durably persisted — clear
  // every pre-auth source now, never before. Both are cleared unconditionally
  // (not just the one that was actually used): a draft-sourced finalization
  // may still coexist with a pending payload saved earlier in the same
  // session (e.g. the user went back from signup to program-summary and
  // tapped "Commencer mon Hifz" again) — it must never linger for a later,
  // unrelated login.
  await clearOnboardingDraft();
  await clearPendingOnboardingPlan();
  return { ok: true };
}
