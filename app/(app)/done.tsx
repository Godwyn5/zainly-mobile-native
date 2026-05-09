import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';

export default function DoneScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.check}>✓</Text>
      <Text style={styles.badge}>SESSION</Text>
      <Text style={styles.title}>Session terminée</Text>
      <Text style={styles.subtitle}>
        Tu as avancé aujourd'hui. Reviens demain pour consolider et continuer.
      </Text>

      {/* TODO: session summary — new ayats, revised, streak, due tomorrow */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Résumé de session — à implémenter</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/(app)/(tabs)/')}
      >
        <Text style={styles.buttonText}>Retour au tableau de bord</Text>
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
    alignItems: 'center',
  },
  check: {
    fontSize: 56,
    color: colors.success,
    marginBottom: 16,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 22,
    marginBottom: 32,
    textAlign: 'center',
  },
  placeholder: {
    width: '100%',
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
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
});
