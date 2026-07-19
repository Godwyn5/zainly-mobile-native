import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraft, updateOnboardingDraft } from '@/lib/onboardingDraft';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, QUESTIONNAIRE_BACK_TARGETS,
} from '@/lib/onboardingQuestionnaire';
import { MOTIVATION_REASSURANCE_CONTENT } from '@/lib/onboardingReassuranceContent';
import OnboardingReassuranceLayout from '@/components/onboarding/OnboardingReassuranceLayout';

const SPLASH_BEIGE = '#F7F2E7';

export default function OnboardingMotivationReassuranceScreen() {
  const [content, setContent] = useState<{ title: string; body: string } | null>(null);

  // ── every mount re-reads the draft, so a modified motivationReason is
  // never left showing stale reassurance text (in-session edits). If the
  // route is ever opened without a valid answer, fall back to the
  // question that must produce one instead of showing generic text. ──────
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
      setContent(MOTIVATION_REASSURANCE_CONTENT[draft.motivationReason]);
    });
    return () => { cancelled = true; };
  }, []);

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.motivation_reassurance!);
  }

  async function handleContinue() {
    hapticLight();
    await updateOnboardingDraft({ currentStep: 'learning_mode' });
    router.push('/onboarding-v2/learning-mode');
  }

  if (!content) {
    return <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />;
  }

  return (
    <OnboardingReassuranceLayout
      currentStep={phaseStepNumber('motivation_reassurance')}
      totalSteps={TOTAL_ONBOARDING_PHASES}
      onBack={handleBack}
      title={content.title}
      body={content.body}
      ctaLabel="Continuer"
      onContinue={handleContinue}
    />
  );
}
