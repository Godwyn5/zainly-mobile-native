import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';

export default function RevisionScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>RÉVISION</Text>
      <Text style={styles.title}>Révision</Text>
      <Text style={styles.subtitle}>
        Passe en revue les ayats dus aujourd'hui selon le calendrier SRS.
      </Text>

      {/* TODO: SRS review loop */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Révision SRS — à implémenter</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/done')}>
        <Text style={styles.buttonText}>Terminer (placeholder)</Text>
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
  title: { fontSize: 28, fontWeight: '700', color: colors.primary, marginBottom: 10 },
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
