import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, Animated, Easing, StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_400Regular } from '@expo-google-fonts/lora';
import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_500Medium } from '@expo-google-fonts/cinzel';
import { router } from 'expo-router';
import { supabase } from '@/db/client';

// ─── palette — same inverted luxury DA as login/signup ───────────────────────
const BG          = '#F8F4EA';
const GREEN       = '#031A12';
const TITLE_GREEN = '#031A12';
const GOLD   = '#C6A15B';
const MUTED  = '#7A6E61';
const BORDER = 'rgba(3,26,18,0.12)';
const SURF   = '#FFFFFF';

// ─── font families ───────────────────────────────────────────────────────────
const F_BRAND  = 'Cinzel_500Medium';   // brand wordmark only
const F_TITLE  = 'Lora_600SemiBold';   // hero titles — semibold for calm elegance
const F_SUB    = 'Lora_400Regular';    // elegant subtitles
const F_ARABIC = 'Amiri_700Bold';      // Arabic brand mark

export default function ResetPasswordScreen() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

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
  const btnO   = useRef(new Animated.Value(0)).current;
  const btnY   = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!fontsLoaded) return;
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(brandO, { toValue: 1, duration: 220, delay: 0,   easing: E, useNativeDriver: true }),
      Animated.timing(brandY, { toValue: 0, duration: 220, delay: 0,   easing: E, useNativeDriver: true }),
      Animated.timing(heroO,  { toValue: 1, duration: 240, delay: 60,  easing: E, useNativeDriver: true }),
      Animated.timing(heroY,  { toValue: 0, duration: 240, delay: 60,  easing: E, useNativeDriver: true }),
      Animated.timing(formO,  { toValue: 1, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(formY,  { toValue: 0, duration: 260, delay: 120, easing: E, useNativeDriver: true }),
      Animated.timing(btnO,   { toValue: 1, duration: 260, delay: 170, easing: E, useNativeDriver: true }),
      Animated.timing(btnY,   { toValue: 0, duration: 260, delay: 170, easing: E, useNativeDriver: true }),
    ]).start();
  }, [fontsLoaded]);

  async function handleReset() {
    setError(null);
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail) { setError('Saisis ton adresse e-mail.'); return; }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimEmail, {
      redirectTo: 'zainly://reset-password',
    });
    setLoading(false);
    if (resetError) { setError('Impossible d\'envoyer le lien pour le moment. Réessaie.'); return; }
    setSent(true);
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  // ─── Confirmation state ───────────────────────────────────────────────────
  if (sent) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <View style={styles.confirmedShell}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandArabic}>زينلي</Text>
            <View style={styles.goldLine} />
            <Text style={styles.brandWord}>Zainly</Text>
          </View>
          <Text style={styles.heroTitle}>Lien envoyé</Text>
          <Text style={styles.heroSub}>
            {'Vérifie ta boîte mail pour réinitialiser ton mot de passe.'}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
            <Text style={styles.backText}>← Retour à la connexion</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <View style={styles.root}>
        <View style={styles.shell}>

          {/* ── Brand lockup — centered ── */}
          <Animated.View style={[styles.brandBlock, { opacity: brandO, transform: [{ translateY: brandY }] }]}>
            <Text style={styles.brandArabic}>زينلي</Text>
            <View style={styles.goldLine} />
            <Text style={styles.brandWord}>Zainly</Text>
          </Animated.View>

          {/* ── Hero title — centered ── */}
          <Animated.View style={[styles.heroBlock, { opacity: heroO, transform: [{ translateY: heroY }] }]}>
            <Text style={styles.heroTitle}>Mot de passe oublié ?</Text>
            <Text style={styles.heroSub}>{'Entre ton e-mail, on t\'envoie un lien sécurisé.'}</Text>
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
            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </Animated.View>

          {/* ── Button ── */}
          <Animated.View style={[styles.btnsBlock, { opacity: btnO, transform: [{ translateY: btnY }] }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDim]}
              onPress={handleReset}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={BG} />
                : <Text style={styles.primaryBtnText}>Envoyer le lien</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
              <Text style={styles.backText}>← Retour à la connexion</Text>
            </TouchableOpacity>
          </Animated.View>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  shell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 48,
  },
  confirmedShell: {
    paddingHorizontal: 28,
    paddingTop: 56,
    alignItems: 'center',
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

  backRow: { alignItems: 'center', paddingVertical: 8 },
  backText: { fontSize: 14, color: MUTED },
});
