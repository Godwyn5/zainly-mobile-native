import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

type ChipVariant = 'premium' | 'free' | 'success' | 'muted' | 'warning';

interface StatusChipProps {
  label: string;
  variant?: ChipVariant;
}

const variantStyles: Record<ChipVariant, { bg: string; border: string; text: string }> = {
  premium:  { bg: colors.goldSoft,     border: colors.gold,    text: colors.gold },
  free:     { bg: colors.surface,      border: colors.border,  text: colors.muted },
  success:  { bg: '#E6F4EC',           border: colors.success, text: colors.success },
  muted:    { bg: colors.surfaceMuted, border: colors.border,  text: colors.muted },
  warning:  { bg: '#FEF3CD',           border: '#D4A017',      text: '#7A5A00' },
};

export function StatusChip({ label, variant = 'free' }: StatusChipProps) {
  const v = variantStyles[variant];
  return (
    <View style={[styles.chip, { backgroundColor: v.bg, borderColor: v.border }]}>
      <Text style={[styles.label, { color: v.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
