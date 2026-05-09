import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function SettingsScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.badge}>COMPTE</Text>
      <Text style={styles.title}>Réglages</Text>

      {/* TODO: rythme picker, programme rebuild, account, logout */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mon programme</Text>
        <TouchableOpacity style={styles.row}>
          <Text style={styles.rowText}>Changer mon rythme</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.row, styles.rowLast]}>
          <Text style={styles.rowText}>Reconstruire mon programme</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Compte</Text>
        <TouchableOpacity style={styles.row}>
          <Text style={styles.rowText}>Premium</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.row, styles.rowLast]}>
          <Text style={[styles.rowText, { color: colors.danger }]}>Se déconnecter</Text>
        </TouchableOpacity>
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
  title: { fontSize: 32, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.muted,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLast: {},
  rowText: { fontSize: 15, color: colors.text },
  rowChevron: { fontSize: 18, color: colors.muted },
});
