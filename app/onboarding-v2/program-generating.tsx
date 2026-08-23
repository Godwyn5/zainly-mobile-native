import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, BackHandler,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticSelection, hapticSuccess } from '@/utils/haptics';
import { readOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import { computePlan, isPlanError } from '@/core/planEngine';
import {
  buildPlanInputFromDraft, isPlanValidationError, routeForOnboardingStep,
  PENDING_SIGNUP_USER_ID,
} from '@/lib/onboardingPlanValidation';
import { PROGRAM_SUMMARY_BACK_TARGET } from '@/lib/onboardingQuestionnaire';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';
const GOLD_DARK    = '#9F7628';
const CARD_CREAM   = '#FFFDF7';
const CARD_BORDER  = 'rgba(22,48,38,0.10)';

const STEPS = [
  'Analyse de tes réponses',
  'Organisation de ton parcours',
  'Préparation de tes révisions',
  'Création de ta première séance',
];

const STEP_DURATION_MS = 1150; // 4 steps × 1150ms ≈ 4.6s — within the 4–6s window.
const REDUCE_MOTION_TOTAL_MS = 500;

type ScreenState = 'generating' | 'error';

// ─── program-generating — this screen REALLY computes the plan (pure
// computePlan(), no Supabase write yet — persistence needs the real userId
// that only exists post-signup, see src/lib/onboardingFinalize.ts). The
// animated steps are decorative pacing around a computation that already
// finished; nothing here is a "fake program". No back button — a resumed
// generation has nothing meaningful to resume into. ─────────────────────────
export default function OnboardingProgramGeneratingScreen() {
  const [state, setState] = useState<ScreenState>('generating');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(0);
  const mountedRef = useRef(true);
  const planReadyRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // Block Android hardware back — there is nothing safe to resume into
  // mid-generation.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // ── real validation + real computation, run once ──────────────────────
  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    (async () => {
      const draft = await readOnboardingDraftForOwner(draftOwner);
      if (cancelled) return;
      if (!draft) {
        router.replace('/onboarding-v2/experience-choice');
        return;
      }

      const validation = buildPlanInputFromDraft(draft, PENDING_SIGNUP_USER_ID);
      if (isPlanValidationError(validation)) {
        router.replace(routeForOnboardingStep(validation.missingStep));
        return;
      }

      const result = computePlan(validation.planInput);
      if (isPlanError(result)) {
        if (!cancelled) setState('error');
        return;
      }

      planReadyRef.current = true;
    })();
    return () => { cancelled = true; };

  }, [draftOwner]);

  // ── decorative pacing around the already-finished computation ─────────
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    if (reduceMotion) {
      const timer = setTimeout(() => {
        if (cancelled || !mountedRef.current) return;
        setCompletedSteps(STEPS.length);
        progress.setValue(1);
        if (state === 'generating') router.replace('/onboarding-v2/program-summary');
      }, REDUCE_MOTION_TOTAL_MS);
      return () => { cancelled = true; clearTimeout(timer); };
    }

    Animated.timing(progress, {
      toValue: 1, duration: STEP_DURATION_MS * STEPS.length,
      easing: Easing.linear, useNativeDriver: false,
    }).start();

    const timers = STEPS.map((_, i) => setTimeout(() => {
      if (cancelled || !mountedRef.current) return;
      hapticSelection();
      setCompletedSteps(i + 1);
      if (i === STEPS.length - 1) {
        hapticSuccess();
        setTimeout(() => {
          if (!cancelled && mountedRef.current && state === 'generating') {
            router.replace('/onboarding-v2/program-summary');
          }
        }, 260);
      }
    }, STEP_DURATION_MS * (i + 1)));

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, state]);

  function handleRetryBack() {
    router.replace(PROGRAM_SUMMARY_BACK_TARGET);
  }

  if (state === 'error') {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
        <SafeAreaView style={styles.safe}>
          <View style={styles.errorShell}>
            <Text style={styles.errorTitle}>Impossible de préparer ton programme</Text>
            <Text style={styles.errorBody}>
              Une de tes réponses ne permet pas de créer un programme pour le moment.
            </Text>
            <View style={styles.errorCtaOuter}>
              <OnboardingBottomAction label="Revenir" onPress={handleRetryBack} />
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>
          <Text style={styles.title}>Création de ton programme</Text>

          <View style={styles.ringOuter}>
            <View style={styles.ringInner}>
              <Text style={styles.ringPercent}>
                {Math.round((completedSteps / STEPS.length) * 100)}%
              </Text>
            </View>
          </View>

          <View style={styles.track}>
            <Animated.View style={[styles.trackFill, { width: fillWidth }]} />
          </View>

          <View style={styles.stepsList}>
            {STEPS.map((label, i) => {
              const done = completedSteps > i;
              return (
                <View key={label} style={styles.stepRow}>
                  <View style={[styles.stepDot, done && styles.stepDotDone]}>
                    {done && <Text style={styles.stepCheck}>✓</Text>}
                  </View>
                  <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BEIGE },
  safe: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' },

  title: {
    fontSize: 20, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', marginBottom: 32,
  },

  ringOuter: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 6, borderColor: 'rgba(22,48,38,0.10)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28,
  },
  ringInner: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: CARD_CREAM, borderWidth: 1, borderColor: CARD_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  ringPercent: { fontSize: 22, fontWeight: '800', color: GOLD_DARK },

  track: {
    width: '100%', height: 4, borderRadius: 2,
    backgroundColor: 'rgba(22,48,38,0.10)', overflow: 'hidden',
    marginBottom: 32,
  },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: GOLD_DARK },

  stepsList: { width: '100%', gap: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { borderColor: GOLD_DARK, backgroundColor: GOLD_DARK },
  stepCheck: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  stepLabel: { fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.5 },
  stepLabelDone: { opacity: 0.9, fontWeight: '600' },

  errorShell: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  errorTitle: {
    fontSize: 19, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', marginBottom: 10,
  },
  errorBody: {
    fontSize: 14, color: SPLASH_GREEN, opacity: 0.65,
    textAlign: 'center', lineHeight: 20, marginBottom: 28,
  },
  errorCtaOuter: { width: '100%' },
});
