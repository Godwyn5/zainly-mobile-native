// ─── Typed content mapping for the questionnaire's reassurance screens ────
// Using `Record<Union, X>` (never a switch with a default branch) is
// deliberate: adding a new MotivationReason / LearningMode value WITHOUT
// adding its entry here fails `npx tsc --noEmit` immediately, instead of
// silently falling back to generic text at runtime.

import type { MotivationReason, LearningMode } from './onboardingDraft';

export interface ReassuranceContent {
  title: string;
  body: string;
}

export const MOTIVATION_REASSURANCE_CONTENT: Record<MotivationReason, ReassuranceContent> = {
  closer_to_allah: {
    title: 'Une intention qui mérite de la constance.',
    body: 'Zainly t\u2019aidera à faire une place régulière au Coran dans ton quotidien.',
  },
  memorize_all: {
    title: 'Un grand objectif se construit un jour après l\u2019autre.',
    body: 'Zainly organisera ton parcours pour que chaque séance te rapproche progressivement de ton objectif.',
  },
  memorize_surahs: {
    title: 'Chaque sourate mémorisée est une avancée.',
    body: 'Tu pourras progresser étape par étape, sans perdre de vue les sourates qui comptent pour toi.',
  },
  build_consistency: {
    title: 'La régularité transforme les petites séances en vrais progrès.',
    body: 'Zainly préparera ton travail quotidien pour t\u2019aider à rester constant dans ton Hifz.',
  },
  personal_goal: {
    title: 'Ton objectif donne une direction à ton parcours.',
    body: 'Zainly t\u2019aidera à avancer avec une structure claire et adaptée à ton rythme.',
  },
  other: {
    title: 'Ta raison t\u2019appartient.',
    body: 'Zainly sera là pour transformer cette intention en un parcours concret et régulier.',
  },
};

export const LEARNING_MODE_REASSURANCE_CONTENT: Record<LearningMode, ReassuranceContent> = {
  recommended: {
    title: 'Tu peux te concentrer sur ton Hifz.',
    body: 'Zainly organisera ton point de départ et la suite de ton parcours pour que tu n\u2019aies pas à tout planifier toi-même.',
  },
  start_surah: {
    title: 'Tu commenceras par la sourate qui compte pour toi.',
    body: 'Zainly construira ton programme autour de ce point de départ tout en organisant la suite de ton parcours.',
  },
  custom_order: {
    title: 'Ton parcours suivra l\u2019ordre que tu as choisi.',
    body: 'Zainly transformera tes choix en séances structurées pour que tu puisses avancer avec clarté.',
  },
};
