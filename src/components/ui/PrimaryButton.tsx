import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors } from '@/theme/colors';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function PrimaryButton({ label, onPress, loading = false, disabled = false, style }: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        isDisabled && styles.btnDisabled,
        pressed && !isDisabled && styles.btnPressed,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading
        ? <ActivityIndicator color={colors.surface} size="small" />
        : <Text style={styles.label}>{label}</Text>
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnDisabled: { backgroundColor: colors.disabled },
  btnPressed: { opacity: 0.85 },
  label: { color: colors.surface, fontSize: 16, fontWeight: '600' },
});
