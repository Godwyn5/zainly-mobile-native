import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight, hapticSuccess } from '@/utils/haptics';
import { readOnboardingDraft } from '@/lib/onboardingDraft';
import { getRevenueCatCustomerInfo, hasRevenueCatEntitlement } from '@/lib/revenueCat';
import { TOTAL_ONBOARDING_PHASES, phaseStepNumber } from '@/lib/onboardingQuestionnaire';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

// ─── palette — identical tokens to the rest of Onboarding V2 ──────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK          = '#9F7628';
const CARD_CREAM         = '#FFFDF7';
const CARD_BORDER        = 'rgba(22,48,38,0.10)';
const MUTED_BAR          = 'rgba(22,48,38,0.18)';

// Purely illustrative relative heights (0–1) — never real numbers, never a
// promised/guaranteed outcome. "Une séance par jour" stays flat/capped;
// "Séances illimitées" only rises on some days (the ones the user is
// available/motivated), exactly the capacity — not certainty — the mission
// requires depicting.
const DAYS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];
const FIXED_PACE:     number[] = [0.32, 0.32, 0.32, 0.32, 0.32, 0.32, 0.32];
const UNLIMITED_PACE: number[] = [0.32, 0.5, 0.34, 0.78, 0.4, 0.92, 0.55];

const CHART_MAX_HEIGHT = 92;

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

export default function OnboardingPremiumConfirmationScreen() {
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── hard guard: this screen only exists after a real purchase or an
  // already-active entitlement — never reachable from merely tapping the
  // 'unlimited' card. ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await readOnboardingDraft();
      if (cancelled) return;
      if (!draft?.experienceChoice) {
        router.replace('/onboarding-v2/experience-choice');
        return;
      }
      const customerInfo = await getRevenueCatCustomerInfo();
      if (cancelled) return;
      if (!hasRevenueCatEntitlement(customerInfo)) {
        router.replace('/onboarding-v2/experience-choice');
        return;
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── living background — same breathing loops as every other v2 screen ──
  const washBreath = useRef(new Animated.Value(0)).current;
  const glowPulse   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion || !ready) return;
    const loops = [ambientBreath(washBreath, 5600), ambientBreath(glowPulse, 3800)];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduceMotion, ready]);

  // ── reveal choreography: title → chart bars grow → caption → CTA ──────
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(12)).current;
  const bodyOpacity   = useRef(new Animated.Value(0)).current;
  const chartTitleOpacity = useRef(new Animated.Value(0)).current;
  const barAnims = useRef(DAYS.map(() => new Animated.Value(0))).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity   = useRef(new Animated.Value(0)).current;
  const ctaY         = useRef(new Animated.Value(14)).current;
  const [ctaReady, setCtaReady] = useState(false);

  useEffect(() => {
    if (!ready) return;

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      bodyOpacity.setValue(1);
      chartTitleOpacity.setValue(1);
      barAnims.forEach(a => a.setValue(1));
      captionOpacity.setValue(1);
      ctaOpacity.setValue(1); ctaY.setValue(0);
      setCtaReady(true);
      return;
    }

    const E = Easing.out(Easing.cubic);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 320, easing: E, useNativeDriver: true }),
        Animated.timing(titleY,       { toValue: 0, duration: 320, easing: E, useNativeDriver: true }),
      ]),
      Animated.timing(bodyOpacity, { toValue: 1, duration: 280, easing: E, useNativeDriver: true }),
      Animated.timing(chartTitleOpacity, { toValue: 1, duration: 240, easing: E, useNativeDriver: true }),
      Animated.stagger(
        70,
        barAnims.map(a => Animated.timing(a, {
          toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }))
      ),
      Animated.timing(captionOpacity, { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) return;
      hapticSuccess();
      setCtaReady(true);
      Animated.parallel([
        Animated.timing(ctaOpacity, { toValue: 1, duration: 300, easing: E, useNativeDriver: true }),
        Animated.timing(ctaY,       { toValue: 0, duration: 300, easing: E, useNativeDriver: true }),
      ]).start();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduceMotion]);

  function handleBack() {
    router.replace('/onboarding-v2/experience-choice');
  }

  function handleContinue() {
    hapticLight();
    router.push('/onboarding-v2/notifications');
  }

  if (!ready) {
    return <View style={styles.root} />;
  }

  const washScale = washBreath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] });
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />

      <Animated.View
        pointerEvents="none"
        style={[styles.wash, { transform: [{ scale: washScale }] }]}
      />
      <Animated.View pointerEvents="none" style={[styles.ambientGlow, { opacity: glowOpacity }]} />

      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>

          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('premium_confirmation')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />

          <View style={styles.content}>
            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              Tu as choisi le rythme le plus ambitieux.
            </Animated.Text>

            <Animated.Text style={[styles.body, { opacity: bodyOpacity }]}>
              Les séances illimitées te permettent d’avancer davantage les jours où tu es prêt, sans attendre le lendemain.
            </Animated.Text>

            <Animated.View style={[styles.chartCard, { opacity: chartTitleOpacity }]}>
              <Text style={styles.chartTitle}>Pourquoi ce choix peut t’aider à avancer plus vite</Text>

              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: MUTED_BAR }]} />
                  <Text style={styles.legendText}>Une séance par jour</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: GOLD_DARK }]} />
                  <Text style={styles.legendText}>Séances illimitées</Text>
                </View>
              </View>

              <View style={styles.chartRow}>
                {DAYS.map((label, i) => {
                  const fixedHeight = barAnims[i].interpolate({
                    inputRange: [0, 1], outputRange: [0, FIXED_PACE[i] * CHART_MAX_HEIGHT],
                  });
                  const unlimitedHeight = barAnims[i].interpolate({
                    inputRange: [0, 1], outputRange: [0, UNLIMITED_PACE[i] * CHART_MAX_HEIGHT],
                  });
                  return (
                    <View key={label} style={styles.dayColumn}>
                      <View style={styles.barsPair}>
                        <Animated.View style={[styles.bar, styles.barFixed, { height: fixedHeight }]} />
                        <Animated.View style={[styles.bar, styles.barUnlimited, { height: unlimitedHeight }]} />
                      </View>
                      <Text style={styles.dayLabel}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </Animated.View>

            <Animated.Text style={[styles.caption, { opacity: captionOpacity }]}>
              Le rythme illimité te permet d’utiliser tes jours de motivation au maximum.
            </Animated.Text>
          </View>

          <Animated.View
            style={[styles.ctaOuter, { opacity: ctaOpacity, transform: [{ translateY: ctaY }] }]}
            pointerEvents={ctaReady ? 'auto' : 'none'}
          >
            <OnboardingBottomAction label="Continuer" onPress={handleContinue} />
          </Animated.View>

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
  ambientGlow: {
    position: 'absolute', top: '22%', left: '10%', right: '10%',
    height: 240, borderRadius: 200, backgroundColor: 'rgba(198,161,91,0.14)',
  },

  safe: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 24, paddingBottom: 10 },
  content: { flex: 1, justifyContent: 'center' },

  title: {
    fontSize: 23, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 12,
  },
  body: {
    fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.72,
    textAlign: 'center', lineHeight: 21, marginBottom: 22, paddingHorizontal: 4,
  },

  chartCard: {
    backgroundColor: CARD_CREAM,
    borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER,
    paddingVertical: 18, paddingHorizontal: 16,
    marginBottom: 18,
  },
  chartTitle: {
    fontSize: 13.5, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 19, marginBottom: 14,
  },
  legendRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 18, marginBottom: 14,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5, color: SPLASH_GREEN, opacity: 0.7 },

  chartRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    height: CHART_MAX_HEIGHT + 22,
  },
  dayColumn: { alignItems: 'center', flex: 1 },
  barsPair: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    height: CHART_MAX_HEIGHT, marginBottom: 6,
  },
  bar: { width: 7, borderRadius: 3 },
  barFixed: { backgroundColor: MUTED_BAR },
  barUnlimited: { backgroundColor: GOLD_DARK },
  dayLabel: { fontSize: 10, color: SPLASH_GREEN, opacity: 0.5 },

  caption: {
    fontSize: 13.5, color: SPLASH_GREEN, opacity: 0.68,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: 6,
  },

  ctaOuter: { width: '100%', paddingTop: 16 },
});
