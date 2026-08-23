import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight } from '@/utils/haptics';
import { readOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';

// ─── palette — identical tokens to Splash/Welcome/Name/Greeting/
// Session (kept local, not exported from those files, to avoid touching
// them) ──────────────────────────────────────────────────────────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK           = '#9F7628';
const GOLD               = '#C6A15B';
const CARD_CREAM         = '#FFFDF7';

const MILESTONES = ['Aujourd\'hui', 'J+1', 'J+3', 'J+7'] as const;

/** A slow, symmetric 0→1→0 breathing loop — the single primitive behind
 *  every ambient background motion on this screen (glow, wash, motifs).
 *  Kept native-driver friendly: only ever feeds opacity/transform. */
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

export default function OnboardingRevisionsScreen() {
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
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  function schedule(fn: () => void, delay: number) {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }

  // ── living background — the exact same five independent breathing loops
  // as Greeting/Session, so the space itself never feels like it
  // changed when this scene arrives. ─────────────────────────────────────
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

  // ── title & subtitle — this screen pairs a "révélation lumineuse" title
  // with a "masque horizontal" subtitle, distinct from the adjacent
  // session.tsx (mask title / focus subtitle) and program.tsx. ───────────
  const titleOpacity    = useRef(new Animated.Value(0)).current;
  const titleScale       = useRef(new Animated.Value(0.94)).current;
  const subtitleMaskWidth = useRef(new Animated.Value(1)).current; // 1=covered, 0=revealed

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(16)).current;

  // ── the one story this screen tells: the same ayah, already memorised,
  // coming back on a short timeline — the only animation that matters. ────
  const cardOpacity   = useRef(new Animated.Value(0)).current;
  const cardY          = useRef(new Animated.Value(14)).current;
  const cardPulseScale = useRef(new Animated.Value(1)).current;

  const lineWidth = useRef(new Animated.Value(0)).current; // 0→1, non-native (width)

  const dot0Opacity = useRef(new Animated.Value(0)).current;
  const dot0Scale    = useRef(new Animated.Value(0.6)).current;
  const dot1Opacity = useRef(new Animated.Value(0)).current;
  const dot1Scale    = useRef(new Animated.Value(0.6)).current;
  const dot2Opacity = useRef(new Animated.Value(0)).current;
  const dot2Scale    = useRef(new Animated.Value(0.6)).current;
  const dot3Opacity = useRef(new Animated.Value(0)).current;
  const dot3Scale    = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleOpacity.setValue(1); titleScale.setValue(1);
      subtitleMaskWidth.setValue(0);
      cardOpacity.setValue(1); cardY.setValue(0);
      lineWidth.setValue(1);
      dot0Opacity.setValue(1); dot0Scale.setValue(1);
      dot1Opacity.setValue(1); dot1Scale.setValue(1);
      dot2Opacity.setValue(1); dot2Scale.setValue(1);
      dot3Opacity.setValue(1); dot3Scale.setValue(1);
      ctaOpacity.setValue(1); ctaY.setValue(0);
      finishScene();
      return;
    }

    schedule(() => runTitle(), 220);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  // Family A — "révélation lumineuse": the title blooms into place via
  // opacity + a soft scale-down-to-rest, with no vertical motion at all. ──
  function runTitle() {
    Animated.parallel([
      Animated.timing(titleOpacity, {
        toValue: 1, duration: 240,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(titleScale, {
        toValue: 1, duration: 240,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => runSubtitle(), 180));
  }

  // Family D — "masque horizontal": the subtitle is already fully opaque;
  // a beige mask shrinks away from the left, progressively unveiling it. ──
  function runSubtitle() {
    Animated.timing(subtitleMaskWidth, {
      toValue: 0, duration: 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start(() => schedule(() => runCard(), 200));
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
    ]).start(() => schedule(() => drawTimeline(), 150));
  }

  // ── single main animation: the timeline draws itself left → right ──────
  function drawTimeline() {
    Animated.timing(lineWidth, {
      toValue: 1, duration: 420,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start(() => schedule(() => revealDot0(), 90));
  }

  function pulseCard() {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(cardPulseScale, {
        toValue: 1.045, duration: 140,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(cardPulseScale, {
        toValue: 1, duration: 160,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
  }

  function revealDot(opacity: Animated.Value, scale: Animated.Value, onDone: () => void) {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 200,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6,
      }),
    ]).start(onDone);
  }

  // first milestone — the only "beat" beat that gets a haptic besides the last
  function revealDot0() {
    hapticLight();
    pulseCard();
    revealDot(dot0Opacity, dot0Scale, () => schedule(() => revealDot1(), 130));
  }
  function revealDot1() {
    pulseCard();
    revealDot(dot1Opacity, dot1Scale, () => schedule(() => revealDot2(), 130));
  }
  function revealDot2() {
    pulseCard();
    revealDot(dot2Opacity, dot2Scale, () => schedule(() => revealDot3(), 130));
  }
  // last milestone — the second and final haptic of this scene
  function revealDot3() {
    hapticLight();
    pulseCard();
    revealDot(dot3Opacity, dot3Scale, () => schedule(() => finishScene(), 200));
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
    router.push('/onboarding-v2/program');
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

  const lineWidthPct = lineWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

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
              style={[styles.title, { opacity: titleOpacity, transform: [{ scale: titleScale }] }]}
            >
              Zainly organise aussi tes révisions.
            </Animated.Text>

            <View style={styles.subtitleMaskWrap}>
              <Text style={styles.subtitle}>
                Les ayats à revoir reviennent dans tes séances au moment où tu en as besoin.
              </Text>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.subtitleMask,
                  { width: subtitleMaskWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                ]}
              />
            </View>

            <View
              style={styles.illustrationStage}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Animated.View
                style={[
                  styles.ayahCard,
                  {
                    opacity: cardOpacity,
                    transform: [{ translateY: cardY }, { scale: cardPulseScale }],
                  },
                ]}
              >
                <Text style={styles.ayahCardLabel}>Ayat mémorisée</Text>
                <View style={styles.ayahLine} />
                <View style={[styles.ayahLine, { width: '62%' }]} />
              </Animated.View>

              <View style={styles.timelineTrack}>
                <View style={styles.timelineRail} />
                <Animated.View style={[styles.timelineFill, { width: lineWidthPct }]} />

                <View style={styles.timelineDots}>
                  {(
                    [
                      [dot0Opacity, dot0Scale],
                      [dot1Opacity, dot1Scale],
                      [dot2Opacity, dot2Scale],
                      [dot3Opacity, dot3Scale],
                    ] as const
                  ).map(([opacity, scale], i) => (
                    <View key={MILESTONES[i]} style={styles.timelineStep}>
                      <Animated.View
                        style={[
                          styles.timelineDot,
                          { opacity, transform: [{ scale }] },
                        ]}
                      >
                        <View style={styles.timelineDotCheck} />
                      </Animated.View>
                      <Animated.Text
                        style={[styles.timelineLabel, { opacity }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {MILESTONES[i]}
                      </Animated.Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

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
  subtitleMaskWrap: {
    position: 'relative', alignSelf: 'stretch', marginBottom: 36,
  },
  subtitleMask: {
    position: 'absolute', top: 0, bottom: 0, right: 0,
    backgroundColor: SPLASH_BEIGE,
  },
  subtitle: {
    fontSize: 15.5, color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 23, paddingHorizontal: 8,
  },

  illustrationStage: {
    width: '100%', alignItems: 'center',
  },
  ayahCard: {
    width: 210, borderRadius: 22, backgroundColor: CARD_CREAM,
    paddingVertical: 16, paddingHorizontal: 20,
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.07)',
    shadowColor: SPLASH_GREEN, shadowOpacity: 0.12, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
    marginBottom: 30,
  },
  ayahCardLabel: {
    fontSize: 12.5, fontWeight: '700', color: GOLD_DARK,
    letterSpacing: 0.4, marginBottom: 10,
  },
  ayahLine: {
    height: 6, borderRadius: 3, width: '90%',
    backgroundColor: 'rgba(22,48,38,0.10)', marginBottom: 6,
  },

  timelineTrack: {
    width: '100%',
    paddingHorizontal: 6,
  },
  timelineRail: {
    position: 'absolute', top: 9, left: 6, right: 6, height: 2,
    borderRadius: 1, backgroundColor: 'rgba(22,48,38,0.10)',
  },
  timelineFill: {
    position: 'absolute', top: 9, left: 6, height: 2,
    borderRadius: 1, backgroundColor: GOLD,
  },
  timelineDots: {
    flexDirection: 'row',
  },
  timelineStep: {
    flex: 1, alignItems: 'center', paddingHorizontal: 2,
  },
  timelineDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: GOLD_DARK,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  timelineDotCheck: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: CARD_CREAM,
  },
  timelineLabel: {
    fontSize: 12, fontWeight: '600', color: SPLASH_GREEN, opacity: 0.7,
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
