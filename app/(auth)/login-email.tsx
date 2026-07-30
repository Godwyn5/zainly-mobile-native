import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
  Animated, Easing, StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/db/client';
import { hapticLight, hapticMedium, hapticSelection } from '@/utils/haptics';
import { useOnboardingV2AuthFinalize } from '@/hooks/useOnboardingV2AuthFinalize';
import type { FinalizeOnboardingV2Result } from '@/lib/onboardingFinalize';
import ZainlyLogo from '@/components/auth/ZainlyLogo';

// ─── palette — matches Splash/Welcome identity ───────────────────────────────
const BG = '#F7F2E7';              // cream (from Welcome)
const GREEN = '#163026';          // deep green (from Welcome)
const GOLD = '#C6A15B';           // gold (from Welcome)
const GOLD_DARK = '#9F7628';      // dark gold (from Welcome)
const MUTED = '#7A6E61';          // warm grey for subtitles/placeholders
const BORDER = 'rgba(22,48,38,0.12)'; // subtle green-tinted border
const SURF = '#FFFFFF';          // white for inputs

function friendlyAuthError(msg: string): string {
  if (msg.includes('Network request failed') || msg.includes('fetch'))
    return 'Impossible de contacter le serveur. Vérifie ta connexion internet.';
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials') || msg.includes('password'))
    return 'E-mail ou mot de passe incorrect.';
  return 'Connexion impossible pour le moment.';
}

export default function LoginEmailScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const fromOnboarding = context === 'onboarding';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeletionBanner, setShowDeletionBanner] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const {
    premiumGateIssue, isResolvingPremiumGate,
    runFinalize, retryPremiumGate, restorePremiumPurchase,
  } = useOnboardingV2AuthFinalize();

  const [fontsLoaded] = useFonts({
    Lora_500Medium,
  });

  // ─── entrance animations ───────────────────────────────────────────────────
  const logoO = useRef(new Animated.Value(0)).current;
  const logoY = useRef(new Animated.Value(-10)).current;
  const titleO = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(14)).current;
  const formO = useRef(new Animated.Value(0)).current;
  const formY = useRef(new Animated.Value(14)).current;
  const btnsO = useRef(new Animated.Value(0)).current;
  const btnsY = useRef(new Animated.Value(12)).current;
  const passwordInputRef = useRef<TextInput>(null);

  // ─── check for account deletion success flag ───────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('account_deleted_success').then((value) => {
      if (value === 'true') {
        setShowDeletionBanner(true);
        setEmail('');
        setPassword('');
        AsyncStorage.removeItem('account_deleted_success').catch(() => {});
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!fontsLoaded) return;
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(logoO, { toValue: 1, duration: 220, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(logoY, { toValue: 0, duration: 220, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(titleO, { toValue: 1, duration: 240, delay: 60, easing: E, useNativeDriver: true }),
      Animated.timing(titleY, { toValue: 0, duration: 240, delay: 60, easing: E, useNativeDriver: true }),
      Animated.timing(formO, { toValue: 1, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(formY, { toValue: 0, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(btnsO, { toValue: 1, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
      Animated.timing(btnsY, { toValue: 0, duration: 260, delay: 180, easing: E, useNativeDriver: true }),
    ]).start();
  }, [fontsLoaded]);

  // Shared branching for a resolved (non-premium-gated) finalization result
  function applyFinalizedResult(finalized: FinalizeOnboardingV2Result) {
    if (!finalized.ok && finalized.reason !== 'no_source') {
      Alert.alert(
        'Programme non enregistré',
        'La connexion a réussi, mais l’enregistrement de ton programme a échoué. Réessaie de te connecter dans un instant.'
      );
      return;
    }
    router.replace('/(app)/(tabs)/');
  }

  async function handleLogin() {
    if (loading) return;
    setError(null);
    hapticMedium();
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) { setError('Saisis ton e-mail et ton mot de passe.'); return; }
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: trimEmail, password });
    setLoading(false);
    if (authError) { setError(friendlyAuthError(authError.message)); return; }
    if (data.session) {
      const finalized = await runFinalize(data.session.user.id);
      if (!finalized) return;
      applyFinalizedResult(finalized);
      return;
    }
    router.replace('/(app)/(tabs)/');
  }

  async function handlePremiumGateRetry() {
    hapticLight();
    const finalized = await retryPremiumGate();
    if (finalized) applyFinalizedResult(finalized);
  }

  async function handlePremiumGateRestore() {
    hapticLight();
    const finalized = await restorePremiumPurchase();
    if (finalized) {
      applyFinalizedResult(finalized);
      return;
    }
    Alert.alert('Aucun achat trouvé', 'Aucun abonnement Zainly+ actif n’a été trouvé sur ce compte Apple.');
  }

  function handleBack() {
    hapticLight();
    router.back();
  }

  function handleForgotPassword() {
    hapticLight();
    router.push('/(auth)/reset-password');
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <ScrollView style={styles.root} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* ─── Decorative green shape (partial, off-screen) ───────────────────── */}
        <View style={styles.decorativeShape} pointerEvents="none" />

        {/* ─── Logo ───────────────────────────────────────────────────────── */}
        <Animated.View style={[styles.logoBlock, { opacity: logoO, transform: [{ translateY: logoY }] }]}>
          <ZainlyLogo />
        </Animated.View>

        {/* ─── Title ───────────────────────────────────────────────────────── */}
        <Animated.View style={[styles.titleBlock, { opacity: titleO, transform: [{ translateY: titleY }] }]}>
          <Text style={styles.title}>Heureux de te revoir</Text>
        </Animated.View>

        {/* ─── Account deletion success banner ─────────────────────────────── */}
        {showDeletionBanner && (
          <View style={styles.deletionBanner} accessible accessibilityLabel="Compte supprimé avec succès" accessibilityRole="alert">
            <Text style={styles.deletionBannerText}>Ton compte et tes données ont bien été supprimés.</Text>
          </View>
        )}

        {/* ─── Form ───────────────────────────────────────────────────────── */}
        <Animated.View style={[styles.formBlock, { opacity: formO, transform: [{ translateY: formY }] }]}>
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            placeholder="Adresse e-mail"
            placeholderTextColor={MUTED}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            returnKeyType="next"
            onSubmitEditing={() => { passwordInputRef.current?.focus(); }}
          />

          <View style={styles.pwWrap}>
            <TextInput
              ref={passwordInputRef}
              style={[styles.input, styles.pwInput, passwordFocused && styles.inputFocused]}
              placeholder="Mot de passe"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              editable={!loading}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity style={styles.pwEye} onPress={() => { hapticSelection(); setShowPw(v => !v); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pwEyeText}>{showPw ? 'Masquer' : 'Voir'}</Text>
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ─── Premium verification gate ─────────────────────────────────────── */}
        {premiumGateIssue && (
          <View style={styles.premiumGateBox}>
            <Text style={styles.premiumGateText}>
              {premiumGateIssue === 'entitlement_missing'
                ? 'Nous n’avons pas encore pu vérifier ton accès premium. Tu peux réessayer ou restaurer ton achat.'
                : 'Nous n’avons pas pu vérifier ton accès Zainly+ pour le moment. Réessaie dans quelques instants.'}
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, isResolvingPremiumGate && styles.btnDim]}
              onPress={handlePremiumGateRetry}
              activeOpacity={0.85}
              disabled={isResolvingPremiumGate}
            >
              {isResolvingPremiumGate
                ? <ActivityIndicator color={BG} />
                : <Text style={styles.primaryBtnText}>Réessayer</Text>
              }
            </TouchableOpacity>
            {premiumGateIssue === 'entitlement_missing' && (
              <TouchableOpacity
                style={[styles.secondaryBtn, { marginBottom: 0 }, isResolvingPremiumGate && styles.btnDim]}
                onPress={handlePremiumGateRestore}
                activeOpacity={0.8}
                disabled={isResolvingPremiumGate}
              >
                <Text style={styles.secondaryBtnText}>Restaurer mon achat</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ─── Buttons ───────────────────────────────────────────────────────── */}
        {!premiumGateIssue && (
        <Animated.View style={[styles.btnsBlock, { opacity: btnsO, transform: [{ translateY: btnsY }] }]}>
          <TouchableOpacity style={[styles.primaryBtn, loading && styles.btnDim]} onPress={handleLogin} activeOpacity={0.85} disabled={loading}>
            {loading ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator color={BG} />
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Se connecter</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  container: {
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 48,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
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
  titleBlock: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'Lora_500Medium',
    fontSize: 36,
    color: GREEN,
    lineHeight: 44,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  deletionBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  deletionBannerText: { fontSize: 13, color: '#047857', lineHeight: 18 },
  formBlock: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    backgroundColor: SURF,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 15,
    color: GREEN,
    marginBottom: 14,
  },
  inputFocused: {
    borderColor: GOLD,
    borderWidth: 2,
  },
  pwWrap: { position: 'relative' },
  pwInput: { paddingRight: 70 },
  pwEye: { 
    position: 'absolute', 
    right: 16, 
    top: 0, 
    bottom: 0, 
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pwEyeText: { 
    fontSize: 13, 
    color: GOLD, 
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, color: '#B91C1C', lineHeight: 18 },
  forgotRow: { alignItems: 'center', paddingVertical: 6, marginBottom: 4 },
  forgotText: { fontSize: 13, color: MUTED },
  premiumGateBox: {
    width: '100%',
    backgroundColor: SURF,
    borderWidth: 1,
    borderColor: 'rgba(198,161,91,0.30)',
    borderRadius: 14,
    padding: 18,
    gap: 12,
  },
  premiumGateText: {
    fontSize: 14,
    color: GREEN,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 4,
  },
  btnsBlock: { width: '100%' },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    minHeight: 56,
  },
  btnDim: { opacity: 0.55 },
  loaderContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: BG,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    backgroundColor: SURF,
    borderWidth: 1,
    borderColor: 'rgba(198,161,91,0.30)',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: GREEN,
  },
});
