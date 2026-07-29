// ─── Conditions Générales d'Utilisation ───────────────────────────────────────
// Content is sourced from shared JSON to ensure consistency between in-app and
// web versions. Describes only actually present features: guided sessions limited
// to 1 ayat/day in free tier, unlimited guided sessions in Zainly+. No invented
// premium benefits. Purchases managed by Apple, subscriptions by RevenueCat,
// restoration via "Restaurer mes achats" on paywall.

import { LegalScreen, LegalSection } from '@/components/legal/LegalScreen';
import termsContent from '@/legal-content/terms.json';

export default function TermsOfUseScreen() {
  return (
    <LegalScreen title="CGU" lastUpdated={termsContent.lastUpdated}>
      {termsContent.sections.map((section) => (
        <LegalSection key={section.title} title={section.title}>
          {section.content}
        </LegalSection>
      ))}
    </LegalScreen>
  );
}
