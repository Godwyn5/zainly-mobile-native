import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraftForOwner, updateOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import { getNotificationPermissionStatus, requestNotificationPermission, PermissionStatus } from '@/notifications/scheduler';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber,
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
// direct tap on "Activer mes rappels", never on mount. If permission is
// already granted, this screen still renders — with a short confirmation
// version (no system prompt, no Activer/Plus tard buttons) so the user
// always sees this step instead of being silently skipped. Uses the real,
// already-existing expo-notifications wrapper (src/notifications/scheduler.ts)
// — no new notification system, no push token, no scheduling here
// (scheduling needs a real userId and only happens post-signup, from
// onboardingFinalize.ts).
export default function OnboardingNotificationsScreen() {
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

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
    (async () => {
      const draft = await readOnboardingDraftForOwner(draftOwner);
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

      const status = await getNotificationPermissionStatus();
      if (cancelled) return;
      setPermissionStatus(status);
      setReady(true);
    })();
    return () => { cancelled = true; };

  }, [draftOwner]);

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
    router.replace('/onboarding-v2/known-surahs');
  }

  async function handleActivate() {
    if (isSubmittingRef.current || !draftOwner) return;
    isSubmittingRef.current = true;
    setBusy(true);
    hapticLight();
    try {
      const status = await requestNotificationPermission();
      await updateOnboardingDraftForOwner(draftOwner, {
        notificationPreference: status === 'granted' ? 'enabled' : 'denied',
        currentStep: 'program_generating',
      });
      router.push('/onboarding-v2/program-generating');
    } finally {
      setBusy(false);
      isSubmittingRef.current = false;
    }
  }

  async function handleContinueAlreadyGranted() {
    if (isSubmittingRef.current || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraftForOwner(draftOwner, {
        notificationPreference: 'already_granted',
        currentStep: 'program_generating',
      });
      router.push('/onboarding-v2/program-generating');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function handleContinueDenied() {
    if (isSubmittingRef.current || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraftForOwner(draftOwner, {
        notificationPreference: 'denied',
        currentStep: 'program_generating',
      });
      router.push('/onboarding-v2/program-generating');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function handleLater() {
    if (isSubmittingRef.current || !draftOwner) return;
    isSubmittingRef.current = true;
    hapticLight();
    try {
      await updateOnboardingDraftForOwner(draftOwner, {
        notificationPreference: 'skipped',
        currentStep: 'program_generating',
      });
      router.push('/onboarding-v2/program-generating');
    } finally {
      isSubmittingRef.current = false;
    }
  }

  if (!ready) {
    return <View style={styles.root} />;
  }

  const washScale = washBreath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  const isGranted = permissionStatus === 'granted';
  const isDenied = permissionStatus === 'denied';

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
              {isGranted
                ? 'Tes rappels sont prêts.'
                : isDenied
                ? 'Continue à avancer à ton rythme.'
                : 'Avance chaque jour dans ton Hifz.'}
            </Animated.Text>

            <Animated.Text style={[styles.body, { opacity: bodyOpacity }]}>
              {isGranted
                ? 'Zainly pourra te prévenir lorsque ta séance du jour sera prête pour t\'aider à garder un rythme régulier.'
                : isDenied
                ? 'Les rappels sont désactivés sur ce téléphone, mais ton programme restera accessible chaque jour dans Zainly.'
                : 'Active tes rappels pour recevoir ta séance au bon moment et garder un rythme régulier, même les jours chargés.'}
            </Animated.Text>

            <Animated.View style={[styles.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>
              <Animated.View style={[styles.notificationCard, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>
                <View style={styles.notificationHeader}>
                  <View style={styles.zainlyBadge}>
                    <View style={styles.zainlyBadgeDot} />
                    <Text style={styles.zainlyBadgeText}>Zainly</Text>
                  </View>
                  <Text style={styles.notificationTime}>maintenant</Text>
                </View>
                <Text style={styles.notificationTitle}>Ta séance du jour est prête</Text>
                <Text style={styles.notificationBody}>Quelques minutes suffisent pour avancer aujourd'hui.</Text>
              </Animated.View>
            </Animated.View>
          </View>

          <View style={styles.actions}>
            {isGranted ? (
              <OnboardingBottomAction
                label="Continuer"
                onPress={handleContinueAlreadyGranted}
              />
            ) : isDenied ? (
              <OnboardingBottomAction
                label="Continuer sans rappels"
                onPress={handleContinueDenied}
              />
            ) : (
              <>
                <OnboardingBottomAction
                  label={busy ? 'Activation…' : 'Activer mes rappels'}
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
    width: '100%', maxWidth: 320,
    alignItems: 'center', justifyContent: 'center',
  },
  notificationCard: {
    width: '100%',
    backgroundColor: CARD_CREAM,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    shadowColor: GOLD_DARK,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  zainlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zainlyBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD_DARK,
  },
  zainlyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: SPLASH_GREEN,
    letterSpacing: 0.2,
  },
  notificationTime: {
    fontSize: 11,
    color: SPLASH_GREEN,
    opacity: 0.5,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: SPLASH_GREEN,
    marginBottom: 4,
    lineHeight: 20,
  },
  notificationBody: {
    fontSize: 13,
    color: SPLASH_GREEN,
    opacity: 0.75,
    lineHeight: 18,
  },

  actions: { width: '100%', paddingTop: 16, gap: 14 },
  laterBtn: { alignItems: 'center', paddingVertical: 6 },
  laterText: { fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.55, fontWeight: '600' },
});
