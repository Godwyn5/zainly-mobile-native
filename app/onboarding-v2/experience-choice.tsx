import { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraftForOwner, updateOnboardingDraftForOwner, ExperienceChoice } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, QUESTIONNAIRE_BACK_TARGETS,
} from '@/lib/onboardingQuestionnaire';
import {
  buildPlanInputFromDraft, isPlanValidationError, routeForOnboardingStep,
  PENDING_SIGNUP_USER_ID,
} from '@/lib/onboardingPlanValidation';
import { getRevenueCatCustomerInfo, hasRevenueCatEntitlement } from '@/lib/revenueCat';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingChoiceCard from '@/components/onboarding/OnboardingChoiceCard';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

// ─── palette — identical tokens to the rest of Onboarding V2 (kept local,
// not exported from those files, to avoid touching them) ────────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';

interface Option {
  value: ExperienceChoice;
  title: string;
  description: string;
  badge?: string;
  emphasized?: boolean;
}

// Deliberately no subscription names, no prices, no trial mention — only
// the pace/intention of the two experiences.
const OPTIONS: Option[] = [
  {
    value: 'unlimited',
    title: 'Avance plus vite dans ta mémorisation du Coran.',
    description: 'Fais des séances illimitées et progresse plus rapidement.',
    badge: 'Recommandé',
    emphasized: true,
  },
  {
    value: 'daily_limited',
    title: 'Avance plus lentement dans ta mémorisation du Coran.',
    description: 'Fais une séance par jour et construis une habitude durable.',
  },
];

/** A slow, symmetric 0→1→0 breathing loop — the single primitive behind
 *  every ambient background motion on this screen (glow, wash, motifs). */
function ambientBreath(value: Animated.Value, halfDuration: number, delay = 0) {
  return Animated.loop(
    Animated.sequence([
      Animated.timing(value, {
        toValue: 1, duration: halfDuration, delay,
        easing: Easing.inOut(Easing.sin), useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0, duration: halfDuration,
        easing: Easing.inOut(Easing.sin), useNativeDriver: true,
      }),
    ])
  );
}

export default function OnboardingExperienceChoiceScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selected, setSelected] = useState<ExperienceChoice | null>(null);

  const mountedRef      = useRef(true);
  const isSubmittingRef = useRef(false);

  const isValid = selected !== null;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── resume: restore a previously chosen experience within the session ──
  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) {
        router.replace('/onboarding-v2/name');
        return;
      }
      if (!draft.learningMode) {
        router.replace('/onboarding-v2/learning-mode');
        return;
      }
      // Full completeness check (point 7 of the validation requirements):
      // this is the last screen before leaving the block, so every field
      // computePlan() will need must already be present. userId is not
      // known yet at this pre-signup stage — a non-empty placeholder is
      // enough to exercise every OTHER structural check (mode-specific
      // required fields), since userId itself is re-validated for real
      // once it exists (post-signup).
      const check = buildPlanInputFromDraft(draft, PENDING_SIGNUP_USER_ID);
      if (isPlanValidationError(check) && check.missingStep !== 'first_name') {
        router.replace(routeForOnboardingStep(check.missingStep));
        return;
      }
      if (draft.experienceChoice) setSelected(draft.experienceChoice);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  // ── living background — same breathing loops as every previous screen ──
  const washBreath   = useRef(new Animated.Value(0)).current;
  const glowPulse     = useRef(new Animated.Value(0)).current;
  const lightDrift    = useRef(new Animated.Value(0)).current;
  const motifBreathA  = useRef(new Animated.Value(0)).current;
  const motifBreathB  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loops = [
      ambientBreath(washBreath, 5600),
      ambientBreath(glowPulse, 3800),
      ambientBreath(lightDrift, 9200),
      ambientBreath(motifBreathA, 6400),
      ambientBreath(motifBreathB, 7400, 900),
    ];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduceMotion]);

  // ── entrance — title/subtitle rise, then the two cards enter with a
  // slight decal, the recommended one landing first. ─────────────────────
  const titleOpacity    = useRef(new Animated.Value(0)).current;
  const titleY          = useRef(new Animated.Value(12)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleY       = useRef(new Animated.Value(8)).current;
  const cardAnims = useRef(OPTIONS.map(() => ({
    opacity: new Animated.Value(0),
    y: new Animated.Value(14),
  }))).current;

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      subtitleOpacity.setValue(1); subtitleY.setValue(0);
      cardAnims.forEach(a => { a.opacity.setValue(1); a.y.setValue(0); });
      return;
    }

    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 240, delay: 100, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleY,       { toValue: 0, duration: 240, delay: 100, easing: E, useNativeDriver: true }),
      ...cardAnims.flatMap((a, i) => [
        Animated.timing(a.opacity, { toValue: 1, duration: 280, delay: 220 + i * 110, easing: E, useNativeDriver: true }),
        Animated.timing(a.y,       { toValue: 0, duration: 280, delay: 220 + i * 110, easing: E, useNativeDriver: true }),
      ]),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  function handleSelect(value: ExperienceChoice) {
    if (selected === value) return;
    hapticLight();
    setSelected(value);
  }

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.experience_choice!);
  }

  async function handleContinue() {
    if (isSubmittingRef.current || !selected || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();

    try {
      await updateOnboardingDraftForOwner(draftOwner, { experienceChoice: selected });

      if (selected === 'daily_limited') {
        router.push('/onboarding-v2/free-support');
        return;
      }

      // 'unlimited' — the illimited experience must only ever unlock from a
      // real, currently active RevenueCat entitlement, never merely from
      // tapping this card. Check live state before deciding whether the
      // paywall is even needed.
      const customerInfo = await getRevenueCatCustomerInfo();
      if (hasRevenueCatEntitlement(customerInfo)) {
        router.push('/onboarding-v2/premium-confirmation');
        return;
      }
      router.push('/premium?context=onboarding');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (!draftChecked) {
    return <View style={styles.root} />;
  }

  const washScale = washBreath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] });
  const washY = washBreath.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const vignetteOpacity = washBreath.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });

  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.78] });
  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const glowDriftX = lightDrift.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
  const glowDriftY = lightDrift.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] });

  const motifARotate = motifBreathA.interpolate({ inputRange: [0, 1], outputRange: ['44deg', '46deg'] });
  const motifAOpacity = motifBreathA.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.18] });
  const motifBRotate = motifBreathB.interpolate({ inputRange: [0, 1], outputRange: ['44deg', '46deg'] });
  const motifBOpacity = motifBreathB.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />

      <Animated.View
        pointerEvents="none"
        style={[styles.wash, { transform: [{ scale: washScale }, { translateY: washY }] }]}
      />
      <Animated.View pointerEvents="none" style={[styles.vignetteTop, { opacity: vignetteOpacity }]} />
      <Animated.View pointerEvents="none" style={[styles.vignetteBottom, { opacity: vignetteOpacity }]} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ambientGlow,
          {
            opacity: glowOpacity,
            transform: [{ translateX: glowDriftX }, { translateY: glowDriftY }, { scale: glowScale }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.motifLineA, { opacity: motifAOpacity, transform: [{ rotate: motifARotate }] }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.motifLineB, { opacity: motifBOpacity, transform: [{ rotate: motifBRotate }] }]}
      />

      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>

          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('experience_choice')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              Comment veux-tu avancer dans ta mémorisation ?
            </Animated.Text>

            <Animated.Text
              style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ translateY: subtitleY }] }]}
            >
              Choisis le rythme qui correspond à ton objectif.
            </Animated.Text>

            <View style={styles.list}>
              {OPTIONS.map((option, i) => (
                <Animated.View
                  key={option.value}
                  style={{ opacity: cardAnims[i].opacity, transform: [{ translateY: cardAnims[i].y }] }}
                >
                  <OnboardingChoiceCard
                    title={option.title}
                    description={option.description}
                    badge={option.badge}
                    emphasized={option.emphasized}
                    selected={selected === option.value}
                    onPress={() => handleSelect(option.value)}
                  />
                </Animated.View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.ctaOuter}>
            <OnboardingBottomAction
              label="Continuer"
              disabled={!isValid}
              onPress={handleContinue}
            />
          </View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BEIGE },
  wash: {
    position: 'absolute', top: -140, left: -90, right: -90,
    height: 640, borderRadius: 420, backgroundColor: SPLASH_BEIGE,
  },
  vignetteTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 90,
    backgroundColor: SPLASH_GREEN_FAINT,
  },
  vignetteBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 110,
    backgroundColor: SPLASH_GREEN_FAINT,
  },
  motifLineA: {
    position: 'absolute', top: 74, left: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GOLD_DIM,
    opacity: 0.14, transform: [{ rotate: '45deg' }],
  },
  motifLineB: {
    position: 'absolute', bottom: 96, right: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GREEN,
    opacity: 0.08, transform: [{ rotate: '45deg' }],
  },
  ambientGlow: {
    position: 'absolute', top: '30%', left: '10%', right: '10%',
    height: 260, borderRadius: 200, backgroundColor: 'rgba(198,161,91,0.16)',
  },

  safe: { flex: 1 },
  shell: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },

  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 8,
  },
  subtitle: {
    fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.6,
    textAlign: 'center', lineHeight: 21, marginBottom: 26,
  },

  list: { gap: 14 },

  ctaOuter: {
    width: '100%',
    paddingTop: 16,
  },
});
