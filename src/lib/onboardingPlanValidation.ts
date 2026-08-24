// ─── Pure validation: onboarding-v2 draft → computePlan() PlanInput ────────
// Single source of truth for turning the anonymous draft into the exact
// object shape computePlan() expects (src/core/planEngine.ts). Never
// duplicates computePlan's own internal logic (surah ordering, ayah maths,
// estimates) — it only maps and validates the draft's fields, then lets
// computePlan do the real calculation, exactly like the historical
// SeriousQuestionnaire (app/onboarding/index.tsx) already does.
//
// This module is pure (no React, no Supabase, no navigation) and testable
// in isolation.

import type { PlanInput } from '@/core/planEngine';
import type { OnboardingDraftV1, OnboardingStep } from './onboardingDraft';

// ── ayahPerDay is NOT a real onboarding question ────────────────────────
// The historical onboarding (app/onboarding/index.tsx, DEFAULT_DAILY_AYAT_GOAL)
// hardcodes this to 1 and never asks the user — Zainly Free always starts
// new learners at 1 ayat/day. Re-declared here (not imported from an `app/`
// route file) with the exact same historical value, so onboarding-v2 never
// invents a "pace" question the legacy model never had.
const DEFAULT_DAILY_AYAT_GOAL = 1;

// ── pre-signup preview placeholder ──────────────────────────────────────────
// computePlan() only ever uses `userId` as an opaque non-empty string (it
// never queries Supabase itself — see src/core/planEngine.ts) — real
// persistence (upsertPlan/upsertProgress) always happens later, with the
// real authenticated userId, from src/lib/onboardingFinalize.ts. This
// shared placeholder lets every pre-signup screen (experience-choice's own
// completeness check, program-generating, program-summary) run the exact
// same structural validation / preview computation without duplicating a
// magic string.
export const PENDING_SIGNUP_USER_ID = 'pending-signup';

export interface OnboardingPlanValidationError {
  error: string;
  /** The step the user must complete/fix before a valid PlanInput can be
   *  built — callers use this to redirect deterministically instead of
   *  silently masking the problem with a default value. */
  missingStep: OnboardingStep;
}

export type OnboardingPlanValidationResult =
  | { planInput: PlanInput }
  | OnboardingPlanValidationError;

export function isPlanValidationError(
  r: OnboardingPlanValidationResult
): r is OnboardingPlanValidationError {
  return 'error' in r;
}

/** The only fields this mapping actually reads — deliberately narrower than
 *  the full OnboardingDraftV1 so the same function can build a PlanInput
 *  from either the in-memory draft OR the minimal, versioned pending-plan
 *  payload (src/lib/pendingOnboardingPlan.ts) once the draft itself no
 *  longer exists (app killed / email confirmation pending). Any full
 *  OnboardingDraftV1 already satisfies this shape, so existing callers are
 *  unaffected. */
export type PlanInputSource = Pick<
  OnboardingDraftV1,
  'learningMode' | 'knownSurahs' | 'startingSurah' | 'customSurahOrder' | 'continueWithRest'
>;

/**
 * Builds the exact PlanInput computePlan() expects from the current draft
 * (or an equivalent minimal source), or returns a typed error naming the
 * step to redirect to. Never invents a default for a missing required field.
 */
export function buildPlanInputFromDraft(
  draft: PlanInputSource,
  userId: string
): OnboardingPlanValidationResult {
  if (!userId) {
    return { error: 'Utilisateur non identifié.', missingStep: 'first_name' };
  }
  if (!draft.learningMode) {
    return { error: "Mode d'apprentissage manquant.", missingStep: 'learning_mode' };
  }

  const knownSurahs = Array.isArray(draft.knownSurahs) ? draft.knownSurahs : [];

  if (draft.learningMode === 'start_surah') {
    if (draft.startingSurah == null) {
      return { error: 'Sourate de départ manquante.', missingStep: 'start_surah_picker' };
    }
    // Invariant mirrored from the historical onboarding: the starting surah
    // must never also be marked as already known — sanitize defensively
    // even though known-surahs.tsx already prevents this contradiction in
    // the UI.
    const sanitizedKnown = knownSurahs.filter(n => n !== draft.startingSurah);
    return {
      planInput: {
        userId,
        planMode: 'start_surah',
        knownSurahs: sanitizedKnown,
        startingSurah: draft.startingSurah,
        ayahPerDay: DEFAULT_DAILY_AYAT_GOAL,
      },
    };
  }

  if (draft.learningMode === 'custom_order') {
    if (!Array.isArray(draft.customSurahOrder) || draft.customSurahOrder.length === 0) {
      return { error: 'Ordre personnalisé manquant.', missingStep: 'custom_order_picker' };
    }
    return {
      planInput: {
        userId,
        planMode: 'custom_order',
        knownSurahs,
        customSurahOrder: draft.customSurahOrder,
        continueWithRest: draft.continueWithRest,
        ayahPerDay: DEFAULT_DAILY_AYAT_GOAL,
      },
    };
  }

  // 'recommended'
  return {
    planInput: {
      userId,
      planMode: 'recommended',
      knownSurahs,
      ayahPerDay: DEFAULT_DAILY_AYAT_GOAL,
    },
  };
}

// Record (not switch+default) so adding a new OnboardingStep value without
// an entry here fails `npx tsc --noEmit` immediately instead of silently
// falling back to a generic route at runtime.
const ROUTE_FOR_STEP: Record<OnboardingStep, string> = {
  first_name:               '/onboarding-v2/name',
  greeting:                 '/onboarding-v2/greeting',
  learning_mode:            '/onboarding-v2/learning-mode',
  start_surah_picker:       '/onboarding-v2/start-surah',
  custom_order_picker:      '/onboarding-v2/custom-order',
  known_surahs:             '/onboarding-v2/known-surahs',
  experience_choice:        '/onboarding-v2/experience-choice',
  premium_confirmation:     '/onboarding-v2/experience-choice',
  free_support:             '/onboarding-v2/experience-choice',
  notifications:            '/onboarding-v2/notifications',
  discovery_source:         '/onboarding-v2/discovery-source',
  program_generating:       '/onboarding-v2/discovery-source',
  program_summary:          '/onboarding-v2/discovery-source',
};

/** Maps a missing step to the route the user should be redirected to. */
export function routeForOnboardingStep(step: OnboardingStep): string {
  return ROUTE_FOR_STEP[step];
}
