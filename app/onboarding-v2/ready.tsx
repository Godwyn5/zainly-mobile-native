import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraft } from '@/lib/onboardingDraft';

// ─── palette — identical tokens to Splash/Welcome/Name/Greeting/
// Session/Revisions/Program (kept local, not exported from those files,
// to avoid touching them) ────────────────────────────────────────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK           = '#9F7628';
const CARD_CREAM         = '#FFFDF7';

// ─── the one card this screen tells the story through — three quiet
// checks that fold into a single, calm confirmation. ────────────────────
const CHECK_LINES = [
  'Séance prête',
  'Révisions organisées',
  'Progression suivie',
] as const;
const MERGED_LINE = 'Tout est prêt.';

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

export default function OnboardingReadyScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [finished, setFinished]         = useState(false);

  const mountedRef   = useRef(true);
  const timersRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const navigatedRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readOnboardingDraft().then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) {
        router.replace('/onboarding-v2/name');
        return;
      }
      setDraftChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  function schedule(fn: () => void, delay: number) {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }

  // ── living background — the exact same five independent breathing loops
  // as every previous narrative screen, so the space itself never feels
  // like it changed when this scene arrives. ──────────────────────────────
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

  // ── title & subtitle — this screen pairs a "montée douce" title with a
  // "révélation lumineuse" subtitle, distinct from the adjacent
  // program.tsx (focus title / rise subtitle). ────────────────────────────
  const titleOpacity    = useRef(new Animated.Value(0)).current;
  const titleY           = useRef(new Animated.Value(14)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleScale    = useRef(new Animated.Value(0.94)).current;

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(16)).current;

  // ── the card and its checklist → single confirmation choreography ──────
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardY        = useRef(new Animated.Value(14)).current;

  const line0Opacity = useRef(new Animated.Value(0)).current;
  const line0Y         = useRef(new Animated.Value(8)).current;
  const line1Opacity = useRef(new Animated.Value(0)).current;
  const line1Y         = useRef(new Animated.Value(8)).current;
  const line2Opacity = useRef(new Animated.Value(0)).current;
  const line2Y         = useRef(new Animated.Value(8)).current;

  const linesGroupOpacity = useRef(new Animated.Value(1)).current;
  const mergedOpacity      = useRef(new Animated.Value(0)).current;
  const mergedScale         = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      subtitleOpacity.setValue(0.68); subtitleScale.setValue(1);
      cardOpacity.setValue(1); cardY.setValue(0);
      linesGroupOpacity.setValue(0);
      mergedOpacity.setValue(1); mergedScale.setValue(1);
      ctaOpacity.setValue(1); ctaY.setValue(0);
      finishScene();
      return;
    }

    schedule(() => runTitle(), 220);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  function runTitle() {
    Animated.parallel([
      Animated.timing(titleOpacity, {
        toValue: 1, duration: 240,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(titleY, {
        toValue: 0, duration: 240,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => runSubtitle(), 180));
  }

  // Family A — "révélation lumineuse": the subtitle blooms into place via
  // opacity + a soft scale-down-to-rest, with no vertical motion at all. ──
  function runSubtitle() {
    Animated.parallel([
      Animated.timing(subtitleOpacity, {
        toValue: 0.68, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(subtitleScale, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => runCard(), 200));
  }

  function runCard() {
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1, duration: 260,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(cardY, {
        toValue: 0, duration: 260,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => revealLine0(), 160));
  }

  function revealLine(opacity: Animated.Value, y: Animated.Value, onDone: () => void) {
    hapticLight();
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 200,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(y, {
        toValue: 0, duration: 200,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(onDone);
  }

  function revealLine0() {
    revealLine(line0Opacity, line0Y, () => schedule(() => revealLine1(), 150));
  }
  function revealLine1() {
    revealLine(line1Opacity, line1Y, () => schedule(() => revealLine2(), 150));
  }
  function revealLine2() {
    revealLine(line2Opacity, line2Y, () => schedule(() => mergeLines(), 380));
  }

  // ── the single main animation this screen is built around: the three
  // checks quietly fold into one calm confirmation. ───────────────────────
  function mergeLines() {
    Animated.timing(linesGroupOpacity, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      hapticLight();
      Animated.parallel([
        Animated.timing(mergedOpacity, {
          toValue: 1, duration: 360,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.spring(mergedScale, {
          toValue: 1, useNativeDriver: true, speed: 14, bounciness: 5,
        }),
      ]).start(() => schedule(() => finishScene(), 220));
    });
  }

  function finishScene() {
    if (!mountedRef.current) return;
    setFinished(true);
    Animated.parallel([
      Animated.timing(ctaOpacity, {
        toValue: 1, duration: reduceMotion ? 260 : 420,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(ctaY, {
        toValue: 0, duration: reduceMotion ? 260 : 420,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
  }

  function navigateNext() {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    hapticLight();
    router.push('/onboarding-v2/build');
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

          <View style={styles.content}>

            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              Concentre-toi sur ton Hifz.
            </Animated.Text>

            <Animated.Text
              style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ scale: subtitleScale }] }]}
            >
              Zainly s'occupe de préparer tes séances, d'organiser tes révisions et de suivre ta progression.
            </Animated.Text>

            <Animated.View
              style={[styles.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}
            >
              <Animated.View style={[styles.checklist, { opacity: linesGroupOpacity }]}>
                <Animated.View
                  style={[styles.checkRow, { opacity: line0Opacity, transform: [{ translateY: line0Y }] }]}
                >
                  <Text style={styles.checkMark}>✓</Text>
                  <Text style={styles.checkLabel}>{CHECK_LINES[0]}</Text>
                </Animated.View>
                <Animated.View
                  style={[styles.checkRow, { opacity: line1Opacity, transform: [{ translateY: line1Y }] }]}
                >
                  <Text style={styles.checkMark}>✓</Text>
                  <Text style={styles.checkLabel}>{CHECK_LINES[1]}</Text>
                </Animated.View>
                <Animated.View
                  style={[styles.checkRow, { opacity: line2Opacity, transform: [{ translateY: line2Y }] }]}
                >
                  <Text style={styles.checkMark}>✓</Text>
                  <Text style={styles.checkLabel}>{CHECK_LINES[2]}</Text>
                </Animated.View>
              </Animated.View>

              <Animated.View
                style={[
                  styles.mergedRow,
                  { opacity: mergedOpacity, transform: [{ scale: mergedScale }] },
                ]}
              >
                <Text style={styles.mergedCheckMark}>✓</Text>
                <Text style={styles.mergedLabel}>{MERGED_LINE}</Text>
              </Animated.View>
            </Animated.View>

          </View>

          <Animated.View
            style={[
              styles.ctaOuter,
              { opacity: ctaOpacity, transform: reduceMotion ? [] : [{ translateY: ctaY }] },
            ]}
            pointerEvents={finished ? 'auto' : 'none'}
          >
            <TouchableOpacity
              onPress={navigateNext}
              activeOpacity={0.88}
              style={styles.cta}
              accessibilityRole="button"
              accessibilityLabel="Continuer"
              accessibilityState={{ disabled: !finished }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.ctaText}>Continuer</Text>
            </TouchableOpacity>
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
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 14,
  },
  subtitle: {
    fontSize: 15.5, color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 23, paddingHorizontal: 8, marginBottom: 34,
  },

  card: {
    width: 250, minHeight: 138, borderRadius: 26, backgroundColor: CARD_CREAM,
    paddingVertical: 22, paddingHorizontal: 22,
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.07)',
    shadowColor: SPLASH_GREEN, shadowOpacity: 0.12, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 7,
    justifyContent: 'center',
  },
  checklist: {
    position: 'absolute', top: 22, left: 22, right: 22,
  },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 7,
  },
  checkMark: {
    fontSize: 14, fontWeight: '700', color: GOLD_DARK, marginRight: 10, width: 16,
  },
  checkLabel: {
    fontSize: 14.5, fontWeight: '600', color: SPLASH_GREEN,
  },

  mergedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  mergedCheckMark: {
    fontSize: 20, fontWeight: '700', color: GOLD_DARK, marginRight: 10,
  },
  mergedLabel: {
    fontSize: 18, fontWeight: '700', color: SPLASH_GREEN,
  },

  ctaOuter: {
    width: '100%',
  },
  cta: {
    backgroundColor: GOLD_DARK,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: GOLD_DARK,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 8,
  },
  ctaText: {
    color: SPLASH_BEIGE,
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
