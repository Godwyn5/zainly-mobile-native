import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_300Light,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  Amiri_400Regular,
  Amiri_700Bold,
} from '@expo-google-fonts/amiri';
import {
  Cinzel_500Medium,
  Cinzel_600SemiBold,
} from '@expo-google-fonts/cinzel';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { hapticLight, hapticMedium } from '@/utils/haptics';

// ─── design tokens — luxury watch palette ───────────────────────────────────
const BG           = '#031A12';
const BG_MID       = '#041F16';
const IVORY        = '#F8F4EA';
const GOLD         = '#C6A15B';
const GOLD_DARK    = '#9F7628';
const MUTED        = '#CFC7B8';
const BORDER       = 'rgba(248,244,234,0.20)';

// ─── splash-only design tokens — warm beige / deep green / gold accent ─────
const SPLASH_BEIGE          = '#F7F2E7';
const SPLASH_BEIGE_EDGE     = '#EDE3CC';
const SPLASH_GREEN          = '#163026';
const SPLASH_GREEN_FAINT    = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM       = '#8A744A';
const SPLASH_GOLD_GLOW_SOFT = 'rgba(198,161,91,0.14)';
const SPLASH_HADITH_INK     = '#0F2318';
const SPLASH_SOURCE_INK     = '#3E5B4C';

// ─── font family names ───────────────────────────────────────────────────────
const F_BRAND        = 'Cinzel_500Medium';
const F_BRAND_SB     = 'Cinzel_600SemiBold';
const F_DISPLAY_BOLD = 'CormorantGaramond_700Bold';
const F_DISPLAY_LIGHT = 'CormorantGaramond_300Light';
const F_DISPLAY      = 'CormorantGaramond_600SemiBold';
const F_ARABIC       = 'Amiri_700Bold';
const F_ARABIC_R     = 'Amiri_400Regular';

// ─── hadith ─────────────────────────────────────────────────────────────────
const HADITH = '\u00ABLes meilleurs d\u2019entre vous sont ceux\nqui apprennent le Coran et l\u2019enseignent.\u00BB';
const HADITH_SOURCE = 'Sahih al-Bukhari 5027';

type Phase = 'splash' | 'welcome';

export default function EntryScreen() {
  const { session, ready } = useAuthStore();
  const [phase, setPhase] = useState<Phase>('splash');
  const [animDone, setAnimDone] = useState(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_300Light,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    Amiri_400Regular,
    Amiri_700Bold,
    Cinzel_500Medium,
    Cinzel_600SemiBold,
  });

  // ─── splash animation values ─────────────────────────────────────────────
  const bgOpacity      = useRef(new Animated.Value(0)).current;
  const patternOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity    = useRef(new Animated.Value(0)).current;
  const glowScale      = useRef(new Animated.Value(0.7)).current;
  const arabicReveal   = useRef(new Animated.Value(0)).current;
  const sweepX         = useRef(new Animated.Value(0)).current;
  const breatheLoop    = useRef<Animated.CompositeAnimation | null>(null);
  const lineOpacity    = useRef(new Animated.Value(0)).current;
  const brandOpacity   = useRef(new Animated.Value(0)).current;
  const hadithOpacity  = useRef(new Animated.Value(0)).current;
  const hadithY        = useRef(new Animated.Value(10)).current;
  const sourceOpacity  = useRef(new Animated.Value(0)).current;

  // ─── welcome animation values ────────────────────────────────────────────
  const wLogoOpacity   = useRef(new Animated.Value(0)).current;
  const wHeroOpacity   = useRef(new Animated.Value(0)).current;
  const wHeroY         = useRef(new Animated.Value(16)).current;
  const wBtnsOpacity   = useRef(new Animated.Value(0)).current;
  const wBtnsY         = useRef(new Animated.Value(12)).current;
  const wHadithOpacity = useRef(new Animated.Value(0)).current;
  const wHadithY       = useRef(new Animated.Value(10)).current;
  const wSourceOpacity = useRef(new Animated.Value(0)).current;

  // ─── Splash sequence (runs once fonts are ready) ─────────────────────────
  // Overlapping choreography, not a strict sequence: the background + faint
  // geometric texture settle in first, a discreet golden glow blooms behind
  // the mark and progressively "reveals" it (opacity + colour interpolation —
  // no fade, no zoom on the glyph itself), the mark holds alone for a beat,
  // then the gold filet, the Latin wordmark and finally the hadith arrive —
  // each starting before the previous one has fully settled. Total elapsed
  // time before setAnimDone stays close to the previous sequential timing.
  useEffect(() => {
    if (!fontsLoaded) return;

    const hapticTimer = setTimeout(() => hapticLight(), 900);

    Animated.parallel([
      // 1. background wash + faint geometric texture
      Animated.timing(bgOpacity, {
        toValue: 1, duration: 420, delay: 0,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(patternOpacity, {
        toValue: 1, duration: 500, delay: 60,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // 2. discreet golden glow blooms behind the mark
      Animated.timing(glowOpacity, {
        toValue: 1, duration: 600, delay: 150,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(glowScale, {
        toValue: 1, duration: 600, delay: 150,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      // 3. the glow reveals the arabic mark — opacity + colour only
      Animated.timing(arabicReveal, {
        toValue: 1, duration: 600, delay: 300,
        easing: Easing.out(Easing.quad), useNativeDriver: false,
      }),
      Animated.timing(sweepX, {
        toValue: 1, duration: 700, delay: 300,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // 4. mark holds alone briefly, then 5. gold filet draws in
      Animated.timing(lineOpacity, {
        toValue: 1, duration: 250, delay: 1250,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // 6. "Zainly" wordmark settles in
      Animated.timing(brandOpacity, {
        toValue: 1, duration: 350, delay: 1450,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // 7. hadith, then its source, last of all
      Animated.timing(hadithOpacity, {
        toValue: 1, duration: 480, delay: 1800,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(hadithY, {
        toValue: 0, duration: 480, delay: 1800,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(sourceOpacity, {
        toValue: 1, duration: 320, delay: 1980,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]).start(() => {
      setAnimDone(true);
      // very low-amplitude breathing loop for the halo — stopped once the
      // splash phase is left (see cleanup effect below).
      breatheLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glowScale, {
            toValue: 1.04, duration: 2600,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(glowScale, {
            toValue: 1.0, duration: 2600,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ]),
      );
      breatheLoop.current.start();
    });

    return () => clearTimeout(hapticTimer);
  }, [fontsLoaded]);

  // stop the ambient breathing loop once the splash phase is left — pure
  // animation hygiene, does not affect the redirect/session gate below.
  useEffect(() => {
    if (phase !== 'splash') breatheLoop.current?.stop();
  }, [phase]);

  // ─── Gate: wait for both animDone + auth ready ───────────────────────────
  useEffect(() => {
    if (!animDone || !ready) return;
    if (session) {
      router.replace('/(app)/(tabs)');
      return;
    }
    setPhase('welcome');
  }, [animDone, ready, session]);

  // ─── Welcome sequence ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'welcome') return;
    Animated.sequence([
      // brand lockup at top
      Animated.timing(wLogoOpacity, {
        toValue: 1, duration: 300,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // headline block
      Animated.parallel([
        Animated.timing(wHeroOpacity, {
          toValue: 1, duration: 420,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(wHeroY, {
          toValue: 0, duration: 420,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // buttons
      Animated.parallel([
        Animated.timing(wBtnsOpacity, {
          toValue: 1, duration: 360,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(wBtnsY, {
          toValue: 0, duration: 360,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // hadith in lower area
      Animated.parallel([
        Animated.timing(wHadithOpacity, {
          toValue: 1, duration: 440,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(wHadithY, {
          toValue: 0, duration: 440,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // source
      Animated.sequence([
        Animated.delay(140),
        Animated.timing(wSourceOpacity, {
          toValue: 1, duration: 300,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [phase]);

  // ─── Loading guard — show nothing while fonts load ───────────────────────
  if (!fontsLoaded) {
    return <View style={styles.splashRoot}><StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} /></View>;
  }

  // ─── SPLASH ──────────────────────────────────────────────────────────────
  if (phase === 'splash') {
    // derived interpolations — computed only for this branch, not hooks
    const arabicOpacity = arabicReveal.interpolate({ inputRange: [0, 1], outputRange: [0.05, 1] });
    const arabicColor   = arabicReveal.interpolate({ inputRange: [0, 1], outputRange: [SPLASH_GOLD_DIM, GOLD] });
    const sweepTranslate = sweepX.interpolate({ inputRange: [0, 1], outputRange: [-130, 130] });
    const brandY         = brandOpacity.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

    return (
      <View style={styles.splashRoot}>
        <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

        {/* ── background depth: soft radial wash + faint vignette ── */}
        <Animated.View pointerEvents="none" style={[styles.spWash, { opacity: bgOpacity }]} />
        <Animated.View pointerEvents="none" style={[styles.spVignetteTop, { opacity: bgOpacity }]} />
        <Animated.View pointerEvents="none" style={[styles.spVignetteBottom, { opacity: bgOpacity }]} />

        {/* ── barely-felt geometric corner motifs ── */}
        <Animated.View pointerEvents="none" style={[styles.spPattern, { opacity: patternOpacity }]}>
          <View style={styles.spMotifLineA} />
          <View style={styles.spMotifLineB} />
          <View style={styles.spMotifLineC} />
          <View style={styles.spMotifLineD} />
        </Animated.View>

        <View style={styles.splashCenter}>

          {/* logo lockup */}
          <View style={styles.lockup}>
            {/* breathing golden halo behind the mark */}
            <Animated.View
              pointerEvents="none"
              style={[styles.spHalo, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
            />
            {/* soft light sweep — the glow "revealing" the engraving */}
            <Animated.View
              pointerEvents="none"
              style={[styles.spSweep, { opacity: glowOpacity, transform: [{ translateX: sweepTranslate }] }]}
            />

            <Animated.Text style={[styles.splashArabic, { opacity: arabicOpacity, color: arabicColor }]}>
              زينلي
            </Animated.Text>
            <Animated.View style={[styles.goldLine, { opacity: lineOpacity, transform: [{ scaleX: lineOpacity }] }]} />
            <Animated.Text style={[styles.splashBrand, { opacity: brandOpacity, transform: [{ translateY: brandY }] }]}>
              Zainly
            </Animated.Text>
          </View>

          {/* hadith — quieter, discreet, last to arrive */}
          <Animated.View style={[
            styles.spHadithBlock,
            { opacity: hadithOpacity, transform: [{ translateY: hadithY }] },
          ]}>
            <Text style={styles.spHadithText}>{HADITH}</Text>
            <Animated.Text style={[styles.spHadithSource, { opacity: sourceOpacity }]}>
              {HADITH_SOURCE}
            </Animated.Text>
          </Animated.View>

        </View>
      </View>
    );
  }

  // ─── WELCOME ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} translucent={false} />

      <View style={styles.welcomeShell}>

        {/* brand lockup — top center */}
        <Animated.View style={[styles.topBrand, { opacity: wLogoOpacity }]}>
          <Text style={styles.topArabic}>زينلي</Text>
          <View style={styles.topDivider} />
          <Text style={styles.topBrandName}>Zainly</Text>
        </Animated.View>

        {/* headline + subtitle */}
        <Animated.View style={[
          styles.heroBlock,
          { opacity: wHeroOpacity, transform: [{ translateY: wHeroY }] },
        ]}>
          <Text style={styles.headline}>{'Ton Hifz,'}</Text>
          <Text style={styles.headlineLine2}>{'guidé chaque jour.'}</Text>
          <Text style={styles.subtitle}>
            {'Zainly te dit quoi mémoriser, quoi réviser,\net t\u2019aide à avancer avec constance.'}
          </Text>
        </Animated.View>

        <View style={styles.spacer} />

        {/* CTA buttons */}
        <Animated.View style={[
          styles.ctaBlock,
          { opacity: wBtnsOpacity, transform: [{ translateY: wBtnsY }] },
        ]}>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() => { hapticMedium(); router.push('/(auth)/signup'); }}
          >
            <Text style={styles.primaryBtnText}>Commencer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.7}
            onPress={() => { hapticLight(); router.push('/(auth)/login'); }}
          >
            <Text style={styles.secondaryBtnText}>J'ai déjà un compte</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* French hadith — lower area, no card */}
        <Animated.View style={[
          styles.hadithBlock,
          { opacity: wHadithOpacity, transform: [{ translateY: wHadithY }] },
        ]}>
          <Text style={styles.hadithText}>{HADITH}</Text>
          <Animated.Text style={[styles.hadithSource, { opacity: wSourceOpacity }]}>
            {HADITH_SOURCE}
          </Animated.Text>
        </Animated.View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },

  // ── splash layout ──────────────────────────────────────────────────────────
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 0,
  },

  // ── shared logo lockup ─────────────────────────────────────────────────────
  lockup: {
    alignItems: 'center',
    marginBottom: 64,
  },
  splashArabic: {
    fontFamily: F_ARABIC,
    fontSize: 68,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 76,
  },
  goldLine: {
    width: 36,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginTop: 6,
    marginBottom: 10,
    opacity: 0.75,
  },
  splashBrand: {
    fontFamily: F_BRAND,
    fontSize: 32,
    color: SPLASH_GREEN,
    letterSpacing: 4,
  },

  // ── hadith (shared splash + welcome) ──────────────────────────────────────
  hadithBlock: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  hadithText: {
    fontFamily: F_DISPLAY_LIGHT,
    fontSize: 16,
    color: MUTED,
    opacity: 0.85,
    textAlign: 'center',
    lineHeight: 26,
    letterSpacing: 0.2,
    fontStyle: 'italic',
  },
  hadithSource: {
    fontFamily: F_ARABIC_R,
    fontSize: 11,
    color: MUTED,
    opacity: 0.55,
    marginTop: 8,
    letterSpacing: 0.6,
    textAlign: 'center',
  },

  // ── splash root + background depth (beige dominant / green secondary / gold accent) ──
  splashRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE_EDGE,
  },
  spWash: {
    position: 'absolute',
    top: -140, left: -90, right: -90,
    height: 640,
    borderRadius: 420,
    backgroundColor: SPLASH_BEIGE,
  },
  spVignetteTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 90,
    backgroundColor: SPLASH_GREEN_FAINT,
  },
  spVignetteBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 110,
    backgroundColor: SPLASH_GREEN_FAINT,
  },

  // ── barely-felt geometric corner motifs — texture, not pattern ─────────────
  spPattern: {
    ...StyleSheet.absoluteFillObject,
  },
  spMotifLineA: {
    position: 'absolute', top: 74, left: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GOLD_DIM,
    opacity: 0.16, transform: [{ rotate: '45deg' }],
  },
  spMotifLineB: {
    position: 'absolute', top: 74, right: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GOLD_DIM,
    opacity: 0.16, transform: [{ rotate: '-45deg' }],
  },
  spMotifLineC: {
    position: 'absolute', bottom: 96, left: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GREEN,
    opacity: 0.08, transform: [{ rotate: '-45deg' }],
  },
  spMotifLineD: {
    position: 'absolute', bottom: 96, right: 30,
    width: 46, height: 1, backgroundColor: SPLASH_GREEN,
    opacity: 0.08, transform: [{ rotate: '45deg' }],
  },

  // ── golden halo + light sweep behind the arabic mark ───────────────────────
  spHalo: {
    position: 'absolute',
    top: '50%', left: '50%',
    width: 260, height: 260,
    marginTop: -130, marginLeft: -130,
    borderRadius: 130,
    backgroundColor: SPLASH_GOLD_GLOW_SOFT,
  },
  spSweep: {
    position: 'absolute',
    top: -12, bottom: -12,
    width: 60,
    backgroundColor: 'rgba(255,250,235,0.18)',
    transform: [{ rotate: '16deg' }],
  },

  // ── splash-only hadith treatment — quieter, more discreet than welcome's ───
  spHadithBlock: {
    alignItems: 'center',
    paddingHorizontal: 22,
    marginTop: 6,
  },
  spHadithText: {
    fontFamily: F_DISPLAY_LIGHT,
    fontSize: 14,
    color: SPLASH_HADITH_INK,
    opacity: 0.92,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.4,
    fontStyle: 'italic',
  },
  spHadithSource: {
    fontFamily: F_ARABIC_R,
    fontSize: 10,
    color: SPLASH_SOURCE_INK,
    opacity: 0.72,
    marginTop: 8,
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  // ── welcome layout ─────────────────────────────────────────────────────────
  welcomeShell: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 64,
    paddingBottom: 36,
    alignItems: 'center',
  },

  topBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 56,
  },
  topArabic: {
    fontFamily: F_ARABIC,
    fontSize: 28,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 34,
  },
  topDivider: {
    width: 1,
    height: 20,
    backgroundColor: GOLD,
    opacity: 0.4,
  },
  topBrandName: {
    fontFamily: F_BRAND,
    fontSize: 18,
    color: IVORY,
    letterSpacing: 3,
  },

  heroBlock: {
    alignItems: 'center',
    width: '100%',
  },
  headline: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 44,
    color: IVORY,
    lineHeight: 52,
    textAlign: 'center',
  },
  headlineLine2: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 44,
    color: GOLD,
    lineHeight: 52,
    textAlign: 'center',
    marginBottom: 20,
  },
  subtitle: {
    fontFamily: F_DISPLAY_LIGHT,
    fontSize: 17,
    color: MUTED,
    lineHeight: 26,
    textAlign: 'center',
    maxWidth: 310,
  },

  spacer: {
    flex: 1,
    minHeight: 24,
    maxHeight: 60,
  },

  ctaBlock: {
    gap: 12,
    marginBottom: 28,
    width: '100%',
  },
  primaryBtn: {
    backgroundColor: IVORY,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: BG,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  secondaryBtnText: {
    color: IVORY,
    fontSize: 16,
    fontWeight: '500',
  },
});
