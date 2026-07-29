import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Animated, Easing,
} from 'react-native';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
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
const SPLASH_GOLD_DIM       = '#8A744A';

// ─── font family names ───────────────────────────────────────────────────────
const F_BRAND        = 'Cinzel_500Medium';
const F_BRAND_SB     = 'Cinzel_600SemiBold';
const F_DISPLAY_BOLD = 'CormorantGaramond_700Bold';
const F_DISPLAY      = 'CormorantGaramond_600SemiBold';
const F_ARABIC       = 'Amiri_700Bold';

// ─── hadith removed — no longer used in Welcome ─────────────────────────────

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
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    Amiri_700Bold,
    Cinzel_500Medium,
    Cinzel_600SemiBold,
  });

  // ─── crossfade animation values ────────────────────────────────────────────
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const welcomeOpacity = useRef(new Animated.Value(0)).current;
  const crossfadeMountedRef = useRef(false);

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

  // ─── Crossfade animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'welcome') return;
    if (crossfadeMountedRef.current) return;
    crossfadeMountedRef.current = true;

    Animated.parallel([
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(welcomeOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      crossfadeMountedRef.current = false;
    };
  }, [phase, splashOpacity, welcomeOpacity]);

  // ─── Welcome sequence removed — now static ─────────────────────────────

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

  // ─── WELCOME — with crossfade from splash ───────────────────────────────────
  return (
    <View style={styles.splashRoot}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

      {/* ── Splash content (fading out) ── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: splashOpacity }]}>
        <View style={styles.splashRoot}>
          <View style={styles.spGreenFormTop} />
          <View style={styles.spGreenFormBot} />
          <View style={styles.spGoldAccent} />
          <View style={styles.splashCenter}>
            <View style={styles.lockup}>
              <Text style={styles.splashArabic}>زينلي</Text>
              <View style={styles.goldLine} />
              <Text style={styles.splashBrand}>ZAINLY</Text>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* ── Welcome content (fading in) ── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: welcomeOpacity }]}>
        <View style={styles.welcomeRoot}>
          {/* ── Organic background shapes ── */}
          <View pointerEvents="none" style={styles.wGreenFormTopRight} />
          <View pointerEvents="none" style={styles.wGreenFormTopLeft} />
          <View pointerEvents="none" style={styles.wGreenFormBottomLeft} />

          <SafeAreaView style={styles.welcomeSafe}>
            <View style={styles.welcomeShell}>

              {/* ── Hero section ── */}
              <View style={styles.heroSection}>
                {/* Gold line separator */}
                <View style={styles.goldLineSeparator} />

                {/* Headline */}
                <View style={styles.headlineWrap}>
                  <Text style={styles.headline}>Mémorise le Coran</Text>
                  <Text style={styles.headlineAccent}>avec constance.</Text>
                </View>

                {/* Micro-ornament (rosette) */}
                <View style={styles.rosette}>
                  <View style={styles.rosetteCenter} />
                  <View style={styles.rosetteArm1} />
                  <View style={styles.rosetteArm2} />
                  <View style={styles.rosetteArm3} />
                  <View style={styles.rosetteArm4} />
                </View>

                {/* Subtitle */}
                <Text style={styles.subtitle}>
                  Chaque jour, Zainly te montre quoi mémoriser
                  et quoi réviser pour continuer d'avancer.
                </Text>
              </View>

              {/* ── CTA section ── */}
              <View style={styles.ctaSection}>
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
              </View>

            </View>
          </SafeAreaView>
        </View>
      </Animated.View>
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

  // ── welcome organic background shapes ───────────────────────────────────────
  wGreenFormTopRight: {
    position: 'absolute',
    top: -200,
    right: -150,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
  },
  wGreenFormTopLeft: {
    position: 'absolute',
    top: -80,
    left: -60,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: SPLASH_BEIGE_EDGE,
    opacity: 0.4,
  },
  wGreenFormBottomLeft: {
    position: 'absolute',
    bottom: -280,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
    opacity: 0.9,
  },

  // ── hero section ───────────────────────────────────────────────────────────
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  goldLineSeparator: {
    width: 48,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginBottom: 24,
  },
  headlineWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headline: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 42,
    color: SPLASH_GREEN,
    lineHeight: 50,
    textAlign: 'center',
  },
  headlineAccent: {
    fontFamily: F_DISPLAY_BOLD,
    fontSize: 42,
    color: GOLD_DARK,
    lineHeight: 50,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F_DISPLAY,
    fontSize: 16,
    color: SPLASH_GREEN,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 20,
  },

  // ── micro-ornament (rosette) ─────────────────────────────────────────────────
  rosette: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  rosetteCenter: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  rosetteArm1: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
  },
  rosetteArm2: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  rosetteArm3: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '90deg' }],
  },
  rosetteArm4: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '135deg' }],
  },

  // ── CTA section ─────────────────────────────────────────────────────────────
  ctaSection: {
    gap: 14,
    width: '100%',
    marginBottom: 12,
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
