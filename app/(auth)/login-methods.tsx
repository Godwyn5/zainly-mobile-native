import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  Animated, Easing, StatusBar, ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useFonts } from 'expo-font';
import { useQueryClient } from '@tanstack/react-query';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_500Medium } from '@expo-google-fonts/cinzel';
import { hapticMedium } from '@/utils/haptics';
import ZainlyLogo from '@/components/auth/ZainlyLogo';
import AppleIcon from '@/components/auth/icons/AppleIcon';
import GoogleIcon from '@/components/auth/icons/GoogleIcon';
import EmailIcon from '@/components/auth/icons/EmailIcon';
import { performSocialAuth, type SocialAuthFullResult, type SocialProvider } from '@/lib/socialAuth';
import { type OnboardingTransitionResult } from '@/lib/onboardingTransition';

// ─── palette — matches Splash/Welcome identity ───────────────────────────────
const BG = '#F7F2E7';              // cream (from Welcome)
const GREEN = '#163026';          // deep green (from Welcome)
const MUTED = '#7A6E61';          // warm grey for subtitles
const BUTTON_BG = '#FFFFFF';      // white for secondary buttons
const BUTTON_BORDER = 'rgba(22,48,38,0.12)'; // subtle green-tinted border

export default function LoginMethodsScreen() {
  const { context, flowId } = useLocalSearchParams<{ context?: string; flowId?: string }>();
  const fromOnboarding = context === 'onboarding';

  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<{ apple: boolean; google: boolean }>({ apple: false, google: false });
  const socialLoading = loading.apple || loading.google;
  const [transitionError, setTransitionError] = useState<OnboardingTransitionResult | null>(null);

  const [fontsLoaded] = useFonts({
    Lora_500Medium,
    Amiri_700Bold,
    Cinzel_500Medium,
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

  async function handleSocial(provider: SocialProvider) {
    hapticMedium();
    setLoading(prev => ({ ...prev, [provider]: true }));
    setTransitionError(null);

    const result: SocialAuthFullResult = await performSocialAuth(
      provider,
      queryClient,
      fromOnboarding && flowId
        ? { flowId: decodeURIComponent(flowId) }
        : undefined,
    );

    setLoading(prev => ({ ...prev, [provider]: false }));

    if (result.ok) {
      return;
    }

    if (result.reason === 'cancelled' || result.reason === 'stale_attempt') {
      return;
    }

    if (result.reason === 'config_error') {
      Alert.alert(
        'Configuration manquante',
        'La connexion avec ce fournisseur n\'est pas encore configurée. Contacte le support.',
      );
      return;
    }

    if (result.reason === 'unavailable') {
      Alert.alert(
        'Indisponible',
        result.message ?? 'Ce fournisseur n\'est pas disponible sur cet appareil.',
      );
      return;
    }

    if (result.transitionError && result.transitionError.status === 'error') {
      setTransitionError(result.transitionError);
      return;
    }

    const message = result.message ?? 'Connexion impossible pour le moment. Réessaie.';
    Alert.alert('Erreur', message);
  }

  function handleApple() {
    handleSocial('apple');
  }

  function handleGoogle() {
    handleSocial('google');
  }

  function handleEmail() {
    hapticMedium();
    if (fromOnboarding && flowId) {
      router.push(`/(auth)/login-email?context=onboarding&flowId=${encodeURIComponent(flowId)}`);
    } else if (fromOnboarding) {
      router.push('/(auth)/login-email?context=onboarding');
    } else {
      router.push('/(auth)/login-email');
    }
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  // ─── Transition error state ──────────────────────────────────────────────
  if (transitionError && transitionError.status === 'error') {
    const err = transitionError.error;
    let title = 'Impossible de finaliser ton programme';
    let desc = "Ton programme n'a pas été perdu. Vérifie ta connexion puis réessaie.";
    if (err.kind === 'handoff_error') {
      desc = err.message;
    } else if (err.kind === 'clear_superseded') {
      desc = err.message;
    } else if (err.kind === 'cache_verification_failed') {
      desc = err.message;
    }
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <View style={styles.confirmedShell}>
          <ZainlyLogo />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{desc}</Text>
          <TouchableOpacity onPress={() => setTransitionError(null)} style={styles.retryButton}>
            <Text style={styles.primaryBtnText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
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
            <Text style={styles.title}>Heureux de te revoir</Text>
          </Animated.View>

          {/* Subtitle */}
          <Animated.View style={[styles.subtitleBlock, { opacity: subtitleO, transform: [{ translateY: subtitleY }] }]}>
            <Text style={styles.subtitle}>Connecte-toi pour retrouver ta progression.</Text>
          </Animated.View>

          {/* Auth buttons */}
          <Animated.View style={[styles.buttonsBlock, { opacity: btnsO, transform: [{ translateY: btnsY }] }]}>

            {/* Apple - Primary on iOS only */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[styles.authButton, styles.appleButton]}
                onPress={handleApple}
                activeOpacity={0.85}
                disabled={loading.apple || socialLoading}
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
            )}

            {/* Google */}
            <TouchableOpacity
              style={[styles.authButton, styles.secondaryButton]}
              onPress={handleGoogle}
              activeOpacity={0.8}
              disabled={loading.google || socialLoading}
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
  confirmedShell: {
    paddingHorizontal: 28,
    paddingTop: 72,
    alignItems: 'center',
  },
  retryButton: {
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    minHeight: 56,
    marginTop: 24,
    marginHorizontal: 28,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: BG,
    letterSpacing: 0.2,
  },
});
