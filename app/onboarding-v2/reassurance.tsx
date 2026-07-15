import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

// ─── DEPRECATED / UNUSED ROUTE ──────────────────────────────────────────────
// Superseded by the real, content-specific reassurance screens:
// motivation-reassurance.tsx and learning-mode-reassurance.tsx. Nothing in
// the app links here anymore. Kept only as a defensive redirect (never a
// blank/placeholder screen) in case a stale deep link or cached navigation
// state ever points at this route.
const SPLASH_BEIGE = '#F7F2E7';

export default function OnboardingReassuranceScreen() {
  useEffect(() => {
    router.replace('/onboarding-v2/motivation');
  }, []);

  return <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />;
}
