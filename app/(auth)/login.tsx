import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/db/client';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Mode = 'password' | 'magic';

export default function LoginScreen() {
  const [mode, setMode]         = useState<Mode>('password');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  async function handlePasswordLogin() {
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) {
      Alert.alert('Champs manquants', 'Saisis ton e-mail et ton mot de passe.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimEmail,
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert('Erreur de connexion', error.message);
      return;
    }
    router.replace('/(app)/(tabs)/');
  }

  async function handleMagicLink() {
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail) {
      Alert.alert('E-mail manquant', 'Saisis ton adresse e-mail.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimEmail,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      Alert.alert('Erreur', error.message);
      return;
    }
    setMagicSent(true);
  }

  if (magicSent) {
    return (
      <View style={styles.container}>
        <Text style={styles.badge}>CONNEXION</Text>
        <Text style={styles.title}>Vérifie ta boîte mail</Text>
        <Text style={styles.subtitle}>
          Un lien de connexion a été envoyé à{'\n'}<Text style={{ color: colors.primary, fontWeight: '600' }}>{email.trim()}</Text>
        </Text>
        <TouchableOpacity onPress={() => setMagicSent(false)} style={styles.link}>
          <Text style={styles.linkText}>← Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.badge}>CONNEXION</Text>
        <Text style={styles.title}>Connexion</Text>
        <Text style={styles.subtitle}>Accède à ton programme de mémorisation.</Text>

        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'password' && styles.modeBtnActive]}
            onPress={() => setMode('password')}
          >
            <Text style={[styles.modeBtnText, mode === 'password' && styles.modeBtnTextActive]}>
              Mot de passe
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'magic' && styles.modeBtnActive]}
            onPress={() => setMode('magic')}
          >
            <Text style={[styles.modeBtnText, mode === 'magic' && styles.modeBtnTextActive]}>
              Lien magique
            </Text>
          </TouchableOpacity>
        </View>

        {/* Email */}
        <Text style={styles.label}>Adresse e-mail</Text>
        <TextInput
          style={styles.input}
          placeholder="ton@email.com"
          placeholderTextColor={colors.muted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

        {/* Password — only in password mode */}
        {mode === 'password' && (
          <>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />
          </>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={mode === 'password' ? handlePasswordLogin : handleMagicLink}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.surface} />
            : <Text style={styles.buttonText}>
                {mode === 'password' ? 'Se connecter' : 'Envoyer le lien'}
              </Text>
          }
        </TouchableOpacity>

        {/* Reset password */}
        {mode === 'password' && (
          <TouchableOpacity
            onPress={() => router.push('/(auth)/reset-password')}
            style={styles.link}
          >
            <Text style={styles.linkText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 48,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
    marginBottom: 32,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    padding: 3,
    marginBottom: 28,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeBtnText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  modeBtnTextActive: { color: colors.primary, fontWeight: '600' },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.primary, fontSize: 14 },
});
