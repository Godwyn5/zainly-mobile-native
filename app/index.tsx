// ─── TECHNICAL PLACEHOLDER SCREEN ─────────────────────────────────────────────
// No visible text, button, card or legacy interface. This is only a neutral
// background rendered by Expo Router for the root `/` route until the new
// Welcome + Auth experience is built. Routing is controlled by app/_layout.tsx.

import { View, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';

export default function IndexPlaceholderScreen() {
  return <View style={styles.root} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
