// ─── Onboarding V2 questionnaire flow — centralized configuration ─────────
// Single source of truth for the questionnaire's navigation and progress,
// so no screen ever hardcodes its own "back" target or step numbering.
//
// PROGRESS MODEL — segmented by phase, NOT by raw screen count:
// The 'niveau' phase's actual screen count depends on the chosen learning
// mode (recommended: 1 screen; start_surah: 2 screens; custom_order: 2
// screens) — a flat step counter would therefore either lie about the
// total before the mode is even chosen, or change the denominator
// mid-flow, both explicitly disallowed. Instead, the bar reflects fixed
// PHASES; every screen inside a phase reuses that phase's number and never
// regresses it. This is the "segmented progression" strategy explicitly
// allowed for branches of varying depth.
//
// The intent (motivation) and its reassurance, the learning-mode
// reassurance, and the experience/premium branch were removed from the
// parcours — 'parcours' is now the first phase.
//
// Example:
//   learning-mode (phase 1)         → 1/4
//   start-surah (phase 2, mode-dependent) → 2/4
//   known-surahs (phase 2, common)  → 2/4
//   notifications (phase 3)         → 3/4
//   program-summary (phase 4)       → 4/4 (100% only here — program-generating
//     renders no numeric progress bar at all, see its own screen)

export type OnboardingPhase =
  | 'parcours' | 'niveau' | 'notifications'
  | 'programme';

export const ONBOARDING_PHASE_ORDER: OnboardingPhase[] = [
  'parcours', 'niveau', 'notifications', 'programme',
];

export const TOTAL_ONBOARDING_PHASES = ONBOARDING_PHASE_ORDER.length;

export const PHASE_NUMBER: Record<OnboardingPhase, number> = {
  parcours: 1,
  niveau: 2,
  notifications: 3,
  programme: 4,
};

/** Every route of the block (decisions + their branch screens). Used for
 *  navigation wiring and phase lookup below. */
export type OnboardingQuestionnaireRouteId =
  | 'learning_mode'
  | 'start_surah_picker'
  | 'custom_order_picker'
  | 'known_surahs'
  | 'notifications'
  | 'program_summary';

export const QUESTIONNAIRE_ROUTE_PHASE: Record<OnboardingQuestionnaireRouteId, OnboardingPhase> = {
  learning_mode: 'parcours',
  start_surah_picker: 'niveau',
  custom_order_picker: 'niveau',
  known_surahs: 'niveau',
  notifications: 'notifications',
  program_summary: 'programme',
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
  learning_mode: '/onboarding-v2/build',
  start_surah_picker: '/onboarding-v2/learning-mode',
  custom_order_picker: '/onboarding-v2/learning-mode',
  // known_surahs has no static entry: its "back" depends on the chosen
  // mode (start_surah_picker / custom_order_picker / learning-mode for
  // 'recommended'). Screens must compute it from draft.learningMode via
  // knownSurahsBackTarget() below, never a constant.
  notifications: '/onboarding-v2/known-surahs',
  // program_summary has no static entry either — see programSummaryBackTarget().
};

/** known_surahs is the one screen whose "back" target depends on the
 *  chosen mode — computed explicitly here instead of a static map entry,
 *  still never `router.back()`. */
export function knownSurahsBackTarget(learningMode: 'recommended' | 'start_surah' | 'custom_order' | null): string {
  if (learningMode === 'start_surah') return '/onboarding-v2/start-surah';
  if (learningMode === 'custom_order') return '/onboarding-v2/custom-order';
  return '/onboarding-v2/learning-mode';
}

/**
 * program_summary's "back" deliberately never points at program_generating
 * (a transient loading animation with nothing to resume into) — it returns
 * to the last real input screen (notifications), so the user can change
 * their answer and regenerate.
 */
export const PROGRAM_SUMMARY_BACK_TARGET = '/onboarding-v2/notifications';
