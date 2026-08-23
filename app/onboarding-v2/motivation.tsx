import { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import {
  readOnboardingDraftForOwner, updateOnboardingDraftForOwner, MotivationReason,
} from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, QUESTIONNAIRE_BACK_TARGETS,
} from '@/lib/onboardingQuestionnaire';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingChoiceCard from '@/components/onboarding/OnboardingChoiceCard';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

// ─── palette — identical tokens to Splash/Welcome/Name/Greeting/
// Session/Revisions/Program/Ready/Build (kept local, not exported from
// those files, to avoid touching them) ──────────────────────────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';

interface Option {
  value: MotivationReason;
  label: string;
}

const OPTIONS: Option[] = [
  { value: 'closer_to_allah',   label: "Me rapprocher d'Allah" },
  { value: 'memorize_all',      label: 'Mémoriser tout le Coran' },
  { value: 'memorize_surahs',   label: 'Mémoriser certaines sourates' },
  { value: 'build_consistency', label: 'Être plus régulier dans mon Hifz' },
  { value: 'personal_goal',     label: 'Accomplir un objectif personnel' },
  { value: 'other',             label: 'Autre' },
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

export default function OnboardingMotivationScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selected, setSelected] = useState<MotivationReason | null>(null);

  const mountedRef      = useRef(true);
  const isSubmittingRef = useRef(false);

  const isValid = selected !== null;

  // ── reduce motion detection ──
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── resume: restore a previously chosen reason within the same session ──
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
      if (draft.motivationReason) setSelected(draft.motivationReason);
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

  // ── entrance — title/subtitle rise, then the card list fades in ──
  const titleOpacity    = useRef(new Animated.Value(0)).current;
  const titleY          = useRef(new Animated.Value(12)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleY       = useRef(new Animated.Value(8)).current;
  const listOpacity     = useRef(new Animated.Value(0)).current;
  const listY           = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      subtitleOpacity.setValue(1); subtitleY.setValue(0);
      listOpacity.setValue(1); listY.setValue(0);
      return;
    }

    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 240, delay: 100, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleY,       { toValue: 0, duration: 240, delay: 100, easing: E, useNativeDriver: true }),
      Animated.timing(listOpacity, { toValue: 1, duration: 260, delay: 220, easing: E, useNativeDriver: true }),
      Animated.timing(listY,       { toValue: 0, duration: 260, delay: 220, easing: E, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  function handleSelect(value: MotivationReason) {
    if (selected === value) return;
    hapticLight();
    setSelected(value);
  }

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.motivation!);
  }

  async function handleContinue() {
    if (isSubmittingRef.current || !selected || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();

    await updateOnboardingDraftForOwner(draftOwner, { currentStep: 'motivation_reassurance', motivationReason: selected });
    router.push('/onboarding-v2/motivation-reassurance');
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
            currentStep={phaseStepNumber('motivation')}
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
              Pourquoi veux-tu mémoriser le Coran ?
            </Animated.Text>

            <Animated.Text
              style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ translateY: subtitleY }] }]}
            >
              Choisis la raison qui te ressemble le plus.
            </Animated.Text>

            <Animated.View
              style={[styles.list, { opacity: listOpacity, transform: [{ translateY: listY }] }]}
            >
              {OPTIONS.map(option => (
                <OnboardingChoiceCard
                  key={option.value}
                  title={option.label}
                  selected={selected === option.value}
                  onPress={() => handleSelect(option.value)}
                />
              ))}
            </Animated.View>
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

  list: { gap: 10 },

  ctaOuter: {
    width: '100%',
    paddingTop: 16,
  },
});
