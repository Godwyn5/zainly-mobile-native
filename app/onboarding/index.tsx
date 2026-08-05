import { Redirect } from 'expo-router';

// ─── V1 onboarding removed — redirect to V2 canonical entry ──────────────────
// This adapter exists solely for backward compatibility with old deep links
// pointing to /onboarding. It contains no V1 business logic.
export default function OnboardingRedirect() {
  return <Redirect href="/onboarding-v2/name" />;
}
