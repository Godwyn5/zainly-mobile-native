import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/db/client';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function ResetPasswordScreen() {
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]     = useState(false);

  async function handleReset() {
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail) {
      Alert.alert('E-mail manquant', 'Saisis ton adresse e-mail.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimEmail, {
      redirectTo: 'zainly://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert('Erreur', error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.badge}>COMPTE</Text>
        <Text style={styles.title}>E-mail envoyé</Text>
        <Text style={styles.subtitle}>
          Consulte ta boîte mail pour réinitialiser ton mot de passe.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Retour à la connexion</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.badge}>COMPTE</Text>
        <Text style={styles.title}>Mot de passe oublié</Text>
        <Text style={styles.subtitle}>
          Saisis ton adresse e-mail pour recevoir un lien de réinitialisation.
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

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleReset}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.surface} />
            : <Text style={styles.buttonText}>Envoyer le lien</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Retour à la connexion</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
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
    marginBottom: 10,
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
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  back: { alignItems: 'center', paddingVertical: 8 },
  backText: { color: colors.primary, fontSize: 14 },
});
