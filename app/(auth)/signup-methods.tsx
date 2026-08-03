import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useFonts } from 'expo-font';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { hapticMedium } from '@/utils/haptics';
import ZainlyLogo from '@/components/auth/ZainlyLogo';
import AppleIcon from '@/components/auth/icons/AppleIcon';
import GoogleIcon from '@/components/auth/icons/GoogleIcon';
import EmailIcon from '@/components/auth/icons/EmailIcon';

// ─── palette — matches Splash/Welcome identity ───────────────────────────────
const BG = '#F7F2E7';              // cream (from Welcome)
const GREEN = '#163026';          // deep green (from Welcome)
const MUTED = '#7A6E61';          // warm grey for subtitles
const BUTTON_BG = '#FFFFFF';      // white for secondary buttons
const BUTTON_BORDER = 'rgba(22,48,38,0.12)'; // subtle green-tinted border

export default function SignupMethodsScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const fromOnboarding = context === 'onboarding';

  const [loading, setLoading] = useState({ apple: false, google: false });

  const [fontsLoaded] = useFonts({
    Lora_500Medium,
  });

  // ─── entrance animations ───────────────────────────────────────────────────
  const logoO = useRef(new Animated.Value(0)).current;
  const logoY = useRef(new Animated.Value(-10)).current;
  const titleO = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(14)).current;
  const subtitleO = useRef(new Animated.Value(0)).current;
  const subtitleY = useRef(new Animated.Value(14)).current;
  const btnsO = useRef(new Animated.Value(0)).current;
  const btnsY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!fontsLoaded) return;
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(logoO, { toValue: 1, duration: 220, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(logoY, { toValue: 0, duration: 220, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(titleO, { toValue: 1, duration: 240, delay: 60, easing: E, useNativeDriver: true }),
      Animated.timing(titleY, { toValue: 0, duration: 240, delay: 60, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleO, { toValue: 1, duration: 220, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(subtitleY, { toValue: 0, duration: 220, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(btnsO, { toValue: 1, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
      Animated.timing(btnsY, { toValue: 0, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
    ]).start();
  }, [fontsLoaded, logoO, logoY, titleO, titleY, subtitleO, subtitleY, btnsO, btnsY]);

  function handleApple() {
    hapticMedium();
    // PLACEHOLDER: Real Apple auth to be implemented in separate mission
    alert('Continuer avec Apple - Bientôt disponible');
  }

  function handleGoogle() {
    hapticMedium();
    // PLACEHOLDER: Real Google auth to be implemented in separate mission
    alert('Continuer avec Google - Bientôt disponible');
  }

  function handleEmail() {
    hapticMedium();
    router.push(fromOnboarding ? '/(auth)/signup-email?context=onboarding' : '/(auth)/signup-email');
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <View style={styles.root}>

        {/* ─── Decorative green shape (partial, off-screen) ───────────────────── */}
        <View style={styles.decorativeShape} pointerEvents="none" />

        {/* ─── Content ──────────────────────────────────────────────────────── */}
        <View style={styles.content}>

          {/* Logo */}
          <Animated.View style={[styles.logoBlock, { opacity: logoO, transform: [{ translateY: logoY }] }]}>
            <ZainlyLogo />
          </Animated.View>

          {/* Title */}
          <Animated.View style={[styles.titleBlock, { opacity: titleO, transform: [{ translateY: titleY }] }]}>
            <Text style={styles.title}>Crée ton compte</Text>
          </Animated.View>

          {/* Subtitle */}
          <Animated.View style={[styles.subtitleBlock, { opacity: subtitleO, transform: [{ translateY: subtitleY }] }]}>
            <Text style={styles.subtitle}>Sauvegarde ta progression pour ne rien perdre.</Text>
          </Animated.View>

          {/* Auth buttons */}
          <Animated.View style={[styles.buttonsBlock, { opacity: btnsO, transform: [{ translateY: btnsY }] }]}>

            {/* Apple - Primary on iOS */}
            <TouchableOpacity
              style={[styles.authButton, styles.appleButton]}
              onPress={handleApple}
              activeOpacity={0.85}
              disabled={loading.apple}
            >
              {loading.apple ? (
                <ActivityIndicator color={BG} />
              ) : (
                <View style={styles.buttonContent}>
                  <AppleIcon size={20} color={BG} />
                  <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Google */}
            <TouchableOpacity
              style={[styles.authButton, styles.secondaryButton]}
              onPress={handleGoogle}
              activeOpacity={0.8}
              disabled={loading.google}
            >
              {loading.google ? (
                <ActivityIndicator color={GREEN} />
              ) : (
                <View style={styles.buttonContent}>
                  <GoogleIcon size={20} color={GREEN} />
                  <Text style={styles.secondaryButtonText}>Continuer avec Google</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Email */}
            <TouchableOpacity
              style={[styles.authButton, styles.secondaryButton, { marginBottom: 0 }]}
              onPress={handleEmail}
              activeOpacity={0.8}
            >
              <View style={styles.buttonContent}>
                <EmailIcon size={20} color={GREEN} />
                <Text style={styles.secondaryButtonText}>Continuer avec e-mail</Text>
              </View>
            </TouchableOpacity>

          </Animated.View>

        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  decorativeShape: {
    position: 'absolute',
    top: -200,
    right: -150,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: GREEN,
    opacity: 0.08,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 48,
    alignItems: 'center',
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 32,
  },
  titleBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Lora_500Medium',
    fontSize: 36,
    color: GREEN,
    lineHeight: 44,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitleBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  subtitle: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 280,
  },
  buttonsBlock: {
    width: '100%',
    gap: 14,
  },
  authButton: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleButton: {
    backgroundColor: GREEN,
  },
  appleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: BG,
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: BUTTON_BG,
    borderWidth: 1,
    borderColor: BUTTON_BORDER,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: GREEN,
    letterSpacing: 0.2,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});
