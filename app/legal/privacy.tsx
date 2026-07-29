// ─── Politique de confidentialité ─────────────────────────────────────────────
// Content is sourced from shared JSON to ensure consistency between in-app and
// web versions. The JSON reflects only real data processing as observed in the
// code: Supabase (auth + database), RevenueCat (subscriptions), Apple (in-app
// payments), and expo-notifications (local reminders, no push server). No third
// party, no data sale, no advertising, no analytics present in this project.

import { LegalScreen, LegalSection } from '@/components/legal/LegalScreen';
import privacyContent from '@/legal-content/privacy.json';

export default function PrivacyPolicyScreen() {
  return (
    <LegalScreen title="Confidentialité" lastUpdated={privacyContent.lastUpdated}>
      {privacyContent.sections.map((section) => (
        <LegalSection key={section.title} title={section.title}>
          {section.content}
        </LegalSection>
      ))}
    </LegalScreen>
  );
}
