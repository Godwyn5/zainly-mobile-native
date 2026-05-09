import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';
import { useAuthStore } from '@/store/authStore';

export default function SplashScreen() {
  const { session, ready } = useAuthStore();

  useEffect(() => {
    if (!ready) return;
    if (session) {
      router.replace('/(app)/(tabs)');
    }
  }, [ready, session]);

  if (!ready || session) {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>زينلي</Text>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>زينلي</Text>
      <Text style={styles.title}>Zainly</Text>
      <Text style={styles.subtitle}>Mémorise le Coran, un ayat à la fois.</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/(auth)/login')}
      >
        <Text style={styles.buttonText}>Commencer</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontSize: 64,
    color: colors.gold,
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 48,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
