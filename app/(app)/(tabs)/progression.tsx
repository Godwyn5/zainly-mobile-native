import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function ProgressionScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.badge}>STATS</Text>
      <Text style={styles.title}>Progression</Text>
      <Text style={styles.subtitle}>Ton avancement dans la mémorisation.</Text>

      {/* TODO: total memorized, streak history, revision scores */}
      <View style={styles.card}>
        <Text style={styles.cardBadge}>TOTAL MÉMORISÉ</Text>
        <Text style={styles.stat}>0 / 6 236 ayats</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardBadge}>MEILLEURE SÉRIE</Text>
        <Text style={styles.stat}>0 jour</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, paddingBottom: 40, paddingTop: 60 },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 8,
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.primary, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    marginBottom: 8,
  },
  stat: { fontSize: 24, fontWeight: '700', color: colors.primary },
});
