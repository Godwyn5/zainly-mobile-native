import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { usePlan } from '@/hooks/usePlan';
import { colors } from '@/theme/colors';

export default function OnboardingScreen() {
  const { user, ready } = useAuthStore();
  const { data: plan, isLoading: planLoading } = usePlan(user?.id);
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  // Read AsyncStorage once user is known
  useEffect(() => {
    if (!user?.id) return;
    const key = `zainly:onboardingIntroSeen:${user.id}`;
    AsyncStorage.getItem(key)
      .then(val => setIntroSeen(val === 'true'))
      .catch(() => setIntroSeen(false));
  }, [user?.id]);

  const isLoading = !ready || planLoading || (!!user?.id && introSeen === null);

  useEffect(() => {
    if (!ready) return;
    if (!user) { router.replace('/(auth)/login'); return; }
    if (isLoading) return;
    if (plan) { router.replace('/(app)/(tabs)'); return; }
    if (!introSeen) { router.replace('/onboarding/intro'); }
  }, [ready, user, isLoading, plan, introSeen]);

  if (isLoading || plan || !introSeen) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Préparation de ton programme…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>TON PROGRAMME</Text>
      <Text style={styles.title}>Créons ton{'\n'}programme.</Text>
      <Text style={styles.subtitle}>
        Quelques questions pour calibrer ton Hifz et te donner un plan sur-mesure.
      </Text>

      {/* TODO: multi-step onboarding — planMode, knownSurahs, rhythm */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Questionnaire — à implémenter</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/(app)/(tabs)/')}
      >
        <Text style={styles.buttonText}>Continuer (placeholder)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 64 : 44,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 14,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
    lineHeight: 44,
    marginBottom: 12,
  },
  subtitle: { fontSize: 15, color: colors.muted, lineHeight: 24, marginBottom: 32 },
  placeholder: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  placeholderText: { fontSize: 14, color: colors.muted },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: Platform.OS === 'ios' ? 48 : 32,
  },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.2,
  },
});
