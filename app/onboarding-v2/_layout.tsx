import { Stack } from 'expo-router';

// ─── Onboarding V2 stack — internal navigation between these screens never
// uses the platform's default slide/fade. Every transition between two
// scenes is authored by hand (exit choreography on the screen you leave,
// entrance choreography on the screen you arrive at) so it can tell its own
// story instead of a generic navigator animation fighting it. ─────────────
export default function OnboardingV2Layout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
