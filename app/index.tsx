// ─── TEMPORARY ENTRY SCREEN ─────────────────────────────────────────────────
// This is a minimal technical placeholder used while the Bienvenue + Auth +
// Onboarding experience is rebuilt from scratch. It is not the new design.
// Authenticated users with an existing session are redirected to the dashboard.
// All other cases see this screen.

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme/colors';

export default function EntryPlaceholderScreen() {
  const { session, ready } = useAuthStore();

  useEffect(() => {
    if (ready && session?.user) {
      router.replace('/(app)');
    }
  }, [ready, session]);

  if (ready && session?.user) {
    return null;
  }

  return (
    <View style={styles.root}>
      <Text style={styles.text}>Nouvelle expérience en construction</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
