import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight, hapticSelection } from '@/utils/haptics';
import { readOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';

// ─── palette — identical tokens to Splash/Welcome/Name (kept local, not
// exported from app/index.tsx, to avoid touching that file) ────────────────
const SPLASH_BEIGE          = '#F7F2E7';
const SPLASH_BEIGE_EDGE     = '#EDE3CC';
const SPLASH_GREEN          = '#163026';
const SPLASH_GREEN_FAINT    = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM       = '#8A744A';
const GOLD_DARK              = '#9F7628';

// ─── typewriter rhythm — one single, perfectly regular cadence for the
// whole scene. Never varies, so the ear/finger never feels a jump. ─────────
const CHAR_INTERVAL = 36; // ms between the appearance of two consecutive characters

// ─── natural pauses between narrative beats (ms) — the name gets its own
// dedicated beat, isolated from the greeting line, so it can land as the
// scene's focal point rather than as the tail of a sentence. ──────────────
const T_FIRST_START          = 300; // living background → first character
const PAUSE_AFTER_GREETING   = 400; // "As-salāmu ʿalaykum," → prénom
const PAUSE_AFTER_NAME       = 600; // prénom (focal beat) → invocation
const PAUSE_AFTER_INVOCATION = 500; // invocation → transition text
const PAUSE_AFTER_TRANSITION = 350; // transition text → CTA

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

interface TypeSegment {
  text: string;
  style?: any;
}

interface TypewriterBlockProps {
  segments: TypeSegment[];
  active: boolean;
  reduceMotion: boolean;
  onCharTick?: () => void;
  onDone?: () => void;
  containerStyle?: any;
  rowStyle?: any;
}

/**
 * Real typewriter: characters appear one by one by revealing a growing prefix
 * of each segment. Already-written characters stay immediately visible.
 * Under Reduce Motion, the whole block is shown with one simple fade instead,
 * and no per-character ticks are produced.
 */
function TypewriterBlock({
  segments, active, reduceMotion, onCharTick, onDone, containerStyle,
  rowStyle: _rowStyle,
}: TypewriterBlockProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const fadeAll = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const totalChars = useMemo(
    () => segments.reduce((acc, seg) => acc + Array.from(seg.text).length, 0),
    [segments]
  );

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;

    if (reduceMotion) {
      setVisibleCount(totalChars);
      Animated.timing(fadeAll, {
        toValue: 1, duration: 320,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(() => onDone?.());
      return;
    }

    if (totalChars === 0) { onDone?.(); return; }

    const schedule = (remaining: number) => {
      const id = setTimeout(() => {
        onCharTick?.();
        setVisibleCount(prev => prev + 1);
        if (remaining > 1) {
          schedule(remaining - 1);
        } else {
          onDone?.();
        }
      }, CHAR_INTERVAL);
      timeoutsRef.current.push(id);
    };

    schedule(totalChars);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, totalChars, reduceMotion]);

  useEffect(() => () => { timeoutsRef.current.forEach(clearTimeout); }, []);

  if (reduceMotion) {
    return (
      <Animated.Text style={{ opacity: fadeAll }}>
        {segments.map((s, i) => <Text key={i} style={s.style}>{s.text}</Text>)}
      </Animated.Text>
    );
  }

  let written = 0;
  return (
    <View style={containerStyle}>
      {segments.map((seg, i) => {
        const chars = Array.from(seg.text);
        const segLen = chars.length;
        const visible = Math.max(0, Math.min(visibleCount - written, segLen));
        written += segLen;
        return (
          <Text key={i} style={seg.style}>
            {chars.slice(0, visible).join('')}
          </Text>
        );
      })}
    </View>
  );
}

export default function OnboardingGreetingScreen() {
  const [firstName, setFirstName]       = useState<string | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [greetingActive, setGreetingActive]     = useState(false);
  const [nameActive, setNameActive]             = useState(false);
  const [invocationActive, setInvocationActive] = useState(false);
  const [transitionActive, setTransitionActive] = useState(false);
  const [writingDone, setWritingDone]           = useState(false); // CTA gate

  const mountedRef = useRef(true);
  const timersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(16)).current;

  // ── ambient, ever-living background — five independent slow breathing
  // loops, all opacity/transform only (native driver), each with its own
  // period so nothing ever feels mechanically synchronized. Runs from the
  // moment the scene mounts, entirely independent of the writing timeline —
  // the background is alive before a single letter appears and stays that
  // way through every pause. Disabled entirely under Reduce Motion. ───────
  const washBreath   = useRef(new Animated.Value(0)).current; // wash + vignette
  const glowPulse     = useRef(new Animated.Value(0)).current; // ambient gold light
  const lightDrift    = useRef(new Animated.Value(0)).current; // slow gold light drift (parallax feel)
  const motifBreathA  = useRef(new Animated.Value(0)).current;
  const motifBreathB  = useRef(new Animated.Value(0)).current;
  const ambientLoopsRef = useRef<Animated.CompositeAnimation[]>([]);

  // ── reduce motion detection ──
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  // ── living background loops — start on mount, stop on unmount ──
  useEffect(() => {
    if (reduceMotion) return;
    const loops = [
      ambientBreath(washBreath, 5600),
      ambientBreath(glowPulse, 3800),
      ambientBreath(lightDrift, 9200),
      ambientBreath(motifBreathA, 6400),
      ambientBreath(motifBreathB, 7400, 900),
    ];
    ambientLoopsRef.current = loops;
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // ── read firstName from the existing draft — never write to it ──
  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) {
        // Defensive only: this screen has nothing to greet without a name.
        router.replace('/onboarding-v2/name');
        return;
      }
      setFirstName(draft.firstName);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  // ── scene start ──
  useEffect(() => {
    if (!draftChecked) return;
    const id = setTimeout(() => setGreetingActive(true), T_FIRST_START);
    timersRef.current.push(id);
    return () => clearTimeout(id);
  }, [draftChecked]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  // ── chained hand-offs — each phase starts only once the previous one has
  // fully finished writing, after a natural pause. Never overlaps. ────────
  function handleGreetingDone() {
    const id = setTimeout(() => setNameActive(true), PAUSE_AFTER_GREETING);
    timersRef.current.push(id);
  }
  function handleNameDone() {
    const id = setTimeout(() => setInvocationActive(true), PAUSE_AFTER_NAME);
    timersRef.current.push(id);
  }
  function handleInvocationDone() {
    const id = setTimeout(() => setTransitionActive(true), PAUSE_AFTER_INVOCATION);
    timersRef.current.push(id);
  }
  function handleTransitionDone() {
    const id = setTimeout(() => setWritingDone(true), PAUSE_AFTER_TRANSITION);
    timersRef.current.push(id);
  }

  // ── CTA reveal — only once every character of the scene is done ──
  useEffect(() => {
    if (!writingDone) return;
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
  }, [writingDone, reduceMotion, ctaOpacity, ctaY]);

  // ── the only haptic tied to every character — the most subtle discrete
  // tick available (selection feedback), never an impact "bump" ──────────
  function handleCharTick() {
    hapticSelection();
  }

  function handleContinue() {
    hapticLight();
    router.push('/onboarding-v2/session');
  }

  if (!draftChecked || !firstName) {
    return <View style={styles.root} />;
  }

  const greetingSegments: TypeSegment[] = [
    { text: 'As-salāmu ʿalaykum,', style: styles.greetingText },
  ];
  const nameSegments: TypeSegment[] = [
    { text: `${firstName}.`, style: styles.nameText },
  ];
  const invocationSegments: TypeSegment[] = [
    { text: "Qu'Allah facilite ton Hifz\net le rende durable.", style: styles.invocationText },
  ];
  const transitionSegments: TypeSegment[] = [
    {
      text: "Avant de préparer ton programme,\nlaisse-nous te montrer\ncomment Zainly va t'accompagner.",
      style: styles.transitionText,
    },
  ];

  // ── ambient background interpolations — derived from the five breathing
  // drivers above; at rest (Reduce Motion) they simply hold their input=0
  // value, which is itself already a calm, non-jarring baseline. ──────────
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
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

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
            transform: [
              { translateX: glowDriftX }, { translateY: glowDriftY }, { scale: glowScale },
            ],
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
            <TypewriterBlock
              segments={greetingSegments}
              active={greetingActive}
              reduceMotion={reduceMotion}
              onCharTick={handleCharTick}
              onDone={handleGreetingDone}
              containerStyle={styles.greetingBlock}
              rowStyle={styles.revealRow}
            />

            <View style={styles.nameWrap}>
              <TypewriterBlock
                segments={nameSegments}
                active={nameActive}
                reduceMotion={reduceMotion}
                onCharTick={handleCharTick}
                onDone={handleNameDone}
                containerStyle={styles.nameBlock}
                rowStyle={styles.revealRow}
              />
            </View>

            <TypewriterBlock
              segments={invocationSegments}
              active={invocationActive}
              reduceMotion={reduceMotion}
              onCharTick={handleCharTick}
              onDone={handleInvocationDone}
              containerStyle={styles.invocationWrap}
              rowStyle={styles.revealRow}
            />

            <TypewriterBlock
              segments={transitionSegments}
              active={transitionActive}
              reduceMotion={reduceMotion}
              onCharTick={handleCharTick}
              onDone={handleTransitionDone}
              containerStyle={styles.transitionWrap}
              rowStyle={styles.revealRow}
            />
          </View>

          <Animated.View
            style={[
              styles.ctaOuter,
              { opacity: ctaOpacity, transform: reduceMotion ? [] : [{ translateY: ctaY }] },
            ]}
            pointerEvents={writingDone ? 'auto' : 'none'}
          >
            <TouchableOpacity
              onPress={handleContinue}
              activeOpacity={0.88}
              style={styles.cta}
              accessibilityRole="button"
              accessibilityLabel="Continuer"
              accessibilityState={{ disabled: !writingDone }}
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
  ambientGlow: {
    position: 'absolute',
    top: '30%', left: '10%', right: '10%',
    height: 260,
    borderRadius: 200,
    backgroundColor: 'rgba(198,161,91,0.16)',
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

  revealRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },

  greetingBlock: {
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  greetingText: {
    fontSize: 20,
    fontWeight: '500',
    color: SPLASH_GREEN,
    opacity: 0.82,
    lineHeight: 27,
    textAlign: 'center',
    letterSpacing: 0.1,
  },

  nameWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 34,
    paddingVertical: 6,
  },
  nameBlock: {
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  nameText: {
    fontSize: 44,
    fontWeight: '800',
    color: GOLD_DARK,
    lineHeight: 52,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  invocationWrap: {
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 30,
  },
  invocationText: {
    fontSize: 17,
    fontStyle: 'italic',
    color: SPLASH_GREEN,
    opacity: 0.76,
    lineHeight: 26,
    textAlign: 'center',
  },

  transitionWrap: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  transitionText: {
    fontSize: 14,
    color: SPLASH_GREEN,
    opacity: 0.55,
    lineHeight: 22,
    textAlign: 'center',
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
