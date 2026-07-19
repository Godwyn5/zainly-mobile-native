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
//   motivation (phase 1)            → 1/7
//   motivation-reassurance          → 1/7 (same phase, never advances)
//   learning-mode (phase 2)         → 2/7
//   start-surah (phase 3, mode-dependent) → 3/7
//   known-surahs (phase 3, common)  → 3/7
//   experience-choice (phase 4)     → 4/7
//   premium-confirmation / free-support (phase 4) → 4/7 (same phase as
//     experience-choice — the decision itself, not a new step)
//   notifications (phase 5)         → 5/7
//   discovery-source (phase 6)      → 6/7
//   program-summary (phase 7)       → 7/7 (100% only here — program-generating
//     renders no numeric progress bar at all, see its own screen)

export type OnboardingPhase =
  | 'intention' | 'parcours' | 'niveau' | 'experience'
  | 'notifications' | 'discovery' | 'programme';

export const ONBOARDING_PHASE_ORDER: OnboardingPhase[] = [
  'intention', 'parcours', 'niveau', 'experience',
  'notifications', 'discovery', 'programme',
];

export const TOTAL_ONBOARDING_PHASES = ONBOARDING_PHASE_ORDER.length;

export const PHASE_NUMBER: Record<OnboardingPhase, number> = {
  intention: 1,
  parcours: 2,
  niveau: 3,
  experience: 4,
  notifications: 5,
  discovery: 6,
  programme: 7,
};

/** Every route of the block (decisions + their reassurance + branch
 *  screens). Used for navigation wiring and phase lookup below. */
export type OnboardingQuestionnaireRouteId =
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
  | 'program_summary';

export const QUESTIONNAIRE_ROUTE_PHASE: Record<OnboardingQuestionnaireRouteId, OnboardingPhase> = {
  motivation: 'intention',
  learning_mode: 'parcours',
  start_surah_picker: 'niveau',
  custom_order_picker: 'niveau',
  known_surahs: 'niveau',
  experience_choice: 'experience',
  premium_confirmation: 'experience',
  free_support: 'experience',
  notifications: 'notifications',
  discovery_source: 'discovery',
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
  motivation: '/onboarding-v2/build',
  learning_mode: '/onboarding-v2/motivation',
  start_surah_picker: '/onboarding-v2/learning-mode',
  custom_order_picker: '/onboarding-v2/learning-mode',
  // known_surahs has no static entry: its "back" depends on the chosen
  // mode (start_surah_picker / custom_order_picker / learning-mode
  // for 'recommended'). Screens must compute it from
  // draft.learningMode via knownSurahsBackTarget() below, never a constant.
  experience_choice: '/onboarding-v2/known-surahs',
  // premium_confirmation / free_support / discovery_source all have a
  // single, mode-independent back target — static entries are enough.
  premium_confirmation: '/onboarding-v2/experience-choice',
  free_support: '/onboarding-v2/experience-choice',
  discovery_source: '/onboarding-v2/notifications',
  // notifications has no static entry: its "back" depends on which of the
  // two experience_choice branches produced it (premium_confirmation vs
  // free_support). Screens must compute it via notificationsBackTarget()
  // below, never a constant.
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

/** notifications is the one screen whose "back" target depends on which
 *  experience_choice branch led to it. */
export function notificationsBackTarget(experienceChoice: 'unlimited' | 'daily_limited' | null): string {
  if (experienceChoice === 'unlimited') return '/onboarding-v2/premium-confirmation';
  return '/onboarding-v2/free-support';
}

/**
 * program_summary's "back" deliberately never points at program_generating
 * (a transient loading animation with nothing to resume into) — it returns
 * to the last real input screen, so the user can change their discovery
 * answer and regenerate.
 */
export const PROGRAM_SUMMARY_BACK_TARGET = '/onboarding-v2/discovery-source';

/**
 * Destination after experience-choice depends on the chosen experience AND
 * (for 'unlimited') on whether a Zainly+ entitlement is already active —
 * computed directly in experience-choice.tsx (it needs a live RevenueCat
 * check, which does not belong in this static config module). Kept here
 * only as documentation of the two possible next steps:
 *   - 'unlimited'    → already entitled: /onboarding-v2/premium-confirmation
 *                      not entitled:      /premium?context=onboarding
 *   - 'daily_limited' → /onboarding-v2/free-support
 * Both branches converge again at /onboarding-v2/notifications.
 */
