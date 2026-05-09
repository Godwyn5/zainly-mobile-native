import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { SecondaryButton } from './SecondaryButton';

interface EmptyStateProps {
  title: string;
  description: string;
  buttonLabel?: string;
  onPress?: () => void;
}

export function EmptyState({ title, description, buttonLabel, onPress }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {buttonLabel && onPress && (
        <SecondaryButton label={buttonLabel} onPress={onPress} style={styles.btn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  btn: { width: '100%' },
});
