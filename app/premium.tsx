// ─── Paywall Zainly+ ────────────────────────────────────────────────────────────
// Phase 2: real RevenueCat purchase/restore flow. Offerings are fetched only
// while this screen is mounted (via useRevenueCatPaywall), never at app launch.

import React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { useAuthStore } from '@/store/authStore';
import { useRevenueCatPaywall, PaywallPlan } from '@/hooks/useRevenueCatPaywall';

type PaywallContext = 'daily_limit' | 'profile' | 'onboarding';

type ContextCopy = { title: string; subtitle: string };

const CONTEXT_COPY: Record<PaywallContext, ContextCopy> = {
  daily_limit: {
    title: 'Tu as terminé ton ayat du jour',
    subtitle: 'Reviens demain gratuitement, ou continue maintenant avec Zainly+.',
  },
  onboarding: {
    title: 'Ton parcours est prêt',
    subtitle: 'Continue gratuitement avec 1 ayat guidé par jour, ou débloque Zainly+ pour avancer sans limite quotidienne.',
  },
  profile: {
    title: 'Découvre Zainly+',
    subtitle: 'Débloque les sessions guidées sans limite quotidienne.',
  },
};

const BENEFITS = [
  {
    title: 'Sessions guidées sans limite quotidienne',
    desc: 'Mémorise plusieurs ayats le même jour.',
  },
  {
    title: 'Continue sans attendre demain',
    desc: 'Ton prochain ayat est disponible immédiatement.',
  },
  {
    title: 'Avance à ton rythme',
    desc: 'Garde ton élan quand tu es motivé.',
  },
];

function legalText(plan: PaywallPlan, priceString: string | undefined): string {
  if (plan === 'annual') {
    return `Après 7 jours gratuits, l’abonnement annuel se renouvelle automatiquement${
      priceString ? ` à ${priceString} / an` : ''
    }, sauf annulation au moins 24 h avant la fin de la période en cours. Le paiement sera débité de votre compte Apple à la confirmation de l’achat. Vous pouvez gérer ou annuler votre abonnement dans les réglages de votre compte Apple.`;
  }
  return `L’abonnement mensuel se renouvelle automatiquement${
    priceString ? ` à ${priceString} / mois` : ''
  }, sauf annulation au moins 24 h avant la fin de la période en cours. Le paiement sera débité de votre compte Apple à la confirmation de l’achat. Vous pouvez gérer ou annuler votre abonnement dans les réglages de votre compte Apple.`;
}

export default function PremiumScreen() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const ctx: PaywallContext =
    context === 'daily_limit' || context === 'profile' || context === 'onboarding'
      ? context
      : 'profile';

  const copy = CONTEXT_COPY[ctx];
  const userId = useAuthStore((st) => st.user?.id);
  const {
    annualPackage,
    monthlyPackage,
    selectedPackage,
    setSelectedPackage,
    isLoadingOfferings,
    offeringsError,
    isPurchasing,
    isRestoring,
    purchaseSelectedPackage,
    restorePurchases,
  } = useRevenueCatPaywall(userId);

  const plan: PaywallPlan = selectedPackage === monthlyPackage && monthlyPackage ? 'monthly' : 'annual';
  const offeringsUnavailable = !isLoadingOfferings && (!!offeringsError || (!annualPackage && !monthlyPackage));

  function goBackAfterPurchase() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  }

  async function handleSubscribe() {
    if (!selectedPackage || isPurchasing) return;

    const result = await purchaseSelectedPackage();

    if (result.ok) {
      if (result.hasEntitlement) {
        // Onboarding context: the dedicated premium-confirmation screen
        // IS the confirmation moment — a native Alert on top of it would be
        // redundant/jarring, so it is skipped only for this context.
        if (ctx === 'onboarding') {
          router.replace('/onboarding-v2/premium-confirmation');
        } else {
          Alert.alert('Zainly+ activé', 'Ton accès Zainly+ est maintenant actif.');
          goBackAfterPurchase();
        }
      } else {
        Alert.alert(
          'Achat confirmé, activation en attente',
          'Ton paiement a été confirmé mais l’activation prend plus de temps que prévu. Réessaie dans quelques instants ou contacte le support si le problème persiste.'
        );
      }
      return;
    }

    if (result.reason === 'cancelled') {
      // User cancelled — stay on the paywall, no dramatic alert.
      return;
    }

    Alert.alert(
      'Paiement impossible',
      'Une erreur est survenue pendant l’achat. Réessaie dans quelques instants.'
    );
  }

  async function handleRestore() {
    if (isRestoring) return;

    const result = await restorePurchases();

    if (result.ok) {
      if (result.hasEntitlement) {
        if (ctx === 'onboarding') {
          router.replace('/onboarding-v2/premium-confirmation');
        } else {
          Alert.alert('Achats restaurés', 'Ton accès Zainly+ est actif.');
          goBackAfterPurchase();
        }
      } else {
        Alert.alert('Aucun achat trouvé', 'Aucun abonnement Zainly+ actif n’a été trouvé sur ce compte Apple.');
      }
      return;
    }

    Alert.alert(
      'Restauration impossible',
      'Une erreur est survenue pendant la restauration. Réessaie dans quelques instants.'
    );
  }

  function handlePrivacy() {
    router.push('/legal/privacy');
  }

  function handleTerms() {
    router.push('/legal/terms');
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
            <Text style={s.compareText}>Gratuit : 1 ayat guidé par jour.</Text>
          </View>
          <View style={s.compareItem}>
            <View style={[s.compareDot, s.compareDotGold]} />
            <Text style={[s.compareText, s.compareTextGold]}>Zainly+ : sessions guidées sans limite quotidienne.</Text>
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
          Déjà utilisé par des apprenants sur Zainly web.
        </Text>

        {/* ── Plan selector ── */}
        {isLoadingOfferings ? (
          <View style={s.offeringsLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : offeringsUnavailable ? (
          <View style={s.offeringsUnavailable}>
            <Text style={s.offeringsUnavailableText}>
              Offre temporairement indisponible. Réessaie dans quelques minutes.
            </Text>
          </View>
        ) : (
          <View style={s.plansRow}>
            {/* Annual */}
            {annualPackage && (
              <Pressable
                style={[s.planCard, plan === 'annual' && s.planCardSelected]}
                onPress={() => setSelectedPackage('annual')}
              >
                <View style={s.planBestBadge}>
                  <Text style={s.planBestText}>MEILLEURE OFFRE</Text>
                </View>
                <Text style={s.planName}>Annuel</Text>
                {annualPackage.product.introPrice?.price === 0 && (
                  <View style={s.planTagsRow}>
                    <View style={s.planTag}><Text style={s.planTagText}>7 jours gratuits</Text></View>
                  </View>
                )}
                <Text style={s.planPrice}>{annualPackage.product.priceString} / an</Text>
                {annualPackage.product.pricePerMonthString && (
                  <Text style={s.planSub}>soit {annualPackage.product.pricePerMonthString} / mois</Text>
                )}
              </Pressable>
            )}

            {/* Monthly */}
            {monthlyPackage && (
              <Pressable
                style={[s.planCard, plan === 'monthly' && s.planCardSelected]}
                onPress={() => setSelectedPackage('monthly')}
              >
                <View style={s.planNameRow}>
                  <Text style={s.planName}>Mensuel</Text>
                </View>
                <Text style={s.planPrice}>{monthlyPackage.product.priceString} / mois</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── CTA principal ── */}
        <Pressable
          style={({ pressed }) => [
            s.ctaBtn,
            pressed && s.ctaBtnPressed,
            (offeringsUnavailable || isLoadingOfferings || isPurchasing) && s.ctaBtnDisabled,
          ]}
          onPress={handleSubscribe}
          disabled={offeringsUnavailable || isLoadingOfferings || isPurchasing}
        >
          {isPurchasing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={s.ctaBtnText}>
              {plan === 'annual' && annualPackage?.product.introPrice?.price === 0
                ? 'Commencer 7 jours gratuits'
                : 'Continuer avec Zainly+'}
            </Text>
          )}
        </Pressable>

        {/* ── Legal ── */}
        {!offeringsUnavailable && selectedPackage && (
          <Text style={s.legal}>
            {legalText(plan, selectedPackage.product.priceString)}
          </Text>
        )}

        {/* ── Bouton gratuit ── */}
        <Pressable style={s.freeBtn} onPress={() => router.back()}>
          <Text style={s.freeBtnText}>Continuer gratuitement — 1 ayat / jour</Text>
        </Pressable>

        {/* ── Footer links ── */}
        <View style={s.footerLinks}>
          <Pressable onPress={handleRestore} hitSlop={8} disabled={isRestoring}>
            <Text style={s.footerLink}>{isRestoring ? 'Restauration…' : 'Restaurer mes achats'}</Text>
          </Pressable>
          <Text style={s.footerSep}>·</Text>
          <Pressable onPress={handlePrivacy} hitSlop={8}>
            <Text style={s.footerLink}>Confidentialité</Text>
          </Pressable>
          <Text style={s.footerSep}>·</Text>
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

  // ── offerings states ──
  offeringsLoading: {
    height: 96, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  offeringsUnavailable: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  offeringsUnavailableText: {
    fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20,
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
  ctaBtnDisabled: { opacity: 0.5 },
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
