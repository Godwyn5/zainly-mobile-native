import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

interface StatPillProps {
  value: string;
  label: string;
}

export function StatPill({ value, label }: StatPillProps) {
  return (
    <View style={styles.pill}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flex: 1, alignItems: 'center' },
  value: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  label: { fontSize: 11, color: colors.muted },
});
