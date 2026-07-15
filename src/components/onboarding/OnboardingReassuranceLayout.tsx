import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, StatusBar, AccessibilityInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OnboardingQuestionHeader from './OnboardingQuestionHeader';
import OnboardingBottomAction from './OnboardingBottomAction';

// ─── palette — identical tokens to the rest of Onboarding V2 ──────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK           = '#9F7628';

interface OnboardingReassuranceLayoutProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  title: string;
  body: string;
  ctaLabel: string;
  onContinue: () => void;
}

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

/**
 * Shared composition for every reassurance screen of the questionnaire:
 * same background language as the rest of Onboarding V2, the common
 * header (back + progress), a discreet abstract graphic detail, a
 * progressive title → body reveal, and the bottom CTA appearing only once
 * the message has landed. Screens only ever provide their text and
 * navigation — never their own background/animation plumbing.
 */
export default function OnboardingReassuranceLayout({
  currentStep, totalSteps, onBack, title, body, ctaLabel, onContinue,
}: OnboardingReassuranceLayoutProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── living background — same breathing loops as every other v2 screen ──
  const washBreath  = useRef(new Animated.Value(0)).current;
  const glowPulse    = useRef(new Animated.Value(0)).current;
  const lightDrift   = useRef(new Animated.Value(0)).current;
  const motifBreathA = useRef(new Animated.Value(0)).current;
  const motifBreathB = useRef(new Animated.Value(0)).current;

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

  // ── emotional reveal — title, then abstract detail, then body, then CTA ──
  const titleOpacity  = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(14)).current;
  const glyphOpacity  = useRef(new Animated.Value(0)).current;
  const glyphScale    = useRef(new Animated.Value(0.86)).current;
  const bodyOpacity   = useRef(new Animated.Value(0)).current;
  const bodyY         = useRef(new Animated.Value(10)).current;
  const ctaOpacity    = useRef(new Animated.Value(0)).current;
  const ctaY          = useRef(new Animated.Value(14)).current;
  const [ctaReady, setCtaReady] = useState(false);

  // Re-run the whole reveal whenever the message changes (title acts as the
  // natural content key — a new motivationReason/learningMode means a
  // brand new title) so a modified answer is never left showing stale text
  // mid-animation.
  useEffect(() => {
    titleOpacity.setValue(0); titleY.setValue(14);
    glyphOpacity.setValue(0); glyphScale.setValue(0.86);
    bodyOpacity.setValue(0); bodyY.setValue(10);
    ctaOpacity.setValue(0); ctaY.setValue(14);
    setCtaReady(false);

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      glyphOpacity.setValue(1); glyphScale.setValue(1);
      bodyOpacity.setValue(1); bodyY.setValue(0);
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
      Animated.parallel([
        Animated.timing(glyphOpacity, { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
        Animated.timing(glyphScale,   { toValue: 1, duration: 260, easing: E, useNativeDriver: true }),
        Animated.timing(bodyOpacity,  { toValue: 1, duration: 280, delay: 60, easing: E, useNativeDriver: true }),
        Animated.timing(bodyY,        { toValue: 0, duration: 280, delay: 60, easing: E, useNativeDriver: true }),
      ]),
    ]).start(() => {
      if (!mountedRef.current) return;
      setCtaReady(true);
      Animated.parallel([
        Animated.timing(ctaOpacity, { toValue: 1, duration: 300, easing: E, useNativeDriver: true }),
        Animated.timing(ctaY,       { toValue: 0, duration: 300, easing: E, useNativeDriver: true }),
      ]).start();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, reduceMotion]);

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
            currentStep={currentStep}
            totalSteps={totalSteps}
            onBack={onBack}
          />

          <View style={styles.content}>
            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              {title}
            </Animated.Text>

            <Animated.View
              style={[styles.glyphWrap, { opacity: glyphOpacity, transform: [{ scale: glyphScale }] }]}
            >
              <View style={styles.glyphLine} />
              <View style={styles.glyphDot} />
              <View style={styles.glyphLine} />
            </Animated.View>

            <Animated.Text
              style={[styles.body, { opacity: bodyOpacity, transform: [{ translateY: bodyY }] }]}
            >
              {body}
            </Animated.Text>
          </View>

          <Animated.View
            style={[styles.ctaOuter, { opacity: ctaOpacity, transform: [{ translateY: ctaY }] }]}
            pointerEvents={ctaReady ? 'auto' : 'none'}
          >
            <OnboardingBottomAction label={ctaLabel} onPress={onContinue} />
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
    paddingHorizontal: 28,
    paddingBottom: 10,
  },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30,
  },

  glyphWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 20,
  },
  glyphLine: {
    width: 28, height: 1, backgroundColor: GOLD_DARK, opacity: 0.4,
  },
  glyphDot: {
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD_DARK,
    marginHorizontal: 8,
  },

  body: {
    fontSize: 15.5, color: SPLASH_GREEN, opacity: 0.72,
    textAlign: 'center', lineHeight: 23, paddingHorizontal: 6,
  },

  ctaOuter: { width: '100%', paddingTop: 16 },
});
