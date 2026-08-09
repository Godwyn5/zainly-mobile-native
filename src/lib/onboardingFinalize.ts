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
import { upsertPlan, fetchPlan } from '@/db/plans';
import { fetchProgress, resetProgressForNewPlan } from '@/db/progress';
import { upsertProfileFirstName } from '@/db/profiles';
import { readOnboardingDraft, clearOnboardingDraft } from './onboardingDraft';
import {
  buildPlanInputFromDraft, isPlanValidationError, PlanInputSource,
} from './onboardingPlanValidation';
import {
  readPendingOnboardingPlan,
  claimPendingOnboardingPlanForUser,
  readOwnedPendingOnboardingPlanForUser,
} from './pendingOnboardingPlan';
import { scheduleDailyHifzReminder } from '@/notifications/scheduler';
import { saveNotificationSettings } from '@/notifications/storage';
import { DEFAULT_SETTINGS } from '@/notifications/types';
import type { NotificationPreference, ExperienceChoice } from './onboardingDraft';
import { syncRevenueCatUserAfterAuth } from '@/lib/revenueCat';

export type FinalizeOnboardingV2Result =
  | { ok: true; reason?: 'created' | 'plan_already_exists' }
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

/**
 * authFlowId is the flowId received from program-summary via route params.
 * Required when the pending payload path is used (draft not present).
 * Pass empty string when the call comes from a non-onboarding auth flow.
 */
export async function finalizeOnboardingV2Plan(userId: string, authFlowId: string): Promise<FinalizeOnboardingV2Result> {
  if (inFlight) return inFlight;
  inFlight = runFinalize(userId, authFlowId).finally(() => { inFlight = null; });
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
  userId: string,
  authFlowId: string
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

  const finalize = await finalizeOnboardingV2Plan(userId, authFlowId);
  return { status: 'finalized', finalize };
}

async function runFinalize(userId: string, authFlowId: string): Promise<FinalizeOnboardingV2Result> {
  // ── Plan/progress state guard ──────────────────────────────────────────
  // The authoritative source of truth for "has a plan" / "has progress" is
  // the Supabase plans/progress tables (fetched via fetchPlan/fetchProgress,
  // same as usePlan/useProgress on the dashboard) — never the draft or
  // pending payload. This guard runs BEFORE any draft/pending resolution —
  // no source data is even read if the user already has a plan.
  //
  // Unlike the original guard (plan existence only), this also verifies
  // progress: a plan with no matching progress row is an INCOMPLETE pair
  // (e.g. a prior finalize whose upsertPlan succeeded but the progress
  // write failed) and must be repaired here, never silently reported as
  // already-finalized — a bare "plan_already_exists" would leave the
  // dashboard permanently unable to render (getTodayProgramme requires
  // both plan and progress).
  let existingPlan: Awaited<ReturnType<typeof fetchPlan>>;
  try {
    existingPlan = await fetchPlan(userId);
  } catch {
    // If the plan check itself fails (network error, Supabase down), we
    // must NOT proceed with finalization — we can't safely determine
    // whether the user already has a plan. Return a persist_error so the
    // caller can retry. Never finalize blindly.
    return {
      ok: false,
      reason: 'persist_error',
      message: 'Impossible de vérifier l\'existence d\'un programme. Réessaie.',
    };
  }

  if (existingPlan) {
    let existingProgress: Awaited<ReturnType<typeof fetchProgress>>;
    try {
      existingProgress = await fetchProgress(userId);
    } catch {
      // Plan is confirmed present but progress can't be verified — never
      // guess. Returning persist_error (instead of plan_already_exists)
      // keeps any pending source alive for a retry that CAN confirm the
      // pair, rather than reporting a false success.
      return {
        ok: false,
        reason: 'persist_error',
        message: 'Impossible de vérifier ta progression. Réessaie.',
      };
    }

    if (!existingProgress) {
      // Repair: a plan exists with no progress row — reconstruct the
      // initial progress from the persisted plan's OWN canonical starting
      // fields, never from the draft/pending source (which may be stale or
      // belong to an unrelated attempt). This mapping is not a guess: it
      // mirrors exactly how computePlan() derives progressPayload from
      // planPayload in src/core/planEngine.ts —
      //   current_surah = surah_start, current_ayah = start_ayah - 1,
      //   ayah_per_day = ayah_per_day.
      try {
        await resetProgressForNewPlan(userId, {
          current_surah: existingPlan.surah_start,
          current_ayah:  existingPlan.start_ayah - 1,
          ayah_per_day:  existingPlan.ayah_per_day,
        });
      } catch (err) {
        return {
          ok: false,
          reason: 'persist_error',
          message: err instanceof Error ? err.message : 'Erreur de réparation de la progression.',
        };
      }

      // Confirm the pair is now complete before treating this as a durable
      // success — a read failure here does not corrupt the just-repaired
      // progress, it only defers clearing any pending source to a retry
      // that can actually confirm the pair.
      const confirmProgress = await fetchProgress(userId).catch(() => null);
      if (!confirmProgress) {
        return {
          ok: false,
          reason: 'persist_error',
          message: 'Impossible de vérifier ta progression après réparation. Réessaie.',
        };
      }
    }

    // Plan + progress are both confirmed present (already, or just
    // repaired above) — never recreate or reinitialize a complete,
    // legitimate pair.
    // Always clear the in-memory draft — it has no ownerUserId and cannot
    // belong to another account.
    await clearOnboardingDraft();

    // IMPORTANT: the durable pending payload is NOT cleared here. It is the
    // transaction marker for the entire onboarding → dashboard handoff.
    // The caller (orchestrateAuthedFinalize / useOnboardingV2AuthFinalize)
    // clears it only after handOffFinalizedProgram succeeds. If the handoff
    // fails, the pending survives so a retry can detect the existing pair
    // (idempotent guard above) and re-attempt the handoff without losing
    // the retry source.

    return { ok: true, reason: 'plan_already_exists' };
  }

  const draft = await readOnboardingDraft();

  let source: PlanInputSource | null = null;
  let notificationPreference: NotificationPreference | null = null;
  let firstName: string | null = null;

  if (draft) {
    source = draft;
    notificationPreference = draft.notificationPreference;
    firstName = draft.firstName;
  } else {
    // Phase 1: try a fresh claim. Requires proof of onboarding parcours
    // (authFlowId param, stored activeAuthFlow, or in-memory sessionAuthFlowId).
    let payload = await claimPendingOnboardingPlanForUser(userId, authFlowId);

    // Phase 2: cold-start resume path. Claim may fail because activeAuthFlow
    // is already consumed (claim succeeded in a prior session but the app was
    // killed before plan persistence). Read the already-owned payload directly
    // — no authFlowId required, ownerUserId is the durable proof.
    if (!payload) {
      payload = await readOwnedPendingOnboardingPlanForUser(userId);
    }

    if (!payload) return { ok: false, reason: 'no_source' };
    source = payload;
    notificationPreference = payload.notificationPreference;
    firstName = payload.firstName;
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
    // A brand-new plan is being created for this user — any progress row
    // found here necessarily predates it (this branch only runs when
    // fetchPlan(userId) returned null above), so it can never be a
    // legitimate continuation. Always reset to the new plan's own initial
    // position rather than upsertProgress()'s preserve-on-update semantics
    // (which exist for real session-completion callers, not onboarding).
    await resetProgressForNewPlan(userId, planResult.progressPayload);
  } catch (err) {
    // Real Supabase failure — nothing is cleared, so the exact same source
    // (draft or pending payload) can be retried on the next login attempt.
    return {
      ok: false,
      reason: 'persist_error',
      message: err instanceof Error ? err.message : 'Erreur de sauvegarde.',
    };
  }

  // Confirm the pair actually exists before treating this as durable and
  // clearing any pre-auth source — a read failure here does NOT undo or
  // corrupt the pair just persisted above, it only defers clearing the
  // pending payload to a retry that can confirm it.
  const [confirmPlan, confirmProgress] = await Promise.all([
    fetchPlan(userId).catch(() => null),
    fetchProgress(userId).catch(() => null),
  ]);
  if (!confirmPlan || !confirmProgress) {
    return {
      ok: false,
      reason: 'persist_error',
      message: 'Impossible de vérifier ton programme après création. Réessaie.',
    };
  }

  // Best-effort — persisting the first name is a nice-to-have (used to
  // personalize the Profile screen) and must never block the user from
  // reaching their freshly created, already-persisted plan.
  if (firstName) {
    try {
      await upsertProfileFirstName(userId, firstName);
    } catch {
      // Non-fatal — the plan itself is already safely persisted above.
    }
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
  // the in-memory draft (no ownerUserId, cannot belong to another account).
  // The durable pending payload is NOT cleared here — it is the transaction
  // marker for the entire onboarding → dashboard handoff. The caller
  // (orchestrateAuthedFinalize / useOnboardingV2AuthFinalize) clears it
  // only after handOffFinalizedProgram succeeds, so a handoff failure
  // leaves the pending intact for retry.
  await clearOnboardingDraft();
  return { ok: true, reason: 'created' };
}
