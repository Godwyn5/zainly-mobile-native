import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated, Easing, StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/db/client';
import {
  beginOnboardingTransition,
  setTransitionUserId,
  runOnboardingTransition,
  type OnboardingTransitionResult,
} from '@/lib/onboardingTransition';
import { forceReleaseTransitionLease, type SignupVisualSnapshot } from '@/lib/transitionLease';
import { hapticLight, hapticMedium, hapticSelection } from '@/utils/haptics';
import ZainlyLogo from '@/components/auth/ZainlyLogo';
import { SignupSurface, type SignupAnimValues } from '@/components/auth/SignupSurface';

// ─── palette — matches Splash/Welcome identity ───────────────────────────────
const BG = '#F7F2E7';              // cream (from Welcome)
const GREEN = '#163026';          // deep green (from Welcome)
const GOLD = '#C6A15B';           // gold (from Welcome)
const MUTED = '#7A6E61';          // warm grey for subtitles/placeholders
const BORDER = 'rgba(22,48,38,0.12)'; // subtle green-tinted border
const SURF = '#FFFFFF';          // white for inputs

function friendlySignupError(msg: string): string {
  if (msg.includes('Network request failed') || msg.includes('fetch'))
    return 'Impossible de contacter le serveur. Vérifie ta connexion internet.';
  if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('User already registered'))
    return 'Un compte existe déjà avec cet e-mail.';
  if (msg.includes('weak_password') || msg.includes('Password should be'))
    return 'Choisis un mot de passe plus sécurisé.';
  return 'Création du compte impossible pour le moment.';
}

export default function SignupEmailScreen() {
  const { context, flowId: flowIdParam } = useLocalSearchParams<{ context?: string; flowId?: string }>();
  const fromOnboarding = context === 'onboarding';
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<OnboardingTransitionResult | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const leaseIdRef = useRef<string | null>(null);

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
  const confirmInputRef = useRef<TextInput>(null);

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

  // ── Cleanup: force-release any lingering lease on unmount ──
  useEffect(() => {
    return () => {
      if (leaseIdRef.current) {
        forceReleaseTransitionLease();
        leaseIdRef.current = null;
      }
    };
  }, []);

  async function handleSignup() {
    if (loading) return;
    setError(null);
    setTransitionError(null);
    hapticMedium();
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail) { setError('Saisis ton adresse e-mail.'); return; }
    if (!password) { setError('Choisis un mot de passe.'); return; }
    if (password.length < 6) { setError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setLoading(true);

    // ── Onboarding transition: create lease BEFORE signUp ──
    // The lease prevents Stack.Protected from swapping route groups when
    // the session is created. The signup screen stays mounted while we run
    // finalize+handoff+clear+verify, then release the lease.
    if (fromOnboarding && flowIdParam) {
      try {
        leaseIdRef.current = beginOnboardingTransition(flowIdParam);
      } catch {
        // A lease is already active (double-tap) — ignore.
        setLoading(false);
        return;
      }
    }

    const { data, error: signupError } = await supabase.auth.signUp({ email: trimEmail, password });
    if (signupError) {
      if (leaseIdRef.current) {
        forceReleaseTransitionLease();
        leaseIdRef.current = null;
      }
      setLoading(false);
      setError(friendlySignupError(signupError.message));
      return;
    }

    if (data.session) {
      // ── Onboarding transition: finalize+handoff+clear+verify ──
      if (leaseIdRef.current && fromOnboarding && flowIdParam) {
        const userId = data.session.user.id;
        const sessionGen = data.session.access_token?.slice(-16) ?? `${Date.now()}-${userId.slice(-8)}`;
        setTransitionUserId(userId);
        const visual: SignupVisualSnapshot = {
          surfaceType: 'signup',
          email: trimEmail,
          password,
          confirm,
          showPw,
          showConfirm,
        };
        const result = await runOnboardingTransition(queryClient, userId, leaseIdRef.current, sessionGen, visual);
        leaseIdRef.current = null;
        if (result.status === 'error') {
          setTransitionError(result);
          setLoading(false);
          return;
        }
        // Success — lease transitioned to DATA_READY_COVERED. The root
        // layout will show the cover overlay until the dashboard signals.
        // Keep loading true until unmount.
        return;
      }
      // Non-onboarding signup with immediate session — Stack.Protected will
      // redirect to (app) automatically. Keep loading true until unmount.
      return;
    }

    if (leaseIdRef.current) {
      forceReleaseTransitionLease();
      leaseIdRef.current = null;
    }
    setLoading(false);
    setEmailSent(true);
  }

  async function retryTransition() {
    if (!leaseIdRef.current || !flowIdParam) return;
    setTransitionError(null);
    setLoading(true);
    // Re-create the lease for the retry
    try {
      leaseIdRef.current = beginOnboardingTransition(flowIdParam);
    } catch {
      setLoading(false);
      return;
    }
    // Re-signUp is not needed — the session already exists. We need the
    // userId from the current session.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      forceReleaseTransitionLease();
      leaseIdRef.current = null;
      setLoading(false);
      setError('Session expirée. Reconnecte-toi.');
      return;
    }
    const userId = session.user.id;
    const sessionGen = session.access_token?.slice(-16) ?? `${Date.now()}-${userId.slice(-8)}`;
    setTransitionUserId(userId);
    const visual: SignupVisualSnapshot = {
      surfaceType: 'signup',
      email,
      password,
      confirm,
      showPw,
      showConfirm,
    };
    const result = await runOnboardingTransition(queryClient, userId, leaseIdRef.current, sessionGen, visual);
    leaseIdRef.current = null;
    if (result.status === 'error') {
      setTransitionError(result);
      setLoading(false);
    }
    // Success — lease released, route swap happens.
  }

  function handleBack() {
    hapticLight();
    router.back();
  }

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  // ─── Transition error state ──────────────────────────────────────────────
  // When finalize/handoff/clear fails, show a stable error on the same
  // screen — the dashboard is never exposed with incomplete data.
  if (transitionError && transitionError.status === 'error') {
    const err = transitionError.error;
    let title = 'Impossible de finaliser ton programme';
    let desc = "Ton programme n'a pas été perdu. Vérifie ta connexion puis réessaie.";
    if (err.kind === 'premium_entitlement_missing') {
      title = 'Abonnement Zainly+ requis';
      desc = "Ce parcours nécessite un abonnement Zainly+ actif. Restaure ton achat ou réessaie.";
    } else if (err.kind === 'premium_sync_failed') {
      title = "Vérification de l'abonnement impossible";
      desc = "Impossible de vérifier ton abonnement Zainly+. Réessaie.";
    } else if (err.kind === 'handoff_error') {
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
          <TouchableOpacity onPress={retryTransition} style={styles.retryButton} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.primaryBtnText}>Réessayer</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Email confirmation state ─────────────────────────────────────────────
  if (emailSent) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <View style={styles.confirmedShell}>
          <ZainlyLogo />
          <Text style={styles.title}>Compte créé</Text>
          <Text style={styles.subtitle}>
            Consulte ton e-mail pour confirmer ton inscription avant de te connecter.
          </Text>
          <TouchableOpacity onPress={handleBack} style={styles.simpleBackButton}>
            <Text style={styles.simpleBackButtonText}>← Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const animValues: SignupAnimValues = {
    logoO, logoY, titleO, titleY, formO, formY, btnsO, btnsY,
  };

  return (
    <SignupSurface
      email={email}
      password={password}
      confirm={confirm}
      showPw={showPw}
      showConfirm={showConfirm}
      loading={loading}
      error={error}
      emailFocused={emailFocused}
      passwordFocused={passwordFocused}
      confirmFocused={confirmFocused}
      anim={animValues}
      passwordInputRef={passwordInputRef}
      confirmInputRef={confirmInputRef}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onConfirmChange={setConfirm}
      onSignup={handleSignup}
      onEmailFocus={() => setEmailFocused(true)}
      onEmailBlur={() => setEmailFocused(false)}
      onPasswordFocus={() => setPasswordFocused(true)}
      onPasswordBlur={() => setPasswordFocused(false)}
      onConfirmFocus={() => setConfirmFocused(true)}
      onConfirmBlur={() => setConfirmFocused(false)}
      onToggleShowPw={() => { hapticSelection(); setShowPw(v => !v); }}
      onToggleShowConfirm={() => { hapticSelection(); setShowConfirm(v => !v); }}
    />
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
  confirmedShell: {
    paddingHorizontal: 28,
    paddingTop: 72,
    alignItems: 'center',
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
  subtitle: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 280,
    marginBottom: 32,
  },
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
  simpleBackButton: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 24,
  },
  simpleBackButtonText: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '500',
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
});
