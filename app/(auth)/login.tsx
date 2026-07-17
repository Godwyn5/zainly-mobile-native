import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
  Animated, Easing, StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_400Regular } from '@expo-google-fonts/lora';
import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_500Medium } from '@expo-google-fonts/cinzel';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/db/client';
import { hapticLight, hapticMedium, hapticSelection } from '@/utils/haptics';
import { useOnboardingV2AuthFinalize } from '@/hooks/useOnboardingV2AuthFinalize';
import type { FinalizeOnboardingV2Result } from '@/lib/onboardingFinalize';

// ─── palette — inverted from entry: ivory bg, deep green text ───────────────
const BG          = '#F8F4EA';          // warm ivory (entry IVORY)
const GREEN       = '#031A12';          // deep green (entry BG)
const TITLE_GREEN = '#031A12';          // near-black deep green — calm premium auth headings
const GOLD     = '#C6A15B';          // champagne gold
const MUTED    = '#7A6E61';          // warm grey for subtitles/placeholders
const BORDER   = 'rgba(3,26,18,0.12)'; // very subtle green-tinted border
const SURF     = '#FFFFFF';          // pure white for inputs
const GOLD_BORDER = 'rgba(198,161,91,0.30)'; // champagne-tinted social border

// ─── font families ───────────────────────────────────────────────────────────
const F_BRAND  = 'Cinzel_500Medium';   // brand wordmark only
const F_TITLE  = 'Lora_600SemiBold';   // hero titles — semibold for calm elegance
const F_SUB    = 'Lora_400Regular';    // elegant subtitles
const F_ARABIC = 'Amiri_700Bold';      // Arabic brand mark

function friendlyAuthError(msg: string): string {
  if (msg.includes('Network request failed') || msg.includes('fetch'))
    return 'Impossible de contacter le serveur. Vérifie ta connexion internet.';
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials') || msg.includes('password'))
    return 'E-mail ou mot de passe incorrect.';
  return 'Connexion impossible pour le moment.';
}

export default function LoginScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const fromOnboarding = context === 'onboarding';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showDeletionBanner, setShowDeletionBanner] = useState(false);

  const {
    premiumGateIssue, isResolvingPremiumGate,
    runFinalize, retryPremiumGate, restorePremiumPurchase,
  } = useOnboardingV2AuthFinalize();

  const [fontsLoaded] = useFonts({
    Lora_600SemiBold,
    Lora_400Regular,
    Amiri_400Regular,
    Amiri_700Bold,
    Cinzel_500Medium,
  });

  // ─── entrance animations ───────────────────────────────────────────────────
  const brandO = useRef(new Animated.Value(0)).current;
  const brandY = useRef(new Animated.Value(-10)).current;
  const heroO  = useRef(new Animated.Value(0)).current;
  const heroY  = useRef(new Animated.Value(14)).current;
  const formO  = useRef(new Animated.Value(0)).current;
  const formY  = useRef(new Animated.Value(14)).current;
  const btnsO  = useRef(new Animated.Value(0)).current;
  const btnsY  = useRef(new Animated.Value(12)).current;

  // ─── check for account deletion success flag ───────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('account_deleted_success').then((value) => {
      if (value === 'true') {
        setShowDeletionBanner(true);
        setEmail('');
        setPassword('');
        // Consume the flag immediately so it doesn't reappear on app restart
        AsyncStorage.removeItem('account_deleted_success').catch(() => {
          // Non-fatal: if removal fails, the banner might show again on next launch
        });
      }
    }).catch(() => {
      // Non-fatal: if storage read fails, just proceed without banner
    });
  }, []);

  useEffect(() => {
    if (!fontsLoaded) return;
    // All elements animate in parallel with small stagger delays → ~380ms total
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(brandO, { toValue: 1, duration: 220, delay: 0,   easing: E, useNativeDriver: true }),
      Animated.timing(brandY, { toValue: 0, duration: 220, delay: 0,   easing: E, useNativeDriver: true }),
      Animated.timing(heroO,  { toValue: 1, duration: 240, delay: 60,  easing: E, useNativeDriver: true }),
      Animated.timing(heroY,  { toValue: 0, duration: 240, delay: 60,  easing: E, useNativeDriver: true }),
      Animated.timing(formO,  { toValue: 1, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(formY,  { toValue: 0, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(btnsO,  { toValue: 1, duration: 260, delay: 170, easing: E, useNativeDriver: true }),
      Animated.timing(btnsY,  { toValue: 0, duration: 260, delay: 170, easing: E, useNativeDriver: true }),
    ]).start();
  }, [fontsLoaded]);

  // Shared branching for a resolved (non-premium-gated) finalization result —
  // called both right after login and after a successful gate retry/restore.
  function applyFinalizedResult(finalized: FinalizeOnboardingV2Result) {
    if (!finalized.ok && finalized.reason !== 'no_source') {
      // A real onboarding-v2 program failed to finalize. The pending
      // payload was deliberately NOT deleted — retrying login again will
      // retry finalization. Never route into a dashboard with no
      // persisted plan.
      Alert.alert(
        'Programme non enregistré',
        'La connexion a réussi, mais l’enregistrement de ton programme a échoué. Réessaie de te connecter dans un instant.'
      );
      return;
    }
    router.replace('/(app)/(tabs)/');
  }

  async function handleLogin() {
    setError(null);
    hapticMedium();
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) { setError('Saisis ton e-mail et ton mot de passe.'); return; }
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: trimEmail, password });
    setLoading(false);
    if (authError) { setError(friendlyAuthError(authError.message)); return; }
    // Same integration point as signup.tsx: an abandoned onboarding-v2 draft
    // OR pending payload (user confirmed their e-mail and came back via a
    // normal login, possibly without ?context=onboarding) is finalized into
    // a real, persisted plan here too, never silently lost. Deliberately
    // unconditional — finalizeOnboardingV2Plan() itself is a no-op
    // (`no_source`) for accounts that never went through onboarding-v2. A
    // 'unlimited' parcours is gated on a verified RevenueCat entitlement
    // first — free/daily_limited parcours resolve immediately, never blocked.
    if (data.session) {
      const finalized = await runFinalize(data.session.user.id);
      if (!finalized) return; // premiumGateIssue is now set — inline block renders below
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

  function handleSocial() {
    hapticLight();
    Alert.alert('Bientôt disponible', 'Connexion sociale bientôt disponible.');
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <ScrollView style={styles.root} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* ── Brand lockup — centered ── */}
        <Animated.View style={[styles.brandBlock, { opacity: brandO, transform: [{ translateY: brandY }] }]}>
          <Text style={styles.brandArabic}>زينلي</Text>
          <View style={styles.goldLine} />
          <Text style={styles.brandWord}>Zainly</Text>
        </Animated.View>

        {/* ── Hero title — centered ── */}
        <Animated.View style={[styles.heroBlock, { opacity: heroO, transform: [{ translateY: heroY }] }]}>
          <Text style={styles.heroTitle}>Bon retour</Text>
          <Text style={styles.heroSub}>
            {fromOnboarding
              ? 'Connecte-toi pour retrouver ton programme et accéder à ton dashboard.'
              : "Continue là où tu t'es arrêté."}
          </Text>
        </Animated.View>

        {/* ── Account deletion success banner ── */}
        {showDeletionBanner && (
          <View style={styles.deletionBanner} accessible accessibilityLabel="Compte supprimé avec succès" accessibilityRole="alert">
            <Text style={styles.deletionBannerText}>Ton compte et tes données ont bien été supprimés.</Text>
          </View>
        )}

        {/* ── Form ── */}
        <Animated.View style={[styles.formBlock, { opacity: formO, transform: [{ translateY: formY }] }]}>
          <TextInput
            style={styles.input}
            placeholder="Adresse e-mail"
            placeholderTextColor={MUTED}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <View style={styles.pwWrap}>
            <TextInput
              style={[styles.input, styles.pwInput]}
              placeholder="Mot de passe"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              editable={!loading}
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

          <TouchableOpacity onPress={() => { hapticLight(); router.push('/(auth)/reset-password'); }} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Premium verification gate — replaces the normal buttons while a
              'unlimited' parcours can't yet be confirmed premium. Never
              submitted silently as free, never blocks the login itself. ── */}
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
                style={[styles.socialBtn, { marginBottom: 0 }, isResolvingPremiumGate && styles.btnDim]}
                onPress={handlePremiumGateRestore}
                activeOpacity={0.8}
                disabled={isResolvingPremiumGate}
              >
                <Text style={styles.socialBtnText}>Restaurer mon achat</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Buttons ── */}
        {!premiumGateIssue && (
        <Animated.View style={[styles.btnsBlock, { opacity: btnsO, transform: [{ translateY: btnsY }] }]}>
          <TouchableOpacity style={[styles.primaryBtn, loading && styles.btnDim]} onPress={handleLogin} activeOpacity={0.85} disabled={loading}>
            {loading
              ? <ActivityIndicator color={BG} />
              : <Text style={styles.primaryBtnText}>Se connecter →</Text>
            }
          </TouchableOpacity>

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orLabel}>ou</Text>
            <View style={styles.orLine} />
          </View>

          <TouchableOpacity style={styles.socialBtn} onPress={handleSocial} activeOpacity={0.8}>
            <Text style={styles.socialBtnText}>Continuer avec Google</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.socialBtn, { marginBottom: 0 }]} onPress={handleSocial} activeOpacity={0.8}>
            <Text style={styles.socialBtnText}>Continuer avec Apple</Text>
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Pas encore de compte ?{'  '}</Text>
            <TouchableOpacity
              onPress={() => {
                hapticLight();
                router.push(fromOnboarding ? '/(auth)/signup?context=onboarding' : '/(auth)/signup');
              }}
              disabled={loading}
            >
              <Text style={styles.switchLink}>Créer un compte</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  container: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 48,
  },

  // ── brand ────────────────────────────────────────────────────────────────
  brandBlock: {
    alignItems: 'center',
    marginBottom: 32,
  },
  brandArabic: {
    fontFamily: F_ARABIC,
    fontSize: 28,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 34,
  },
  goldLine: {
    width: 22,
    height: 1,
    backgroundColor: GOLD,
    opacity: 0.55,
    marginTop: 5,
    marginBottom: 6,
    borderRadius: 1,
  },
  brandWord: {
    fontFamily: F_BRAND,
    fontSize: 15,
    color: GREEN,
    letterSpacing: 4,
  },

  // ── hero ─────────────────────────────────────────────────────────────────
  heroBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  heroTitle: {
    fontFamily: F_TITLE,
    fontSize: 38,
    color: TITLE_GREEN,
    lineHeight: 46,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  heroSub: {
    fontFamily: F_SUB,
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 280,
  },

  // ── form ─────────────────────────────────────────────────────────────────
  formBlock: {
    width: '100%',
    marginBottom: 8,
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
  pwWrap: { position: 'relative' },
  pwInput: { paddingRight: 80 },
  pwEye: { position: 'absolute', right: 18, top: 16 },
  pwEyeText: { fontSize: 13, color: GOLD, fontWeight: '600' },

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

  forgotRow: { alignItems: 'center', paddingVertical: 6, marginBottom: 4 },
  forgotText: { fontSize: 13, color: MUTED },

  // ── premium verification gate ───────────────────────────────────────────
  premiumGateBox: {
    width: '100%',
    backgroundColor: SURF,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
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

  // ── buttons ──────────────────────────────────────────────────────────────
  btnsBlock: { width: '100%' },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 20,
  },
  btnDim: { opacity: 0.55 },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: BG,
    letterSpacing: 0.2,
  },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  orLine: { flex: 1, height: 1, backgroundColor: BORDER },
  orLabel: { fontSize: 12, color: MUTED, letterSpacing: 0.3 },

  socialBtn: {
    backgroundColor: SURF,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  socialBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: GREEN,
  },

  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  switchText: { fontSize: 14, color: MUTED },
  switchLink: { fontSize: 14, color: TITLE_GREEN, fontWeight: '600', textDecorationLine: 'underline' },
});
