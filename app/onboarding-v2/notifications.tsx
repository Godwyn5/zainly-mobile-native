import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraft, updateOnboardingDraft, ExperienceChoice } from '@/lib/onboardingDraft';
import { getNotificationPermissionStatus, requestNotificationPermission } from '@/notifications/scheduler';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, notificationsBackTarget,
} from '@/lib/onboardingQuestionnaire';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const GOLD_DARK          = '#9F7628';
const CARD_CREAM         = '#FFFDF7';
const CARD_BORDER        = 'rgba(22,48,38,0.10)';

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

// ─── notifications — the OS permission prompt must only ever fire from a
// direct tap on "Activer les rappels", never on mount. If permission is
// already granted, this screen still renders — with a short confirmation
// version (no system prompt, no Activer/Plus tard buttons) so the user
// always sees this step instead of being silently skipped. Uses the real,
// already-existing expo-notifications wrapper (src/notifications/scheduler.ts)
// — no new notification system, no push token, no scheduling here
// (scheduling needs a real userId and only happens post-signup, from
// onboardingFinalize.ts).
export default function OnboardingNotificationsScreen() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [experienceChoice, setExperienceChoice] = useState<ExperienceChoice | null>(null);
  const [alreadyGranted, setAlreadyGranted] = useState(false);
  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await readOnboardingDraft();
      if (cancelled) return;
      if (!draft?.experienceChoice) {
        router.replace('/onboarding-v2/experience-choice');
        return;
      }
      setExperienceChoice(draft.experienceChoice);

      const status = await getNotificationPermissionStatus();
      if (cancelled) return;
      setAlreadyGranted(status === 'granted');
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── entrance ──
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(12)).current;
  const bodyOpacity   = useRef(new Animated.Value(0)).current;
  const cardOpacity   = useRef(new Animated.Value(0)).current;
  const cardY         = useRef(new Animated.Value(10)).current;
  const washBreath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ready) return;
    if (!reduceMotion) ambientBreath(washBreath, 5600).start();

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      bodyOpacity.setValue(1);
      cardOpacity.setValue(1); cardY.setValue(0);
      return;
    }
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 280, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 280, easing: E, useNativeDriver: true }),
      Animated.timing(bodyOpacity,  { toValue: 1, duration: 260, delay: 90, easing: E, useNativeDriver: true }),
      Animated.timing(cardOpacity,  { toValue: 1, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
      Animated.timing(cardY,        { toValue: 0, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduceMotion]);

  function handleBack() {
    router.replace(notificationsBackTarget(experienceChoice));
  }

  async function handleActivate() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    hapticLight();
    try {
      const status = await requestNotificationPermission();
      await updateOnboardingDraft({
        notificationPreference: status === 'granted' ? 'enabled' : 'denied',
        currentStep: 'discovery_source',
      });
      router.push('/onboarding-v2/discovery-source');
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  }

  async function handleContinueAlreadyGranted() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraft({
        notificationPreference: 'already_granted',
        currentStep: 'discovery_source',
      });
      router.push('/onboarding-v2/discovery-source');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function handleLater() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraft({
        notificationPreference: 'skipped',
        currentStep: 'discovery_source',
      });
      router.push('/onboarding-v2/discovery-source');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (!ready) {
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
            currentStep={phaseStepNumber('notifications')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />

          <View style={styles.content}>
            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              {alreadyGranted
                ? 'Tes rappels sont déjà activés.'
                : 'Ne laisse pas ton Hifz dépendre de ta motivation.'}
            </Animated.Text>

            <Animated.Text style={[styles.body, { opacity: bodyOpacity }]}>
              {alreadyGranted
                ? 'Zainly pourra te rappeler ta séance au bon moment pour t’aider à rester régulier.'
                : 'Zainly peut te rappeler ta séance au bon moment pour t’aider à rester régulier.'}
            </Animated.Text>

            <Animated.View style={[styles.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>
              <View style={styles.bellGlyph}>
                <View style={styles.bellDot} />
              </View>
            </Animated.View>
          </View>

          <View style={styles.actions}>
            {alreadyGranted ? (
              <OnboardingBottomAction
                label="Continuer"
                onPress={handleContinueAlreadyGranted}
              />
            ) : (
              <>
                <OnboardingBottomAction
                  label={busy ? 'Activation…' : 'Activer les rappels'}
                  disabled={busy}
                  onPress={handleActivate}
                />
                <TouchableOpacity
                  onPress={handleLater}
                  disabled={busy}
                  style={styles.laterBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Plus tard"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.laterText}>Plus tard</Text>
                </TouchableOpacity>
              </>
            )}
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
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 12,
  },
  body: {
    fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.68,
    textAlign: 'center', lineHeight: 21, marginBottom: 26, paddingHorizontal: 8,
  },

  card: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: CARD_CREAM, borderWidth: 1, borderColor: CARD_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  bellGlyph: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: GOLD_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  bellDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD_DARK },

  actions: { width: '100%', paddingTop: 16, gap: 14 },
  laterBtn: { alignItems: 'center', paddingVertical: 6 },
  laterText: { fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.55, fontWeight: '600' },
});
