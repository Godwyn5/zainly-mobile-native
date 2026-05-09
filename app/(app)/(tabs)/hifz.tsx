import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function HifzScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.badge}>BIBLIOTHÈQUE</Text>
      <Text style={styles.title}>Mon Hifz</Text>
      <Text style={styles.subtitle}>Les sourates que tu as mémorisées.</Text>

      {/* TODO: surah list with status chips */}
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Ta bibliothèque de mémorisation apparaîtra ici.</Text>
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
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
