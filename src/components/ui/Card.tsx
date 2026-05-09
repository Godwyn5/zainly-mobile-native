import { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
});
