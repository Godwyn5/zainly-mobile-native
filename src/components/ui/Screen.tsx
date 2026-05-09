import { ReactNode } from 'react';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
  if (scroll) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[styles.safe, styles.content, contentStyle]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    paddingTop: spacing.md,
  },
});
