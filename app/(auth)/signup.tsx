import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/db/client';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

function friendlySignupError(message: string): string {
  if (message.includes('Network request failed') || message.includes('fetch')) {
    return 'Impossible de contacter le serveur. Vérifie ta connexion internet.';
  }
  if (message.includes('already registered') || message.includes('already been registered') || message.includes('User already registered')) {
    return 'Un compte existe déjà avec cet e-mail.';
  }
  if (message.includes('weak_password') || message.includes('Password should be')) {
    return 'Choisis un mot de passe plus sécurisé.';
  }
  return 'Création du compte impossible pour le moment.';
}

export default function SignupScreen() {
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [confirm, setConfirm]           = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [emailSent, setEmailSent]       = useState(false);

  async function handleSignup() {
    setError(null);
    const trimEmail = email.trim().toLowerCase();

    if (!trimEmail) {
      setError('Saisis ton adresse e-mail.');
      return;
    }
    if (!password) {
      setError('Choisis un mot de passe.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    const { data, error: signupError } = await supabase.auth.signUp({
      email: trimEmail,
      password,
    });
    setLoading(false);

    if (signupError) {
      setError(friendlySignupError(signupError.message));
      return;
    }

    if (data.session) {
      router.replace('/onboarding');
      return;
    }

    setEmailSent(true);
  }

  if (emailSent) {
    return (
      <View style={styles.container}>
        <Text style={styles.badge}>INSCRIPTION</Text>
        <Text style={styles.title}>Vérifie ta boîte mail</Text>
        <Text style={styles.subtitle}>
          Compte créé. Vérifie ton e-mail pour confirmer ton inscription avant de te connecter.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          style={styles.link}
        >
          <Text style={styles.linkText}>← Retour à la connexion</Text>
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
        <Text style={styles.badge}>INSCRIPTION</Text>
        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.subtitle}>
          Commence ton programme de mémorisation avec Zainly.
        </Text>

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

        <Text style={styles.label}>Mot de passe</Text>
        <TextInput
          style={styles.input}
          placeholder="6 caractères minimum"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />

        <Text style={styles.label}>Confirmer le mot de passe</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          editable={!loading}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.surface} />
            : <Text style={styles.buttonText}>Créer mon compte</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          style={styles.link}
          disabled={loading}
        >
          <Text style={styles.linkText}>J'ai déjà un compte</Text>
        </TouchableOpacity>
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
  errorBox: {
    backgroundColor: '#FEE9E7',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
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
