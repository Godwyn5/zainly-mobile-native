import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── TEMPORARY PLACEHOLDER ──────────────────────────────────────────────────
// The Onboarding V2 scenes that used to follow the greeting screen
// ("Le Hifz n'est pas une course", timing, program, daily) were rejected and
// have been removed. This screen exists only so greeting.tsx's "Continuer"
// CTA has a valid navigation target instead of a dead route.
//
// Intentionally inert: no storytelling, no animation, no new dependency.
// Replace with the real next screen when the post-greeting flow is
// redefined.
const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN  = '#163026';

export default function OnboardingComingSoonScreen() {
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {__DEV__ && (
            <Text style={styles.devText}>
              Placeholder — suite de l'onboarding à implémenter.
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BEIGE },
  safe: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  devText: { fontSize: 14, color: SPLASH_GREEN, opacity: 0.45, textAlign: 'center' },
});
