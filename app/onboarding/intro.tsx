import { Redirect } from 'expo-router';

// ─── V1 onboarding intro removed — redirect to V2 canonical entry ─────────────
// This adapter exists solely for backward compatibility with old deep links
// pointing to /onboarding/intro. It contains no V1 business logic.
export default function OnboardingIntroRedirect() {
  return <Redirect href="/onboarding-v2/name" />;
}
