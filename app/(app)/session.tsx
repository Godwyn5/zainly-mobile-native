import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';

export default function SessionScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>SESSION</Text>
      <Text style={styles.title}>Ta session du jour</Text>
      <Text style={styles.subtitle}>
        Mémorisation + révisions. La logique de session sera implémentée ici.
      </Text>

      {/* TODO: session flow — review loop, memorization, final test */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Session — à implémenter</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/done')}>
        <Text style={styles.buttonText}>Terminer (placeholder)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.back}
        onPress={() => router.back()}
      >
        <Text style={styles.backText}>Annuler</Text>
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
    marginBottom: 12,
  },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '600' },
  back: { alignItems: 'center', paddingVertical: 12 },
  backText: { color: colors.muted, fontSize: 14 },
});
