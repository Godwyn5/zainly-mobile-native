import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraft, updateOnboardingDraft } from '@/lib/onboardingDraft';
import { TOTAL_ONBOARDING_PHASES, phaseStepNumber } from '@/lib/onboardingQuestionnaire';
import OnboardingReassuranceLayout from '@/components/onboarding/OnboardingReassuranceLayout';

const SPLASH_BEIGE = '#F7F2E7';

// ─── daily_limited branch — light reassurance, deliberately understated:
// never more desirable-looking than the 'unlimited' path, never guilt-
// inducing. Reuses OnboardingReassuranceLayout as-is (same restrained
// composition as motivation-reassurance/learning-mode-reassurance) — no
// chart, no badge, no emoji, matching the "moins spectaculaire" requirement.
export default function OnboardingFreeSupportScreen() {
  const [draftChecked, setDraftChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readOnboardingDraft().then(draft => {
      if (cancelled) return;
      if (!draft?.experienceChoice) {
        router.replace('/onboarding-v2/experience-choice');
        return;
      }
      setDraftChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  function handleBack() {
    router.replace('/onboarding-v2/experience-choice');
  }

  async function handleContinue() {
    hapticLight();
    await updateOnboardingDraft({ currentStep: 'notifications' });
    router.push('/onboarding-v2/notifications');
  }

  if (!draftChecked) {
    return <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />;
  }

  return (
    <OnboardingReassuranceLayout
      currentStep={phaseStepNumber('free_support')}
      totalSteps={TOTAL_ONBOARDING_PHASES}
      onBack={handleBack}
      title="Construis une habitude solide."
      body={"Une séance par jour peut suffire à installer une vraie régularité dans ton Hifz.\n\nZainly préparera ton parcours sans te surcharger."}
      ctaLabel="Continuer"
      onContinue={handleContinue}
    />
  );
}
