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
import { router } from 'expo-router';
import { supabase } from '@/db/client';

// ─── palette — inverted from entry: ivory bg, deep green text ───────────────
const BG       = '#F8F4EA';          // warm ivory (entry IVORY)
const GREEN    = '#031A12';          // deep green (entry BG)
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
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

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

  async function handleLogin() {
    setError(null);
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) { setError('Saisis ton e-mail et ton mot de passe.'); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: trimEmail, password });
    setLoading(false);
    if (authError) { setError(friendlyAuthError(authError.message)); return; }
    router.replace('/(app)/(tabs)/');
  }

  function handleSocial() {
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
          <Text style={styles.heroSub}>Continue là où tu t'es arrêté.</Text>
        </Animated.View>

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
            <TouchableOpacity style={styles.pwEye} onPress={() => setShowPw(v => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pwEyeText}>{showPw ? 'Masquer' : 'Voir'}</Text>
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity onPress={() => router.push('/(auth)/reset-password')} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Buttons ── */}
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
            <TouchableOpacity onPress={() => router.push('/(auth)/signup')} disabled={loading}>
              <Text style={styles.switchLink}>Créer un compte</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

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
    color: GREEN,
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

  forgotRow: { alignItems: 'center', paddingVertical: 6, marginBottom: 4 },
  forgotText: { fontSize: 13, color: MUTED },

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
  switchLink: { fontSize: 14, color: GREEN, fontWeight: '600', textDecorationLine: 'underline' },
});
