import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';

export default function OnboardingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>ONBOARDING</Text>
      <Text style={styles.title}>Bienvenue dans Zainly</Text>
      <Text style={styles.subtitle}>
        Crée ton programme de mémorisation personnalisé. Dis-nous où tu en es.
      </Text>

      {/* TODO: multi-step onboarding — planMode, knownSurahs, rhythm */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Onboarding — à implémenter</Text>
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
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 12,
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.primary, marginBottom: 10 },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 22, marginBottom: 32 },
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
  },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
});
