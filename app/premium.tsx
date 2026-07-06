// ─── Paywall Zainly+ V1 mock ──────────────────────────────────────────────────
// TODO Zainly+: replace mock Alert CTA with real RevenueCat purchase call.
// This screen is intentionally UI-only. No purchase logic runs here.

import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type PaywallContext = 'daily_limit' | 'profile' | 'onboarding';

type ContextCopy = { title: string; subtitle: string };

const CONTEXT_COPY: Record<PaywallContext, ContextCopy> = {
  daily_limit: {
    title: 'Tu as termin\u00e9 ton ayat du jour',
    subtitle: 'Reviens demain gratuitement, ou continue maintenant avec Zainly+.',
  },
  onboarding: {
    title: 'Ton parcours est pr\u00eat',
    subtitle: 'Continue gratuitement avec 1 ayat guid\u00e9 par jour, ou d\u00e9bloque Zainly+ pour avancer sans limite quotidienne.',
  },
  profile: {
    title: 'D\u00e9couvre Zainly+',
    subtitle: 'D\u00e9bloque les sessions guid\u00e9es sans limite quotidienne.',
  },
};

const BENEFITS = [
  {
    title: 'Sessions guid\u00e9es sans limite quotidienne',
    desc: 'M\u00e9morise plusieurs ayats le m\u00eame jour.',
  },
  {
    title: 'Continue sans attendre demain',
    desc: 'Ton prochain ayat est disponible imm\u00e9diatement.',
  },
  {
    title: 'Avance \u00e0 ton rythme',
    desc: 'Garde ton \u00e9lan quand tu es motiv\u00e9.',
  },
];

const LEGAL_ANNUAL =
  'Apr\u00e8s 7 jours gratuits, l\u2019abonnement annuel se renouvelle automatiquement \u00e0 59,99\u00a0\u20ac\u00a0/ an, sauf annulation au moins 24\u00a0h avant la fin de la p\u00e9riode en cours. Le paiement sera d\u00e9bit\u00e9 de votre compte Apple \u00e0 la confirmation de l\u2019achat. Vous pouvez g\u00e9rer ou annuler votre abonnement dans les r\u00e9glages de votre compte Apple.';

const LEGAL_MONTHLY =
  'L\u2019abonnement mensuel se renouvelle automatiquement \u00e0 9,99\u00a0\u20ac\u00a0/ mois, sauf annulation au moins 24\u00a0h avant la fin de la p\u00e9riode en cours. Le paiement sera d\u00e9bit\u00e9 de votre compte Apple \u00e0 la confirmation de l\u2019achat. Vous pouvez g\u00e9rer ou annuler votre abonnement dans les r\u00e9glages de votre compte Apple.';

export default function PremiumScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const ctx: PaywallContext =
    context === 'daily_limit' || context === 'profile' || context === 'onboarding'
      ? context
      : 'profile';

  const copy = CONTEXT_COPY[ctx];
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');

  function handleSubscribe() {
    // TODO Zainly+: replace with RevenueCat purchase call.
    Alert.alert(
      'Paiement bient\u00f4t disponible',
      'Zainly+ sera bient\u00f4t disponible dans l\u2019application.'
    );
  }

  function handleRestore() {
    // TODO Zainly+: replace with RevenueCat restorePurchases call.
    Alert.alert('Restaurer les achats', 'La restauration des achats sera disponible avec Zainly+.');
  }

  function handlePrivacy() {
    // TODO Zainly+: open privacy policy URL.
    Alert.alert('Confidentialit\u00e9', 'La politique de confidentialit\u00e9 sera disponible prochainement.');
  }

  function handleTerms() {
    // TODO Zainly+: open terms of service URL.
    Alert.alert('CGU', 'Les conditions g\u00e9n\u00e9rales d\u2019utilisation seront disponibles prochainement.');
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Close button ── */}
        <Pressable style={s.closeBtn} onPress={() => router.back()} hitSlop={12}>
          <View style={s.closeLine1} />
          <View style={s.closeLine2} />
        </Pressable>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.badge}>
            <View style={s.badgeDot} />
            <Text style={s.badgeText}>ZAINLY+</Text>
          </View>
          <Text style={s.title}>{copy.title}</Text>
          <Text style={s.subtitle}>{copy.subtitle}</Text>
        </View>

        {/* ── Free vs Plus summary ── */}
        <View style={s.compareRow}>
          <View style={s.compareItem}>
            <View style={s.compareDot} />
            <Text style={s.compareText}>Gratuit\u00a0: 1 ayat guid\u00e9 par jour.</Text>
          </View>
          <View style={s.compareItem}>
            <View style={[s.compareDot, s.compareDotGold]} />
            <Text style={[s.compareText, s.compareTextGold]}>Zainly+\u00a0: sessions guid\u00e9es sans limite quotidienne.</Text>
          </View>
        </View>

        {/* ── Benefits ── */}
        <View style={s.benefitsBlock}>
          {BENEFITS.map((b, i) => (
            <View key={i} style={s.benefitRow}>
              <View style={s.benefitCheck}>
                <View style={s.checkDot} />
              </View>
              <View style={s.benefitText}>
                <Text style={s.benefitTitle}>{b.title}</Text>
                <Text style={s.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Social proof ── */}
        <Text style={s.socialProof}>
          D\u00e9j\u00e0 utilis\u00e9 par des apprenants sur Zainly web.
        </Text>

        {/* ── Plan selector ── */}
        <View style={s.plansRow}>
          {/* Annual */}
          <Pressable
            style={[s.planCard, plan === 'annual' && s.planCardSelected]}
            onPress={() => setPlan('annual')}
          >
            <View style={s.planBestBadge}>
              <Text style={s.planBestText}>MEILLEURE OFFRE</Text>
            </View>
            <Text style={s.planName}>Annuel</Text>
            <View style={s.planTagsRow}>
              <View style={s.planTag}><Text style={s.planTagText}>-50%</Text></View>
              <View style={s.planTag}><Text style={s.planTagText}>7 jours gratuits</Text></View>
            </View>
            <Text style={s.planPrice}>59,99\u00a0\u20ac / an</Text>
            <Text style={s.planSub}>soit 4,99\u00a0\u20ac / mois</Text>
          </Pressable>

          {/* Monthly */}
          <Pressable
            style={[s.planCard, plan === 'monthly' && s.planCardSelected]}
            onPress={() => setPlan('monthly')}
          >
            <View style={s.planNameRow}>
              <Text style={s.planName}>Mensuel</Text>
            </View>
            <Text style={s.planPrice}>9,99\u00a0\u20ac / mois</Text>
          </Pressable>
        </View>

        {/* ── CTA principal ── */}
        <Pressable
          style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
          onPress={handleSubscribe}
        >
          <Text style={s.ctaBtnText}>
            {plan === 'annual' ? 'Commencer 7 jours gratuits' : 'Continuer avec Zainly+'}
          </Text>
        </Pressable>

        {/* ── Legal ── */}
        <Text style={s.legal}>
          {plan === 'annual' ? LEGAL_ANNUAL : LEGAL_MONTHLY}
        </Text>

        {/* ── Bouton gratuit ── */}
        <Pressable style={s.freeBtn} onPress={() => router.back()}>
          <Text style={s.freeBtnText}>Continuer gratuitement \u2014 1 ayat / jour</Text>
        </Pressable>

        {/* ── Footer links ── */}
        <View style={s.footerLinks}>
          <Pressable onPress={handleRestore} hitSlop={8}>
            <Text style={s.footerLink}>Restaurer mes achats</Text>
          </Pressable>
          <Text style={s.footerSep}>\u00b7</Text>
          <Pressable onPress={handlePrivacy} hitSlop={8}>
            <Text style={s.footerLink}>Confidentialit\u00e9</Text>
          </Pressable>
          <Text style={s.footerSep}>\u00b7</Text>
          <Pressable onPress={handleTerms} hitSlop={8}>
            <Text style={s.footerLink}>CGU</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },

  // ── close ──
  closeBtn: {
    alignSelf: 'flex-end', width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  closeLine1: {
    position: 'absolute', width: 18, height: 2,
    borderRadius: 1, backgroundColor: colors.muted,
    transform: [{ rotate: '45deg' }],
  },
  closeLine2: {
    position: 'absolute', width: 18, height: 2,
    borderRadius: 1, backgroundColor: colors.muted,
    transform: [{ rotate: '-45deg' }],
  },

  // ── header ──
  header: { marginBottom: spacing.lg },
  badge: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.goldSoft,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.35)',
    marginBottom: spacing.sm,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: colors.gold },
  title: { fontSize: 26, fontWeight: '800', color: colors.primary, lineHeight: 34, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 22 },

  // ── compare ──
  compareRow: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg, gap: 8,
  },
  compareItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  compareDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: colors.muted, marginTop: 5,
  },
  compareDotGold: { backgroundColor: colors.gold },
  compareText: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 20 },
  compareTextGold: { color: colors.primary, fontWeight: '600' },

  // ── benefits ──
  benefitsBlock: { marginBottom: spacing.md, gap: 12 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitCheck: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(45,106,79,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.22)',
  },
  checkDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.success },
  benefitText: { flex: 1 },
  benefitTitle: { fontSize: 14, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  benefitDesc: { fontSize: 12, color: colors.muted, lineHeight: 18 },

  // ── social proof ──
  socialProof: {
    fontSize: 12, color: colors.muted, textAlign: 'center',
    marginBottom: spacing.lg, fontStyle: 'italic',
  },

  // ── plans ──
  plansRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  planCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md,
    shadowColor: colors.primary, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  planCardSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
    shadowColor: colors.gold, shadowOpacity: 0.18,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  planBestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
    marginBottom: 6,
  },
  planBestText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  planNameRow: { marginBottom: 6 },
  planName: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  planTagsRow: { flexDirection: 'row', gap: 5, marginBottom: 8, flexWrap: 'wrap' },
  planTag: {
    backgroundColor: 'rgba(45,106,79,0.10)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.18)',
  },
  planTagText: { fontSize: 10, fontWeight: '600', color: colors.success },
  planPrice: { fontSize: 16, fontWeight: '800', color: colors.primary },
  planSub: { fontSize: 11, color: colors.muted, marginTop: 2 },

  // ── CTA ──
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
    shadowColor: colors.primary, shadowOpacity: 0.40,
    shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5,
  },
  ctaBtnPressed: { opacity: 0.82, transform: [{ scale: 0.977 }] },
  ctaBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  // ── legal ──
  legal: {
    fontSize: 11, color: colors.muted, lineHeight: 17,
    textAlign: 'center', marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },

  // ── free btn ──
  freeBtn: {
    height: 48, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  freeBtnText: { fontSize: 14, color: colors.muted, fontWeight: '500' },

  // ── footer ──
  footerLinks: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
  footerLink: { fontSize: 11, color: colors.muted },
  footerSep: { fontSize: 11, color: colors.disabled },
});
