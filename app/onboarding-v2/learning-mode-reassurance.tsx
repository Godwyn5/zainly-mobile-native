import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraft, updateOnboardingDraft, LearningMode } from '@/lib/onboardingDraft';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, QUESTIONNAIRE_BACK_TARGETS,
} from '@/lib/onboardingQuestionnaire';
import { LEARNING_MODE_REASSURANCE_CONTENT } from '@/lib/onboardingReassuranceContent';
import OnboardingReassuranceLayout from '@/components/onboarding/OnboardingReassuranceLayout';

const SPLASH_BEIGE = '#F7F2E7';

export default function OnboardingLearningModeReassuranceScreen() {
  const [content, setContent] = useState<{ title: string; body: string } | null>(null);
  const [mode, setMode] = useState<LearningMode | null>(null);

  // ── every mount re-reads the draft, so a modified learningMode is never
  // left showing stale reassurance text (in-session edits). Falls back to
  // the question that must produce a valid answer if opened without one. ─
  useEffect(() => {
    let cancelled = false;
    readOnboardingDraft().then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) {
        router.replace('/onboarding-v2/name');
        return;
      }
      if (!draft.motivationReason) {
        router.replace('/onboarding-v2/motivation');
        return;
      }
      if (!draft.learningMode) {
        router.replace('/onboarding-v2/learning-mode');
        return;
      }
      setContent(LEARNING_MODE_REASSURANCE_CONTENT[draft.learningMode]);
      setMode(draft.learningMode);
    });
    return () => { cancelled = true; };
  }, []);

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.learning_mode_reassurance!);
  }

  async function handleContinue() {
    hapticLight();
    // Opens the deep branch matching the chosen mode — never straight to
    // experience-choice — so computePlan() later receives the specific
    // data each mode requires (startingSurah / customSurahOrder), then the
    // common known-surahs question shared by all 3 modes.
    if (mode === 'start_surah') {
      await updateOnboardingDraft({ currentStep: 'start_surah_picker' });
      router.push('/onboarding-v2/start-surah');
      return;
    }
    if (mode === 'custom_order') {
      await updateOnboardingDraft({ currentStep: 'custom_order_picker' });
      router.push('/onboarding-v2/custom-order');
      return;
    }
    await updateOnboardingDraft({ currentStep: 'known_surahs' });
    router.push('/onboarding-v2/known-surahs');
  }

  if (!content) {
    return <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />;
  }

  return (
    <OnboardingReassuranceLayout
      currentStep={phaseStepNumber('learning_mode_reassurance')}
      totalSteps={TOTAL_ONBOARDING_PHASES}
      onBack={handleBack}
      title={content.title}
      body={content.body}
      ctaLabel="Continuer"
      onContinue={handleContinue}
    />
  );
}
