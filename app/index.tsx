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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { hapticLight, hapticMedium } from '@/utils/haptics';

// ─── gold accent tokens — shared between splash & welcome ───────────────────
const GOLD         = '#C6A15B';
const GOLD_DARK    = '#9F7628';

// ─── splash-only design tokens — warm beige / deep green / gold accent ─────
const SPLASH_BEIGE          = '#F7F2E7';
const SPLASH_BEIGE_EDGE     = '#EDE3CC';
const SPLASH_GREEN          = '#163026';
const SPLASH_GREEN_FAINT    = 'rgba(22,48,38,0.05)';
const SPLASH_GOLD_DIM       = '#8A744A';
const SPLASH_GOLD_GLOW_SOFT = 'rgba(198,161,91,0.14)';
const SPLASH_HADITH_INK     = '#163026';
const SPLASH_SOURCE_INK     = '#2A4A3A';

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

  // ─── welcome animation values — continuation of the splash choreography ──
  const wLogoOpacity     = useRef(new Animated.Value(0)).current;
  const wGlowScale       = useRef(new Animated.Value(1)).current;
  const wBreatheLoop     = useRef<Animated.CompositeAnimation | null>(null);
  const wHeroOpacity     = useRef(new Animated.Value(0)).current;
  const wHeroY           = useRef(new Animated.Value(16)).current;
  const wSubtitleOpacity = useRef(new Animated.Value(0)).current;
  const wSubtitleY       = useRef(new Animated.Value(10)).current;
  const wBtnsOpacity     = useRef(new Animated.Value(0)).current;
  const wBtnsY           = useRef(new Animated.Value(20)).current;
  const wHadithOpacity   = useRef(new Animated.Value(0)).current;
  const wHadithY         = useRef(new Animated.Value(8)).current;
  const wSourceOpacity   = useRef(new Animated.Value(0)).current;

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

  // ─── Welcome sequence — continues the splash's choreography, not a new one ─
  // The mark reappears instantly at the top (no re-fade — it never really left)
  // and keeps breathing exactly as it did on the splash. The headline, then the
  // subtitle a beat later, settle into the large open space beneath it. The
  // quiet hadith caption fades in just before the CTA, which rises gently from
  // below last of all — echoing the splash's "hold, then arrive" rhythm.
  useEffect(() => {
    if (phase !== 'welcome') return;

    Animated.parallel([
      Animated.timing(wLogoOpacity, {
        toValue: 1, duration: 260, delay: 0,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wHeroOpacity, {
        toValue: 1, duration: 440, delay: 120,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wHeroY, {
        toValue: 0, duration: 440, delay: 120,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(wSubtitleOpacity, {
        toValue: 1, duration: 420, delay: 280,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wSubtitleY, {
        toValue: 0, duration: 420, delay: 280,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(wHadithOpacity, {
        toValue: 1, duration: 380, delay: 520,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wHadithY, {
        toValue: 0, duration: 380, delay: 520,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(wSourceOpacity, {
        toValue: 1, duration: 300, delay: 680,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wBtnsOpacity, {
        toValue: 1, duration: 440, delay: 640,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(wBtnsY, {
        toValue: 0, duration: 440, delay: 640,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start(() => {
      // low-amplitude breathing halo, identical rhythm to the splash's own —
      // the glow never stops, it simply continues behind the smaller mark.
      wBreatheLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(wGlowScale, {
            toValue: 1.05, duration: 2600,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(wGlowScale, {
            toValue: 1.0, duration: 2600,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ]),
      );
      wBreatheLoop.current.start();
    });

    return () => wBreatheLoop.current?.stop();
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

  // ─── WELCOME — the same room, the light hasn't changed ──────────────────
  // Same beige/green/gold identity as the splash, full-bleed and un-faded
  // (no re-entrance for the backdrop — it was already there a moment ago).
  return (
    <View style={styles.welcomeRoot}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

      <View pointerEvents="none" style={styles.spWash} />
      <View pointerEvents="none" style={styles.spVignetteTop} />
      <View pointerEvents="none" style={styles.spVignetteBottom} />
      <View pointerEvents="none" style={styles.spPattern}>
        <View style={styles.spMotifLineA} />
        <View style={styles.spMotifLineB} />
        <View style={styles.spMotifLineC} />
        <View style={styles.spMotifLineD} />
      </View>

      <SafeAreaView style={styles.welcomeSafe}>
        <View style={styles.welcomeShell}>

          {/* brand lockup — the mark, now settled at the top, still glowing */}
          <Animated.View style={[styles.topBrand, { opacity: wLogoOpacity }]}>
            <View style={styles.topMark}>
              <Animated.View
                pointerEvents="none"
                style={[styles.wHalo, { transform: [{ scale: wGlowScale }] }]}
              />
              <Text style={styles.topArabic}>زينلي</Text>
            </View>
            <View style={styles.topDivider} />
            <Text style={styles.topBrandName}>Zainly</Text>
          </Animated.View>

          {/* headline + subtitle — floating in generous open space */}
          <View style={styles.heroArea}>
            <Animated.View style={[
              styles.heroHeadlineWrap,
              { opacity: wHeroOpacity, transform: [{ translateY: wHeroY }] },
            ]}>
              <Text style={styles.headline}>{'Ton Hifz,'}</Text>
              <Text style={styles.headlineLine2}>{'guidé chaque jour.'}</Text>
            </Animated.View>
            <Animated.Text style={[
              styles.subtitle,
              { opacity: wSubtitleOpacity, transform: [{ translateY: wSubtitleY }] },
            ]}>
              {'Zainly te dit quoi mémoriser, quoi réviser,\net t\u2019aide à avancer avec constance.'}
            </Animated.Text>
          </View>

          {/* quiet hadith caption — a grace note just above the CTA */}
          <Animated.View style={[
            styles.hadithCaption,
            { opacity: wHadithOpacity, transform: [{ translateY: wHadithY }] },
          ]}>
            <Text style={styles.hadithCaptionText}>{HADITH}</Text>
            <Animated.Text style={[styles.hadithCaptionSource, { opacity: wSourceOpacity }]}>
              {HADITH_SOURCE}
            </Animated.Text>
          </Animated.View>

          {/* CTA — always anchored to the bottom, rising gently into place */}
          <Animated.View style={[
            styles.ctaBlock,
            { opacity: wBtnsOpacity, transform: [{ translateY: wBtnsY }] },
          ]}>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.88}
              onPress={() => { hapticMedium(); router.push('/onboarding-v2/name'); }}
            >
              <Text style={styles.primaryBtnText}>Commencer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.6}
              onPress={() => { hapticLight(); router.push('/(auth)/login'); }}
            >
              <Text style={styles.secondaryBtnText}>J'ai déjà un compte</Text>
            </TouchableOpacity>
          </Animated.View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
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

  // ── splash root + background depth (beige dominant / green secondary / gold accent) ──
  splashRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
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
    color: SPLASH_SOURCE_INK,
    opacity: 0.92,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.4,
    fontStyle: 'italic',
  },
  spHadithSource: {
    fontFamily: F_ARABIC_R,
    fontSize: 10,
    color: SPLASH_HADITH_INK,
    opacity: 0.72,
    marginTop: 8,
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  // ── welcome root — same beige backdrop as the splash, full-bleed ──────────
  welcomeRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },
  welcomeSafe: {
    flex: 1,
  },
  welcomeShell: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 10,
    alignItems: 'center',
  },

  // ── brand lockup — the mark, settled and small, still quietly glowing ─────
  topBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topMark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wHalo: {
    position: 'absolute',
    width: 108, height: 108,
    borderRadius: 54,
    backgroundColor: SPLASH_GOLD_GLOW_SOFT,
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
    opacity: 0.45,
  },
  topBrandName: {
    fontFamily: F_BRAND,
    fontSize: 18,
    color: SPLASH_GREEN,
    letterSpacing: 3,
  },

  // ── headline + subtitle — floating alone in a wide open middle ────────────
  heroArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  heroHeadlineWrap: {
    alignItems: 'center',
  },
  headline: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 44,
    color: SPLASH_GREEN,
    lineHeight: 52,
    textAlign: 'center',
  },
  headlineLine2: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 44,
    color: GOLD_DARK,
    lineHeight: 52,
    textAlign: 'center',
    marginBottom: 20,
  },
  subtitle: {
    fontFamily: F_DISPLAY,
    fontSize: 17,
    color: SPLASH_SOURCE_INK,
    lineHeight: 26,
    textAlign: 'center',
    maxWidth: 310,
  },

  // ── quiet hadith caption — a grace note, not a fifth hierarchy tier ───────
  hadithCaption: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 22,
  },
  hadithCaptionText: {
    fontFamily: F_DISPLAY_LIGHT,
    fontSize: 12.5,
    color: SPLASH_HADITH_INK,
    opacity: 0.68,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.4,
    fontStyle: 'italic',
  },
  hadithCaptionSource: {
    fontSize: 9,
    fontWeight: '500',
    color: SPLASH_SOURCE_INK,
    opacity: 0.5,
    marginTop: 4,
    letterSpacing: 0.7,
    textAlign: 'center',
  },

  // ── CTA — always anchored to the very bottom, Duolingo-style ─────────────
  ctaBlock: {
    gap: 12,
    width: '100%',
  },
  primaryBtn: {
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
  primaryBtnText: {
    color: SPLASH_BEIGE,
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: SPLASH_GREEN,
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
