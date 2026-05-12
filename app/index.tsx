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
  const logoOpacity    = useRef(new Animated.Value(0)).current;
  const logoScale      = useRef(new Animated.Value(0.95)).current;
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
  useEffect(() => {
    if (!fontsLoaded) return;
    Animated.sequence([
      // logo mark fades + scales in
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1, duration: 500,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1, duration: 560,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // gold separator + Zainly text
      Animated.parallel([
        Animated.timing(lineOpacity, {
          toValue: 1, duration: 220,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(brandOpacity, {
          toValue: 1, duration: 280,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
      // hadith slides up + fades in
      Animated.parallel([
        Animated.timing(hadithOpacity, {
          toValue: 1, duration: 480,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(hadithY, {
          toValue: 0, duration: 480,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // source appears after a beat
      Animated.sequence([
        Animated.delay(160),
        Animated.timing(sourceOpacity, {
          toValue: 1, duration: 320,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
      // hold
      Animated.delay(420),
    ]).start(() => setAnimDone(true));
  }, [fontsLoaded]);

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
    return <View style={styles.root}><StatusBar barStyle="light-content" backgroundColor={BG} translucent={false} /></View>;
  }

  // ─── SPLASH ──────────────────────────────────────────────────────────────
  if (phase === 'splash') {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={BG} translucent={false} />
        <View style={styles.splashCenter}>

          {/* logo lockup */}
          <Animated.View style={[
            styles.lockup,
            { opacity: logoOpacity, transform: [{ scale: logoScale }] },
          ]}>
            <Text style={styles.splashArabic}>زينلي</Text>
            <Animated.View style={[styles.goldLine, { opacity: lineOpacity }]} />
            <Animated.Text style={[styles.splashBrand, { opacity: brandOpacity }]}>
              Zainly
            </Animated.Text>
          </Animated.View>

          {/* hadith lower area */}
          <Animated.View style={[
            styles.hadithBlock,
            { opacity: hadithOpacity, transform: [{ translateY: hadithY }] },
          ]}>
            <Text style={styles.hadithText}>{HADITH}</Text>
            <Animated.Text style={[styles.hadithSource, { opacity: sourceOpacity }]}>
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
    color: IVORY,
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
