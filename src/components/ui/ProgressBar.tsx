import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/colors';

type ProgressBarVariant = 'primary' | 'gold';

interface ProgressBarProps {
  progress: number;
  variant?: ProgressBarVariant;
}

export function ProgressBar({ progress, variant = 'primary' }: ProgressBarProps) {
  const pct = Math.min(Math.max(progress, 0), 1);
  const fillColor = variant === 'gold' ? colors.gold : colors.primary;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: fillColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 5,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 5,
    borderRadius: 4,
  },
});
