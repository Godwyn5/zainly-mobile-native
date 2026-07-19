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
// Session/Revisions/Program/Ready (kept local, not exported from those
// files, to avoid touching them) ────────────────────────────────────────
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM    = '#8A744A';
const GOLD_DARK           = '#9F7628';
const CARD_CREAM         = '#FFFDF7';

// ─── the one card this screen tells the story through — three empty
// fields that fill in, one by one, each with its own discreet animation
// language, proving the programme is built FROM the answers to come. ────
const NIVEAU_VALUE   = 'Débutant';
const OBJECTIF_VALUE = 'Juz Amma';
const RYTHME_VALUE   = '3 ayats / jour';
const EMPTY_PLACEHOLDER = '—';

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

export default function OnboardingBuildScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [finished, setFinished]         = useState(false);

  const [niveauFilled, setNiveauFilled]     = useState(false);
  const [objectifFilled, setObjectifFilled] = useState(false);
  const [rythmeFilled, setRythmeFilled]     = useState(false);

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

  // ── title & subtitle — this screen pairs a "masque horizontal" title
  // with a "légère mise au point" subtitle, distinct from the adjacent
  // ready.tsx (rise title / glow subtitle). ────────────────────────────────
  const titleMaskWidth  = useRef(new Animated.Value(1)).current; // 1=covered, 0=revealed
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleScale    = useRef(new Animated.Value(1.06)).current;

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(16)).current;

  // ── the "Ton programme" card and its three fields, each filling in
  // with a distinct, discreet animation: reveal / slide / fade. ───────────
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardY        = useRef(new Animated.Value(14)).current;

  const niveauValueOpacity = useRef(new Animated.Value(0)).current;
  const niveauValueScale    = useRef(new Animated.Value(0.9)).current; // reveal
  const objectifValueOpacity = useRef(new Animated.Value(0)).current;
  const objectifValueX        = useRef(new Animated.Value(-12)).current; // slide
  const rythmeValueOpacity  = useRef(new Animated.Value(0)).current; // fade

  useEffect(() => {
    if (!draftChecked) return;

    if (reduceMotion) {
      titleMaskWidth.setValue(0);
      subtitleOpacity.setValue(0.68); subtitleScale.setValue(1);
      cardOpacity.setValue(1); cardY.setValue(0);
      setNiveauFilled(true); setObjectifFilled(true); setRythmeFilled(true);
      niveauValueOpacity.setValue(1); niveauValueScale.setValue(1);
      objectifValueOpacity.setValue(1); objectifValueX.setValue(0);
      rythmeValueOpacity.setValue(1);
      ctaOpacity.setValue(1); ctaY.setValue(0);
      finishScene();
      return;
    }

    schedule(() => runTitle(), 220);
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
        toValue: 1, duration: 260,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(cardY, {
        toValue: 0, duration: 260,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => fillNiveau(), 340));
  }

  // ── single main animation, in three discreet variants: each field
  // fills in with its own language (reveal / slide / fade). ───────────────
  function fillNiveau() {
    hapticLight();
    setNiveauFilled(true);
    Animated.parallel([
      Animated.timing(niveauValueOpacity, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(niveauValueScale, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => fillObjectif(), 280));
  }

  function fillObjectif() {
    hapticLight();
    setObjectifFilled(true);
    Animated.parallel([
      Animated.timing(objectifValueOpacity, {
        toValue: 1, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(objectifValueX, {
        toValue: 0, duration: 220,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => schedule(() => fillRythme(), 280));
  }

  function fillRythme() {
    hapticLight();
    setRythmeFilled(true);
    Animated.timing(rythmeValueOpacity, {
      toValue: 1, duration: 240,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => schedule(() => finishScene(), 220));
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
    router.push('/onboarding-v2/motivation');
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

  const titleMaskWidthPct = titleMaskWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

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
                Construisons ton programme.
              </Text>
              <Animated.View
                pointerEvents="none"
                style={[styles.titleMask, { width: titleMaskWidthPct }]}
              />
            </View>

            <Animated.Text
              style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ scale: subtitleScale }] }]}
            >
              Réponds à quelques questions. Zainly utilisera tes réponses pour créer un programme adapté à toi.
            </Animated.Text>

            <Animated.View
              style={[styles.card, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}
            >
              <Text style={styles.cardTitle}>Ton programme</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Niveau</Text>
                {niveauFilled ? (
                  <Animated.Text
                    style={[
                      styles.rowValue,
                      { opacity: niveauValueOpacity, transform: [{ scale: niveauValueScale }] },
                    ]}
                  >
                    {NIVEAU_VALUE}
                  </Animated.Text>
                ) : (
                  <Text style={styles.rowValuePlaceholder}>{EMPTY_PLACEHOLDER}</Text>
                )}
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Objectif</Text>
                {objectifFilled ? (
                  <Animated.Text
                    style={[
                      styles.rowValue,
                      { opacity: objectifValueOpacity, transform: [{ translateX: objectifValueX }] },
                    ]}
                  >
                    {OBJECTIF_VALUE}
                  </Animated.Text>
                ) : (
                  <Text style={styles.rowValuePlaceholder}>{EMPTY_PLACEHOLDER}</Text>
                )}
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Rythme</Text>
                {rythmeFilled ? (
                  <Animated.Text style={[styles.rowValue, { opacity: rythmeValueOpacity }]}>
                    {RYTHME_VALUE}
                  </Animated.Text>
                ) : (
                  <Text style={styles.rowValuePlaceholder}>{EMPTY_PLACEHOLDER}</Text>
                )}
              </View>
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
              accessibilityLabel="Créer mon programme"
              accessibilityState={{ disabled: !finished }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.ctaText}>Créer mon programme</Text>
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
    width: 250, borderRadius: 26, backgroundColor: CARD_CREAM,
    paddingVertical: 22, paddingHorizontal: 22,
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.07)',
    shadowColor: SPLASH_GREEN, shadowOpacity: 0.12, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 7,
  },
  cardTitle: {
    fontSize: 14, fontWeight: '700', color: SPLASH_GREEN, opacity: 0.55,
    letterSpacing: 0.4, marginBottom: 14,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: 'rgba(22,48,38,0.06)',
  },
  rowLabel: {
    fontSize: 13.5, fontWeight: '600', color: SPLASH_GREEN, opacity: 0.6,
  },
  rowValue: {
    fontSize: 14.5, fontWeight: '700', color: GOLD_DARK, textAlign: 'right',
  },
  rowValuePlaceholder: {
    fontSize: 14.5, fontWeight: '700', color: SPLASH_GREEN, opacity: 0.2, textAlign: 'right',
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
