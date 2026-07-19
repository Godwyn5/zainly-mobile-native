import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight, hapticSelection } from '@/utils/haptics';
import { readOnboardingDraft } from '@/lib/onboardingDraft';

// ─── palette — identical tokens to Splash/Welcome/Name/Greeting/Overview
// (kept local, not exported from those files, to avoid touching them) ──────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK           = '#9F7628';
const CARD_CREAM         = '#FFFDF7';

const CARD_BLOCKS = [
  { icon: '\u{1F4D6}', label: 'Nouveaux versets' },
  { icon: '\u{1F501}', label: 'Révision' },
  { icon: '\u{23F1}\uFE0F', label: 'Temps estimé' },
] as const;

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

export default function OnboardingSessionScreen() {
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
  function skipAllTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  // ── living background — the exact same five independent breathing loops
  // as Greeting, so the space itself never feels like it changed
  // when this scene arrives. ───────────────────────────────────────────────
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

  // ── title & subtitle — each screen in the narrative sequence uses a
  // different entrance family (see animation audit); this screen pairs a
  // "masque horizontal" title with a "mise au point" subtitle. ──────────
  const titleMaskWidth  = useRef(new Animated.Value(1)).current; // 1=covered, 0=revealed
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleScale    = useRef(new Animated.Value(1.06)).current;

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(16)).current;

  // ── the one story this screen tells: today's session, already prepared,
  // filling in one line at a time — the only animation that matters here. ─
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardY        = useRef(new Animated.Value(14)).current;
  const cardTitleOpacity = useRef(new Animated.Value(0)).current;
  const block0Opacity = useRef(new Animated.Value(0)).current;
  const block0Y        = useRef(new Animated.Value(10)).current;
  const block1Opacity = useRef(new Animated.Value(0)).current;
  const block1Y        = useRef(new Animated.Value(10)).current;
  const block2Opacity = useRef(new Animated.Value(0)).current;
  const block2Y        = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleMaskWidth.setValue(0);
      subtitleOpacity.setValue(0.68); subtitleScale.setValue(1);
      cardOpacity.setValue(1); cardY.setValue(0);
      cardTitleOpacity.setValue(1);
      block0Opacity.setValue(1); block0Y.setValue(0);
      block1Opacity.setValue(1); block1Y.setValue(0);
      block2Opacity.setValue(1); block2Y.setValue(0);
      ctaOpacity.setValue(1); ctaY.setValue(0);
      finishScene();
      return;
    }

    schedule(() => runTitle(), 260);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, reduceMotion]);

  // Family D — "masque horizontal": the title is already fully opaque; a
  // beige mask shrinks away from the left, progressively unveiling it. ────
  function runTitle() {
    Animated.timing(titleMaskWidth, {
      toValue: 0, duration: 240,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start(() => schedule(() => runSubtitle(), 180));
  }

  // Family E — "légère mise au point": the subtitle settles from a
  // slightly-too-large, softer state into its exact resting size. ─────────
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
        toValue: 1, duration: 280,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(cardY, {
        toValue: 0, duration: 280,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => {
      Animated.timing(cardTitleOpacity, {
        toValue: 1, duration: 200,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(() => schedule(() => buildBlock0(), 160));
    });
  }

  function buildBlock0() {
    hapticSelection();
    Animated.parallel([
      Animated.timing(block0Opacity, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(block0Y, {
        toValue: 0, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => buildBlock1(), 180));
  }

  function buildBlock1() {
    hapticSelection();
    Animated.parallel([
      Animated.timing(block1Opacity, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(block1Y, {
        toValue: 0, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => buildBlock2(), 180));
  }

  function buildBlock2() {
    hapticSelection();
    Animated.parallel([
      Animated.timing(block2Opacity, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(block2Y, {
        toValue: 0, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => finishScene(), 250));
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
    router.push('/onboarding-v2/revisions');
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

          <View style={styles.titleMaskWrap}>
            <Text style={styles.title}>
              Chaque jour, Zainly prépare ta séance.
            </Text>
            <Animated.View
              pointerEvents="none"
              style={[styles.titleMask, { width: titleMaskWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            />
          </View>

          <Animated.Text
            style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ scale: subtitleScale }] }]}
          >
            Zainly choisit automatiquement ce que tu dois mémoriser et ce que tu dois réviser.
          </Animated.Text>

          <Animated.View
            style={[styles.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}
          >
            <Animated.Text style={[styles.cardTitle, { opacity: cardTitleOpacity }]}>
              Aujourd'hui
            </Animated.Text>

            <Animated.View
              style={[styles.block, { opacity: block0Opacity, transform: [{ translateY: block0Y }] }]}
            >
              <Text style={styles.blockIcon}>{CARD_BLOCKS[0].icon}</Text>
              <Text style={styles.blockLabel}>{CARD_BLOCKS[0].label}</Text>
            </Animated.View>

            <Animated.View
              style={[styles.block, { opacity: block1Opacity, transform: [{ translateY: block1Y }] }]}
            >
              <Text style={styles.blockIcon}>{CARD_BLOCKS[1].icon}</Text>
              <Text style={styles.blockLabel}>{CARD_BLOCKS[1].label}</Text>
            </Animated.View>

            <Animated.View
              style={[styles.block, { opacity: block2Opacity, transform: [{ translateY: block2Y }] }]}
            >
              <Text style={styles.blockIcon}>{CARD_BLOCKS[2].icon}</Text>
              <Text style={styles.blockLabel}>{CARD_BLOCKS[2].label}</Text>
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
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },

  titleMaskWrap: {
    position: 'relative', alignSelf: 'stretch',
    marginBottom: 14,
  },
  titleMask: {
    position: 'absolute', top: 0, bottom: 0, right: 0,
    backgroundColor: SPLASH_BEIGE,
  },
  title: {
    fontSize: 22, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30,
  },
  subtitle: {
    fontSize: 15.5, color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 23, paddingHorizontal: 8, marginBottom: 34,
  },

  card: {
    width: 240, borderRadius: 26, backgroundColor: CARD_CREAM,
    paddingVertical: 22, paddingHorizontal: 22,
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.07)',
    shadowColor: SPLASH_GREEN, shadowOpacity: 0.12, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 7,
  },
  cardTitle: {
    fontSize: 14, fontWeight: '700', color: SPLASH_GREEN, opacity: 0.55,
    letterSpacing: 0.4, marginBottom: 14,
  },
  block: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: 'rgba(22,48,38,0.06)',
  },
  blockIcon: { fontSize: 16, marginRight: 10, width: 22, textAlign: 'center' },
  blockLabel: { fontSize: 14.5, fontWeight: '600', color: SPLASH_GREEN },

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
