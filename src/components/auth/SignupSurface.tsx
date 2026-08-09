import { useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
  Animated, StatusBar,
} from 'react-native';
import ZainlyLogo from '@/components/auth/ZainlyLogo';

const BG = '#F7F2E7';
const GREEN = '#163026';
const GOLD = '#C6A15B';
const MUTED = '#7A6E61';
const BORDER = 'rgba(22,48,38,0.12)';
const SURF = '#FFFFFF';

export interface SignupAnimValues {
  logoO: Animated.Value;
  logoY: Animated.Value;
  titleO: Animated.Value;
  titleY: Animated.Value;
  formO: Animated.Value;
  formY: Animated.Value;
  btnsO: Animated.Value;
  btnsY: Animated.Value;
}

export interface SignupSurfaceProps {
  email: string;
  password: string;
  confirm: string;
  showPw: boolean;
  showConfirm: boolean;
  loading: boolean;
  error: string | null;
  emailFocused: boolean;
  passwordFocused: boolean;
  confirmFocused: boolean;
  anim?: SignupAnimValues;
  passwordInputRef?: React.RefObject<TextInput | null>;
  confirmInputRef?: React.RefObject<TextInput | null>;
  onEmailChange?: (text: string) => void;
  onPasswordChange?: (text: string) => void;
  onConfirmChange?: (text: string) => void;
  onSignup?: () => void;
  onEmailFocus?: () => void;
  onEmailBlur?: () => void;
  onPasswordFocus?: () => void;
  onPasswordBlur?: () => void;
  onConfirmFocus?: () => void;
  onConfirmBlur?: () => void;
  onToggleShowPw?: () => void;
  onToggleShowConfirm?: () => void;
}

export function SignupSurface(props: SignupSurfaceProps) {
  const {
    email, password, confirm, showPw, showConfirm, loading, error,
    emailFocused, passwordFocused, confirmFocused,
    anim, passwordInputRef, confirmInputRef,
    onEmailChange, onPasswordChange, onConfirmChange, onSignup,
    onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
    onConfirmFocus, onConfirmBlur, onToggleShowPw, onToggleShowConfirm,
  } = props;

  const staticAnim = useMemo<SignupAnimValues>(() => ({
    logoO: new Animated.Value(1),
    logoY: new Animated.Value(0),
    titleO: new Animated.Value(1),
    titleY: new Animated.Value(0),
    formO: new Animated.Value(1),
    formY: new Animated.Value(0),
    btnsO: new Animated.Value(1),
    btnsY: new Animated.Value(0),
  }), []);

  const a = anim ?? staticAnim;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <ScrollView style={styles.root} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        <View style={styles.decorativeShape} pointerEvents="none" />

        <Animated.View style={[styles.logoBlock, { opacity: a.logoO, transform: [{ translateY: a.logoY }] }]}>
          <ZainlyLogo />
        </Animated.View>

        <Animated.View style={[styles.titleBlock, { opacity: a.titleO, transform: [{ translateY: a.titleY }] }]}>
          <Text style={styles.title}>Crée ton compte</Text>
        </Animated.View>

        <Animated.View style={[styles.formBlock, { opacity: a.formO, transform: [{ translateY: a.formY }] }]}>
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            placeholder="Adresse e-mail"
            placeholderTextColor={MUTED}
            value={email}
            onChangeText={onEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            onFocus={onEmailFocus}
            onBlur={onEmailBlur}
            returnKeyType="next"
            onSubmitEditing={() => { passwordInputRef?.current?.focus(); }}
          />

          <View style={styles.pwWrap}>
            <TextInput
              ref={passwordInputRef}
              style={[styles.input, styles.pwInput, passwordFocused && styles.inputFocused]}
              placeholder="Mot de passe (6 caractères min.)"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry={!showPw}
              editable={!loading}
              onFocus={onPasswordFocus}
              onBlur={onPasswordBlur}
              returnKeyType="next"
              onSubmitEditing={() => { confirmInputRef?.current?.focus(); }}
            />
            <TouchableOpacity style={styles.pwEye} onPress={onToggleShowPw} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pwEyeText}>{showPw ? 'Masquer' : 'Voir'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pwWrap}>
            <TextInput
              ref={confirmInputRef}
              style={[styles.input, styles.pwInput, confirmFocused && styles.inputFocused]}
              placeholder="Confirmer le mot de passe"
              placeholderTextColor={MUTED}
              value={confirm}
              onChangeText={onConfirmChange}
              secureTextEntry={!showConfirm}
              editable={!loading}
              onFocus={onConfirmFocus}
              onBlur={onConfirmBlur}
              returnKeyType="done"
              onSubmitEditing={onSignup}
            />
            <TouchableOpacity style={styles.pwEye} onPress={onToggleShowConfirm} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pwEyeText}>{showConfirm ? 'Masquer' : 'Voir'}</Text>
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </Animated.View>

        <Animated.View style={[styles.btnsBlock, { opacity: a.btnsO, transform: [{ translateY: a.btnsY }] }]}>
          <TouchableOpacity style={[styles.primaryBtn, loading && styles.btnDim]} onPress={onSignup} activeOpacity={0.85} disabled={loading}>
            {loading ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator color={BG} />
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Créer mon compte</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

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
    fontSize: 36,
    color: GREEN,
    lineHeight: 44,
    textAlign: 'center',
    letterSpacing: -0.3,
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
});
