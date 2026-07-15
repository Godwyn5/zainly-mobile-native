// ─── Onboarding V2 questionnaire flow — centralized configuration ─────────
// Single source of truth for the questionnaire's navigation and progress,
// so no screen ever hardcodes its own "back" target or step numbering.
//
// PROGRESS MODEL — segmented by phase, NOT by raw screen count:
// The 'niveau' phase's actual screen count depends on the chosen learning
// mode (recommended: 1 screen; start_surah: 2 screens; custom_order: 2
// screens) — a flat step counter would therefore either lie about the
// total before the mode is even chosen, or change the denominator
// mid-flow, both explicitly disallowed. Instead, the bar reflects 4 fixed
// PHASES; every screen inside a phase reuses that phase's number and never
// regresses it. This is the "segmented progression" strategy explicitly
// allowed for branches of varying depth.
//
// Example:
//   motivation (phase 1)            → 1/4
//   motivation-reassurance          → 1/4 (same phase, never advances)
//   learning-mode (phase 2)         → 2/4
//   start-surah (phase 3, mode-dependent) → 3/4
//   known-surahs (phase 3, common)  → 3/4
//   experience-choice (phase 4)     → 4/4 (100% only here)

export type OnboardingPhase = 'intention' | 'parcours' | 'niveau' | 'experience';

export const ONBOARDING_PHASE_ORDER: OnboardingPhase[] = [
  'intention', 'parcours', 'niveau', 'experience',
];

export const TOTAL_ONBOARDING_PHASES = ONBOARDING_PHASE_ORDER.length;

export const PHASE_NUMBER: Record<OnboardingPhase, number> = {
  intention: 1,
  parcours: 2,
  niveau: 3,
  experience: 4,
};

/** Every route of the block (decisions + their reassurance + branch
 *  screens). Used for navigation wiring and phase lookup below. */
export type OnboardingQuestionnaireRouteId =
  | 'motivation'
  | 'motivation_reassurance'
  | 'learning_mode'
  | 'learning_mode_reassurance'
  | 'start_surah_picker'
  | 'custom_order_picker'
  | 'known_surahs'
  | 'experience_choice';

export const QUESTIONNAIRE_ROUTE_PHASE: Record<OnboardingQuestionnaireRouteId, OnboardingPhase> = {
  motivation: 'intention',
  motivation_reassurance: 'intention',
  learning_mode: 'parcours',
  learning_mode_reassurance: 'parcours',
  start_surah_picker: 'niveau',
  custom_order_picker: 'niveau',
  known_surahs: 'niveau',
  experience_choice: 'experience',
};

/** Convenience: the step number to feed OnboardingQuestionHeader for a
 *  given route — always its phase number, never a raw screen index. */
export function phaseStepNumber(route: OnboardingQuestionnaireRouteId): number {
  return PHASE_NUMBER[QUESTIONNAIRE_ROUTE_PHASE[route]];
}

/**
 * Explicit "back" destination for every route of the block — deliberately
 * NOT `router.back()`, whose result depends on navigation history that can
 * be inconsistent (deep links, replaced routes, skipped screens, app
 * relaunch). Each screen declares exactly where "back" takes it.
 *
 * Only routes that exist today are listed; add an entry here the moment a
 * new screen is built, instead of hardcoding its "back" target inline.
 */
export const QUESTIONNAIRE_BACK_TARGETS: Partial<Record<OnboardingQuestionnaireRouteId, string>> = {
  motivation: '/onboarding-v2/build',
  motivation_reassurance: '/onboarding-v2/motivation',
  learning_mode: '/onboarding-v2/motivation-reassurance',
  learning_mode_reassurance: '/onboarding-v2/learning-mode',
  start_surah_picker: '/onboarding-v2/learning-mode-reassurance',
  custom_order_picker: '/onboarding-v2/learning-mode-reassurance',
  // known_surahs has no static entry: its "back" depends on the chosen
  // mode (start_surah_picker / custom_order_picker / learning-mode-
  // reassurance for 'recommended'). Screens must compute it from
  // draft.learningMode via knownSurahsBackTarget() below, never a constant.
  experience_choice: '/onboarding-v2/known-surahs',
};

/** known_surahs is the one screen whose "back" target depends on the
 *  chosen mode — computed explicitly here instead of a static map entry,
 *  still never `router.back()`. */
export function knownSurahsBackTarget(learningMode: 'recommended' | 'start_surah' | 'custom_order' | null): string {
  if (learningMode === 'start_surah') return '/onboarding-v2/start-surah';
  if (learningMode === 'custom_order') return '/onboarding-v2/custom-order';
  return '/onboarding-v2/learning-mode-reassurance';
}

/**
 * Destination after the last screen of this block (experience-choice).
 * Points to signup — the next real, functional, already-existing screen:
 * creating an account is the natural continuation, since computePlan()
 * requires an authenticated userId (see src/core/planEngine.ts) that this
 * anonymous, pre-account draft never holds. The draft itself already
 * carries every field computePlan needs (see onboardingPlanValidation.ts);
 * only the userId is missing, and only signup can produce it. Update this
 * constant, not the screen file, if that integration point ever changes.
 */
export const AFTER_EXPERIENCE_CHOICE_ROUTE = '/(auth)/signup';
