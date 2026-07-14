import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, Platform, KeyboardAvoidingView,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { hapticLight } from '@/utils/haptics';
import {
  readOnboardingDraft, updateOnboardingDraft,
  normalizeFirstName, isValidFirstName,
} from '@/lib/onboardingDraft';

// ─── palette — same identity as Splash/Welcome (kept local, not exported
// from app/index.tsx, to avoid touching that file beyond its CTA target) ──
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_BEIGE_EDGE  = '#EDE3CC';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const GOLD_DARK          = '#9F7628';
const SPLASH_GOLD_DIM    = '#8A744A';

const CTA_INACTIVE_BG   = 'rgba(22,48,38,0.10)';
const CTA_INACTIVE_TEXT = 'rgba(22,48,38,0.42)';
const INPUT_BORDER      = 'rgba(22,48,38,0.16)';

export default function OnboardingNameScreen() {
  const { session, ready } = useAuthStore();

  const [firstName, setFirstName]       = useState('');
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const isSubmittingRef = useRef(false);
  const wasValidRef      = useRef(false);
  const mountedRef       = useRef(true);

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

  // ── already-connected users keep the current app behaviour ──
  // ── resume: prefill firstName, or skip ahead if a later step is pending ──
  useEffect(() => {
    if (!ready) return;
    if (session) { router.replace('/(app)/(tabs)'); return; }

    let cancelled = false;
    readOnboardingDraft().then(draft => {
      if (cancelled) return;
      if (draft?.currentStep === 'greeting') {
        router.replace('/onboarding-v2/greeting');
        return;
      }
      if (draft?.firstName) setFirstName(draft.firstName);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };
  }, [ready, session]);

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

  async function handleContinue() {
    if (isSubmittingRef.current) return;
    const normalized = normalizeFirstName(firstName);
    if (!isValidFirstName(normalized)) return;

    isSubmittingRef.current = true;
    hapticLight();

    await updateOnboardingDraft({ currentStep: 'greeting', firstName: normalized });
    router.replace('/onboarding-v2/greeting');
  }

  // ── avoid flashing an empty field before the draft check resolves ──
  if (!ready || !draftChecked) {
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
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

      <View pointerEvents="none" style={styles.wash} />
      <View pointerEvents="none" style={styles.vignetteTop} />
      <View pointerEvents="none" style={styles.vignetteBottom} />
      <View pointerEvents="none" style={styles.motifLineA} />
      <View pointerEvents="none" style={styles.motifLineB} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.shell}>

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
        </SafeAreaView>
      </KeyboardAvoidingView>
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
    paddingBottom: 10,
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
