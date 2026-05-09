import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function TodayScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>السلام عليكم</Text>
        <Text style={styles.name}>Aujourd'hui</Text>
      </View>

      {/* Programme du jour — placeholder */}
      <View style={styles.card}>
        <Text style={styles.cardBadge}>TON PROGRAMME DU JOUR</Text>
        <Text style={styles.cardTitle}>Al-Fatiha</Text>
        <Text style={styles.cardSub}>Ayat 1 — 2 ayats à mémoriser</Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push('/(app)/session')}
        >
          <Text style={styles.ctaText}>Commencer la session</Text>
        </TouchableOpacity>
      </View>

      {/* Streak placeholder */}
      <View style={styles.card}>
        <Text style={styles.cardBadge}>SÉRIE</Text>
        <Text style={styles.cardTitle}>0 jour</Text>
        <Text style={styles.cardSub}>Continue chaque jour pour progresser.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg, marginTop: 16 },
  greeting: { fontSize: 22, color: colors.gold, marginBottom: 4 },
  name: { fontSize: 28, fontWeight: '700', color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
  },
  cardSub: { fontSize: 13, color: colors.muted, marginBottom: 20 },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: { color: colors.surface, fontSize: 15, fontWeight: '600' },
});
