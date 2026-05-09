import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors } from '@/theme/colors';

interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

export function SecondaryButton({ label, onPress, disabled = false, style }: SecondaryButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.75 },
  label: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  labelDisabled: { color: colors.muted },
});
