import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, Platform, KeyboardAvoidingView,
  AccessibilityInfo, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { usePlan } from '@/hooks/usePlan';
import { hapticLight } from '@/utils/haptics';
import {
  readOnboardingDraftForOwner, updateOnboardingDraftForOwner, clearOnboardingDraftForOwner,
  normalizeFirstName, isValidFirstName,
} from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';

// ─── palette — same identity as Splash/Welcome (kept local, not exported
// from app/index.tsx, to avoid touching that file beyond its CTA target) ──
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const GOLD_DARK          = '#9F7628';
const SPLASH_GOLD_DIM    = '#8A744A';

const CTA_INACTIVE_BG   = 'rgba(22,48,38,0.10)';
const CTA_INACTIVE_TEXT = 'rgba(22,48,38,0.42)';
const INPUT_BORDER      = 'rgba(22,48,38,0.16)';

export default function OnboardingNameScreen() {
  const { session, ready } = useAuthStore();
  const userId = session?.user?.id;
  const { data: existingPlan, isLoading: planLoading } = usePlan(userId);

  const [firstName, setFirstName]       = useState('');
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const isSubmittingRef = useRef(false);
  const wasValidRef      = useRef(false);
  const mountedRef       = useRef(true);
  const backLockedRef    = useRef(false);
  const insets           = useSafeAreaInsets();

  // ── entrance animation values ──
  const titleOpacity  = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(10)).current;
  const fieldOpacity  = useRef(new Animated.Value(0)).current;
  const fieldY        = useRef(new Animated.Value(8)).current;
  const ctaActive     = useRef(new Animated.Value(0)).current; // 0=invalid,1=valid — drives colour
  const ctaBump       = useRef(new Animated.Value(1)).current; // discrete micro-scale on validity gain

  const isValid = isValidFirstName(firstName);

  // ── reduce motion detection ──
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── keyboard layout synchronization (iOS) ──
  // KeyboardAvoidingView updates padding via state, which triggers an
  // instant layout pass. Without synchronization, the button jumps while
  // the keyboard is still animating. Keyboard.scheduleLayoutAnimation
  // configures the native layout system to animate the next layout change
  // using the keyboard's own duration and easing curve, so the button
  // rises and descends in perfect sync with the keyboard.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
      Keyboard.scheduleLayoutAnimation(e);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', (e) => {
      Keyboard.scheduleLayoutAnimation(e);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // ── plan-exists guard: redirect authenticated users who already have a ──
  // ── plan back to the dashboard. The plan query (usePlan) is the same ─────
  // ── authoritative source the dashboard uses. While planLoading is true ──
  // ── (state still indeterminate), no irreversible decision is taken — ─────
  // ── the screen renders its loading state and waits. ──────────────────────
  useEffect(() => {
    if (!ready || !userId) return;
    if (planLoading) return;
    if (existingPlan) {
      clearOnboardingDraftForOwner({ kind: 'authenticated', userId }).catch(() => {});
      router.replace('/(app)/(tabs)');
    }
  }, [ready, userId, existingPlan, planLoading]);

  // ── Compute the draft owner based on auth state ──
  // Authenticated users own their draft by userId. Guests use a guest
  // owner with a real flowId from getOrCreateGuestFlowId — never empty.
  const { owner: draftOwner } = useDraftOwner();

  // ── resume: prefill firstName from a previous session ──
  // This screen never auto-skips to a later step. The central router
  // decides which onboarding step to show; the name screen only handles
  // name entry and restoration.
  useEffect(() => {
    if (!ready) return;
    if (!draftOwner) return; // guest flowId not yet resolved
    // Don't proceed with draft resume until the plan-exists guard has had
    // a chance to run for authenticated users.
    if (userId && planLoading) return;

    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (draft?.firstName) setFirstName(draft.firstName);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };
  }, [ready, userId, planLoading, draftOwner]);

  // ── entrance choreography — runs once the draft check has resolved ──
  useEffect(() => {
    if (!draftChecked) return;
    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      fieldOpacity.setValue(1); fieldY.setValue(0);
      return;
    }
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 280, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 280, easing: E, useNativeDriver: true }),
      Animated.timing(fieldOpacity, { toValue: 1, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(fieldY,       { toValue: 0, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked]);

  // ── CTA activation — colour transition + single haptic on invalid→valid ──
  useEffect(() => {
    Animated.timing(ctaActive, {
      toValue: isValid ? 1 : 0, duration: 200,
      easing: Easing.out(Easing.quad), useNativeDriver: false,
    }).start();

    if (isValid && !wasValidRef.current) {
      hapticLight();
      if (!reduceMotion) {
        Animated.sequence([
          Animated.spring(ctaBump, { toValue: 1.04, useNativeDriver: true, speed: 20, bounciness: 4 }),
          Animated.spring(ctaBump, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 4 }),
        ]).start();
      }
    }
    wasValidRef.current = isValid;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid]);

  function handleBack() {
    if (backLockedRef.current) return;
    backLockedRef.current = true;
    hapticLight();
    // Persist the current firstName so the draft resume logic can restore
    // it when the user returns. If the field is empty, persist null so a
    // stale old name is not restored on re-entry.
    if (draftOwner) {
      const trimmed = firstName.trim();
      updateOnboardingDraftForOwner(draftOwner, { firstName: trimmed || null }).catch(() => {});
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/welcome');
    }
    setTimeout(() => { backLockedRef.current = false; }, 600);
  }

  async function handleContinue() {
    if (isSubmittingRef.current) return;
    if (!draftOwner) return;
    const normalized = normalizeFirstName(firstName);
    if (!isValidFirstName(normalized)) return;

    isSubmittingRef.current = true;
    hapticLight();

    await updateOnboardingDraftForOwner(draftOwner, { currentStep: 'greeting', firstName: normalized });
    router.replace('/onboarding-v2/greeting');
  }

  // ── avoid flashing an empty field before the draft check resolves ──
  // ── also wait for plan query if authenticated (plan-exists guard) ──────
  if (!ready || !draftChecked || !draftOwner || (userId && planLoading)) {
    return <View style={styles.root} />;
  }

  const ctaBg = ctaActive.interpolate({
    inputRange: [0, 1],
    outputRange: [CTA_INACTIVE_BG, GOLD_DARK],
  });
  const ctaTextColor = ctaActive.interpolate({
    inputRange: [0, 1],
    outputRange: [CTA_INACTIVE_TEXT, SPLASH_BEIGE],
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />

      <View pointerEvents="none" style={styles.wash} />
      <View pointerEvents="none" style={styles.vignetteTop} />
      <View pointerEvents="none" style={styles.vignetteBottom} />
      <View pointerEvents="none" style={styles.motifLineA} />
      <View pointerEvents="none" style={styles.motifLineB} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.shell, { paddingBottom: insets.bottom + 10 }]}>

            <TouchableOpacity
              onPress={handleBack}
              activeOpacity={0.6}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Retour à l'écran de bienvenue"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.backChevron}>‹</Text>
            </TouchableOpacity>

            <View style={styles.content}>
              <Animated.Text
                style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
              >
                Comment t'appelles-tu ?
              </Animated.Text>

              <Animated.View
                style={[styles.fieldWrap, { opacity: fieldOpacity, transform: [{ translateY: fieldY }] }]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Ton prénom"
                  placeholderTextColor={CTA_INACTIVE_TEXT}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={50}
                  returnKeyType="done"
                  onSubmitEditing={handleContinue}
                  accessibilityLabel="Champ prénom, requis"
                />
              </Animated.View>
            </View>

            <Animated.View style={[styles.ctaOuter, { transform: [{ scale: ctaBump }] }]}>
              <TouchableOpacity
                disabled={!isValid}
                onPress={handleContinue}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isValid }}
                accessibilityLabel={isValid ? 'Continuer' : 'Continuer, désactivé'}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Animated.View style={[styles.cta, { backgroundColor: ctaBg }]}>
                  <Animated.Text style={[styles.ctaText, { color: ctaTextColor }]}>
                    Continuer
                  </Animated.Text>
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>

          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },
  wash: {
    position: 'absolute',
    top: -140, left: -90, right: -90,
    height: 640,
    borderRadius: 420,
    backgroundColor: SPLASH_BEIGE,
  },
  vignetteTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 90,
    backgroundColor: SPLASH_GREEN_FAINT,
  },
  vignetteBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 110,
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

  safe: { flex: 1 },
  shell: {
    flex: 1,
    paddingHorizontal: 28,
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: -10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backChevron: {
    fontSize: 26,
    fontWeight: '600',
    color: SPLASH_GREEN,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: SPLASH_GREEN,
    lineHeight: 36,
    marginBottom: 20,
  },
  fieldWrap: {
    width: '100%',
  },
  input: {
    fontSize: 18,
    color: SPLASH_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: INPUT_BORDER,
  },

  ctaOuter: {
    width: '100%',
  },
  cta: {
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
