import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

interface ListRowProps {
  title: string;
  subtitle?: string;
  destructive?: boolean;
  chevron?: boolean;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  topBorder?: boolean;
}

export function ListRow({
  title,
  subtitle,
  destructive = false,
  chevron = true,
  onPress,
  loading = false,
  disabled = false,
  topBorder = true,
}: ListRowProps) {
  const titleColor = destructive ? colors.danger : colors.text;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        topBorder && styles.topBorder,
        (disabled || loading) && styles.rowDisabled,
        pressed && !disabled && !loading && styles.rowPressed,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={styles.content}>
        {loading
          ? <ActivityIndicator color={titleColor} size="small" />
          : <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        }
        {subtitle && !loading && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>
      {chevron && !loading && (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  topBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowDisabled: { opacity: 0.5 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  content: { flex: 1 },
  title: { fontSize: 15, fontWeight: '500', color: colors.text },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 20, color: colors.muted, marginLeft: 8 },
});
