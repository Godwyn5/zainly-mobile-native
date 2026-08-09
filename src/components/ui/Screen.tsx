import { ReactNode } from 'react';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_GAP, TAB_BAR_BREATHING_ROOM } from '@/theme/tabBar';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  onLayout?: (event: { nativeEvent: { layout: { width: number; height: number; x: number; y: number } } }) => void;
}

export function Screen({ children, scroll = true, contentStyle, onLayout }: ScreenProps) {
  const insets = useSafeAreaInsets();
  // Total clearance needed: pill height + inset + gap + breathing room
  const bottomPad = TAB_BAR_HEIGHT + Math.max(insets.bottom, TAB_BAR_BOTTOM_GAP) + TAB_BAR_BOTTOM_GAP + TAB_BAR_BREATHING_ROOM;

  if (scroll) {
    // Flatten contentStyle so we can extract any caller-provided paddingBottom,
    // then guarantee the final paddingBottom is at least bottomPad.
    const flat = StyleSheet.flatten(contentStyle) ?? {};
    const callerPb = typeof flat.paddingBottom === 'number' ? flat.paddingBottom : 0;
    const safePb = Math.max(callerPb, bottomPad);
    const mergedContent: ViewStyle = { ...styles.content, ...flat, paddingBottom: safePb };

    return (
      <SafeAreaView style={styles.safe} onLayout={onLayout}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={mergedContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  // No-scroll: still need padding for the floating pill tab bar.
  // SafeAreaView handles device insets (notch/home bar) but not the
  // custom floating tab bar, so we add bottomPad manually.
  // noScrollStyle is placed last so bottomPad cannot be overridden by contentStyle.
  // The floating tab bar clearance must always be preserved for no-scroll screens.
  const noScrollStyle: ViewStyle = { paddingBottom: bottomPad };
  return (
    <SafeAreaView style={[styles.safe, styles.content, contentStyle, noScrollStyle]} onLayout={onLayout}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
