import { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraftForOwner, updateOnboardingDraftForOwner, DiscoverySource } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import { TOTAL_ONBOARDING_PHASES, phaseStepNumber } from '@/lib/onboardingQuestionnaire';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingChoiceCard from '@/components/onboarding/OnboardingChoiceCard';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';

interface Option {
  value: DiscoverySource;
  label: string;
}

const OPTIONS: Option[] = [
  { value: 'tiktok',       label: 'TikTok' },
  { value: 'instagram',    label: 'Instagram' },
  { value: 'youtube',      label: 'YouTube' },
  { value: 'google',       label: 'Google' },
  { value: 'app_store',    label: 'App Store' },
  { value: 'word_of_mouth', label: 'Un proche' },
  { value: 'other',        label: 'Autre' },
];

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

// ─── discovery-source — single-select, purely informational, never written
// to Supabase at this stage (draft is in-memory only, consistent with every
// other onboarding-v2 answer up to signup). ─────────────────────────────────
export default function OnboardingDiscoverySourceScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selected, setSelected] = useState<DiscoverySource | null>(null);
  const isSubmittingRef = useRef(false);
  const mountedRef = useRef(true);

  const isValid = selected !== null;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

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
      if (draft.learningMode === 'start_surah' && draft.startingSurah == null) {
        router.replace('/onboarding-v2/start-surah');
        return;
      }
      if (draft.learningMode === 'custom_order' && draft.customSurahOrder.length === 0) {
        router.replace('/onboarding-v2/custom-order');
        return;
      }
      if (draft.discoverySource) setSelected(draft.discoverySource);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  const washBreath = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(12)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const listOpacity   = useRef(new Animated.Value(0)).current;
  const listY         = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (!draftChecked) return;
    if (!reduceMotion) ambientBreath(washBreath, 5600).start();

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      subtitleOpacity.setValue(1);
      listOpacity.setValue(1); listY.setValue(0);
      return;
    }
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 260, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 240, delay: 100, easing: E, useNativeDriver: true }),
      Animated.timing(listOpacity, { toValue: 1, duration: 260, delay: 200, easing: E, useNativeDriver: true }),
      Animated.timing(listY,       { toValue: 0, duration: 260, delay: 200, easing: E, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  function handleSelect(value: DiscoverySource) {
    if (selected === value) return;
    hapticLight();
    setSelected(value);
  }

  function handleBack() {
    router.replace('/onboarding-v2/notifications');
  }

  async function handleContinue() {
    if (isSubmittingRef.current || !selected || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraftForOwner(draftOwner, {
        discoverySource: selected,
        currentStep: 'program_generating',
      });
      router.push('/onboarding-v2/program-generating');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (!draftChecked) {
    return <View style={styles.root} />;
  }

  const washScale = washBreath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <Animated.View pointerEvents="none" style={[styles.wash, { transform: [{ scale: washScale }] }]} />

      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>

          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('discovery_source')}
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
              Comment as-tu découvert Zainly ?
            </Animated.Text>

            <Animated.Text style={[styles.subtitle, { opacity: subtitleOpacity }]}>
              Cette réponse nous aide à mieux comprendre comment les utilisateurs trouvent Zainly.
            </Animated.Text>

            <Animated.View style={[styles.list, { opacity: listOpacity, transform: [{ translateY: listY }] }]}>
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
              label="Créer mon programme"
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
  safe: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 24, paddingBottom: 10 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },

  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 8,
  },
  subtitle: {
    fontSize: 14, color: SPLASH_GREEN, opacity: 0.6,
    textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 8,
  },

  list: { gap: 10 },

  ctaOuter: { width: '100%', paddingTop: 16 },
});
