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
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { hasValidPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';
import { planQueryOptions, progressQueryOptions, dueReviewsQueryOptions, profileQueryOptions, learnedItemsQueryOptions } from '@/queries';

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
  const { session, ready, user } = useAuthStore();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('splash');
  const [minDurationElapsed, setMinDurationElapsed] = useState(false);
  const [warmupReady, setWarmupReady] = useState(false);
  const [hasPendingOnboarding, setHasPendingOnboarding] = useState(false);
  const navigatedRef = useRef(false);

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
  // Removed: splash is now static, no animations

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

  // ─── Splash sequence removed — now static ─────────────────────────────

  // ─── Check for pending Onboarding V2 payload ───────────────────────────
  useEffect(() => {
    if (!ready) return;

    hasValidPendingOnboardingPlan()
      .then((pending) => {
        setHasPendingOnboarding(pending);
      })
      .catch(() => {
        setHasPendingOnboarding(false);
      });
  }, [ready]);

  // ─── Dashboard warm-up (prefetch) for authenticated users ─────────────────
  useEffect(() => {
    if (!fontsLoaded || !ready || !userId || hasPendingOnboarding) {
      setWarmupReady(true);
      return;
    }

    const mountedRef = { current: true };

    // Critical warm-up: blocks navigation to Today
    Promise.all([
      queryClient.prefetchQuery(planQueryOptions(userId)),
      queryClient.prefetchQuery(progressQueryOptions(userId)),
      queryClient.prefetchQuery(dueReviewsQueryOptions(userId)),
      queryClient.prefetchQuery(profileQueryOptions(userId)),
    ])
      .then(() => {
        if (mountedRef.current) setWarmupReady(true);
      })
      .catch(() => {
        if (mountedRef.current) setWarmupReady(true);
      });

    // Non-blocking warm-up: Mon Hifz data
    // Starts in parallel but does NOT block warmupReady or navigation
    // Errors are isolated and do not affect Today launch
    queryClient.prefetchQuery(learnedItemsQueryOptions(userId)).catch(() => {
      // Silently ignore errors - Mon Hifz will handle its own loading state
    });

    return () => { mountedRef.current = false; };
  }, [fontsLoaded, ready, userId, hasPendingOnboarding, queryClient]);

  // ─── Minimum display duration timer (1200ms) ─────────────────────────────
  useEffect(() => {
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setMinDurationElapsed(true);
    }, 1200);

    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  // ─── Maximum wait timeout (3000ms total from fonts loaded) ───────────────────
  useEffect(() => {
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setWarmupReady(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  // ─── Gate: wait for fonts + auth ready + minimum duration + warm-up/timeout ───
  useEffect(() => {
    if (!fontsLoaded || !ready || !minDurationElapsed || !warmupReady) return;
    if (navigatedRef.current) return;

    if (session) {
      navigatedRef.current = true;
      router.replace('/(app)/(tabs)');
      return;
    }
    setPhase('welcome');
  }, [fontsLoaded, ready, minDurationElapsed, warmupReady, session]);

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
    return (
      <View style={styles.splashRoot}>
        <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

        {/* ── Deep green design elements ── */}
        <View style={styles.spGreenFormTop} />
        <View style={styles.spGreenFormBot} />
        <View style={styles.spGoldAccent} />

        {/* ── Centered logo lockup ── */}
        <View style={styles.splashCenter}>
          <View style={styles.lockup}>
            <Text style={styles.splashArabic}>زينلي</Text>
            <View style={styles.goldLine} />
            <Text style={styles.splashBrand}>ZAINLY</Text>
          </View>
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
  },
  splashArabic: {
    fontFamily: F_ARABIC,
    fontSize: 75,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 86,
  },
  goldLine: {
    width: 37,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginTop: 6,
    marginBottom: 9,
    opacity: 0.8,
  },
  splashBrand: {
    fontFamily: F_BRAND_SB,
    fontSize: 33,
    color: SPLASH_GREEN,
    letterSpacing: 4.5,
    fontWeight: '600',
  },

  // ── splash root + background depth (beige dominant / green secondary / gold accent) ──
  splashRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },

  // ── deep green design elements ───────────────────────────────────────────────
  spGreenFormTop: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: SPLASH_GREEN,
  },
  spGreenFormBot: {
    position: 'absolute',
    bottom: -140,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
    opacity: 0.85,
  },
  spGoldAccent: {
    position: 'absolute',
    top: 120,
    left: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: GOLD,
    opacity: 0.12,
  },

  // ── welcome background elements (shared with old splash design) ───────────────
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
