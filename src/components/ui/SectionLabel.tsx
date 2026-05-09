import { StyleSheet, Text, TextStyle } from 'react-native';
import { colors } from '@/theme/colors';

interface SectionLabelProps {
  text: string;
  style?: TextStyle;
}

export function SectionLabel({ text, style }: SectionLabelProps) {
  return (
    <Text style={[styles.label, style]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
});
