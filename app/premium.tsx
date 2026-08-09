// ─── Paywall Zainly+ ────────────────────────────────────────────────────────────
// Phase 2: real RevenueCat purchase/restore flow. Offerings are fetched only
// while this screen is mounted (via useRevenueCatPaywall), never at app launch.
//
// Design: compact single-screen paywall — the whole content (header, promise,
// compare, plans, CTA, free option, legal footer) must fit on a standard
// iPhone screen without requiring the user to scroll. The ScrollView wrapper
// is kept only as a safety net for very small devices (e.g. iPhone SE).

import React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { useAuthStore } from '@/store/authStore';
import { useRevenueCatPaywall, PaywallPlan } from '@/hooks/useRevenueCatPaywall';
import { PurchasesPackage } from '@/lib/revenueCat';

type PaywallContext = 'daily_limit' | 'profile' | 'onboarding';

type ContextCopy = { title: string; subtitle: string };

const CONTEXT_COPY: Record<PaywallContext, ContextCopy> = {
  daily_limit: {
    title: 'Garde ton élan dans ton Hifz.',
    subtitle: 'Sessions guidées sans limite quotidienne, pour continuer quand tu es concentré.',
  },
  onboarding: {
    title: 'Garde ton élan dans ton Hifz.',
    subtitle: 'Sessions guidées sans limite quotidienne, pour continuer quand tu es concentré.',
  },
  profile: {
    title: 'Garde ton élan dans ton Hifz.',
    subtitle: 'Sessions guidées sans limite quotidienne, pour continuer quand tu es concentré.',
  },
};

// Single compact psychological-benefit line — no invented promise, no
// invented statistic. Rendered only if it fits without causing a scroll.
const MICRO_BENEFIT = 'Garde ton élan les jours où tu es prêt à avancer.';

/**
 * Defensive discount calculation, computed strictly from RevenueCat's real
 * numeric prices. Returns null (hide the badge) unless every guard passes —
 * never hardcoded, never invented.
 */
function computeAnnualDiscountPercent(
  monthlyPackage: PurchasesPackage | null,
  annualPackage: PurchasesPackage | null
): number | null {
  const monthlyPrice = monthlyPackage?.product.price;
  const annualPrice = annualPackage?.product.price;

  if (typeof monthlyPrice !== 'number' || typeof annualPrice !== 'number') return null;
  if (!Number.isFinite(monthlyPrice) || !Number.isFinite(annualPrice)) return null;
  if (!(monthlyPrice > 0) || !(annualPrice > 0)) return null;
  if (!(annualPrice < monthlyPrice * 12)) return null;

  const discount = Math.round((1 - annualPrice / (monthlyPrice * 12)) * 100);
  if (!(discount > 0) || !(discount < 100)) return null;

  return discount;
}

/**
 * Extracts trial duration text from RevenueCat's introPrice if available.
 * Returns null if no trial or duration cannot be determined.
 * Uses introPrice.period (e.g., "P7D" for 7 days) if present.
 * Falls back to generic "offre gratuite" if period is not available.
 */
function getTrialDurationText(introPrice: PurchasesPackage['product']['introPrice']): string | null {
  if (!introPrice || introPrice.price !== 0) return null;

  // RevenueCat introPrice.period is an ISO 8601 duration string (e.g., "P7D", "P3D")
  const period = (introPrice as any).period;
  if (typeof period === 'string' && period.startsWith('P') && period.endsWith('D')) {
    const days = parseInt(period.slice(1, -1), 10);
    if (!isNaN(days) && days > 0) {
      return `${days} jours gratuits`;
    }
  }

  // Fallback: generic text when period is not available
  return 'offre gratuite';
}

const STORE_SETTINGS_LABEL = Platform.OS === 'android' ? 'Google Play' : 'Apple';

/**
 * Platform-aware legal text. Only mentions a free trial when a real trial
 * was detected via RevenueCat's introPrice (hasTrial) — never hardcoded.
 * Uses actual trial duration from introPrice.period if available.
 */
function legalText(plan: PaywallPlan, priceString: string | undefined, trialDurationText: string | null): string {
  if (plan === 'annual') {
    const trialPrefix = trialDurationText ? `Après ${trialDurationText}, ` : '';
    const pricePart = priceString ? ` à ${priceString} / an` : '';
    return `${trialPrefix}Renouvellement automatique${pricePart}. Annulable dans les réglages ${STORE_SETTINGS_LABEL} au moins 24 h avant la fin de la période.`;
  }
  const pricePart = priceString ? ` à ${priceString} / mois` : '';
  return `Renouvellement automatique${pricePart}. Annulable dans les réglages ${STORE_SETTINGS_LABEL} au moins 24 h avant la fin de la période.`;
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
  const hasTrial = plan === 'annual' && annualPackage?.product.introPrice?.price === 0;
  const trialDurationText = plan === 'annual' ? getTrialDurationText(annualPackage?.product.introPrice ?? null) : null;
  const annualDiscountPercent = computeAnnualDiscountPercent(monthlyPackage, annualPackage);

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
        Alert.alert('Aucun achat trouvé', `Aucun abonnement Zainly+ actif n'a été trouvé sur ce compte ${STORE_SETTINGS_LABEL}.`);
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
        bounces={false}
      >
        {/* ── Close button ── */}
        <Pressable style={s.closeBtn} onPress={() => router.back()} hitSlop={12}>
          <View style={s.closeLine1} />
          <View style={s.closeLine2} />
        </Pressable>

        {/* ── Header — centered, compact ── */}
        <View style={s.header}>
          <View style={s.brandRow}>
            <Text style={s.brandZainly}>ZAINLY</Text>
            <Text style={s.brandPlus}>+</Text>
          </View>
          <View style={s.brandLine} />
          <Text style={s.title} numberOfLines={2}>{copy.title}</Text>
          <Text style={s.subtitle} numberOfLines={2}>{copy.subtitle}</Text>
        </View>

        {/* ── Free vs Plus summary — compact comparison ── */}
        <View style={s.compareRow}>
          <View style={s.compareItem}>
            <Text style={s.compareLabelFree}>GRATUIT</Text>
            <Text style={s.compareValueFree} numberOfLines={1}>1 ayat guidée par jour</Text>
          </View>
          <View style={s.compareDivider} />
          <View style={s.compareItem}>
            <Text style={s.compareLabelPlus}>ZAINLY+</Text>
            <Text style={s.compareValuePlus} numberOfLines={2}>Sessions guidées sans limite quotidienne</Text>
          </View>
        </View>

        {/* ── Micro benefit — single compact line ── */}
        <Text style={s.microBenefit} numberOfLines={2}>{MICRO_BENEFIT}</Text>

        {/* ── Plan selector — vertical: monthly then annual ── */}
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
          <View style={s.plansColumn}>
            {/* Monthly — sober, secondary */}
            {monthlyPackage && (
              <Pressable
                style={[s.monthlyCard, plan === 'monthly' && s.monthlyCardSelected]}
                onPress={() => setSelectedPackage('monthly')}
              >
                <View style={s.monthlyCardBody}>
                  <Text style={s.monthlyName}>Mensuel</Text>
                  <Text style={s.monthlySub} numberOfLines={1}>Sans engagement annuel</Text>
                </View>
                <View style={s.monthlyCardRight}>
                  <Text style={s.monthlyPrice}>{monthlyPackage.product.priceString}</Text>
                  <View style={[s.radioOuter, plan === 'monthly' && s.radioOuterSelected]}>
                    {plan === 'monthly' && <View style={s.radioInner} />}
                  </View>
                </View>
              </Pressable>
            )}

            {/* Annual — premium, dominant, selected by default */}
            {annualPackage && (
              <View style={s.annualWrap}>
                <View style={s.annualBadgeOverlap}>
                  <Text style={s.annualBadgeText}>MEILLEURE OFFRE</Text>
                </View>
                <Pressable
                  style={[s.annualCard, plan === 'annual' && s.annualCardSelected]}
                  onPress={() => setSelectedPackage('annual')}
                >
                  <View style={s.annualTopRow}>
                    <Text style={s.annualName}>Annuel</Text>
                    <View style={[s.radioOuter, plan === 'annual' && s.radioOuterSelected]}>
                      {plan === 'annual' && <View style={s.radioInner} />}
                    </View>
                  </View>

                  <View style={s.annualPriceRow}>
                    <Text style={s.annualPrice}>{annualPackage.product.priceString}</Text>
                    {annualDiscountPercent !== null && (
                      <View style={s.discountBadge}>
                        <Text style={s.discountBadgeText}>-{annualDiscountPercent}%</Text>
                      </View>
                    )}
                  </View>
                  {annualPackage.product.pricePerMonthString && (
                    <Text style={s.annualSub} numberOfLines={1}>soit {annualPackage.product.pricePerMonthString} / mois</Text>
                  )}

                  {trialDurationText && (
                    <View style={s.planTagsRow}>
                      <View style={s.planTag}><Text style={s.planTagText}>{trialDurationText}</Text></View>
                    </View>
                  )}
                </Pressable>
              </View>
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
              {hasTrial ? 'Essayer pour 0,00 €' : 'Continuer avec Zainly+'}
            </Text>
          )}
        </Pressable>

        {/* ── Legal ── */}
        {!offeringsUnavailable && selectedPackage && (
          <Text style={s.legal}>
            {legalText(plan, selectedPackage.product.priceString, trialDurationText)}
          </Text>
        )}

        {/* ── Bouton gratuit ── */}
        <Pressable style={s.freeBtn} onPress={() => router.back()}>
          <Text style={s.freeBtnText} numberOfLines={1}>Continuer gratuitement — 1 ayat / jour</Text>
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
  // flexGrow:1 lets the ScrollView act purely as a small-screen safety net —
  // on a standard/large iPhone this content never exceeds the viewport, so
  // there is nothing to scroll to.
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },

  // ── close ──
  closeBtn: {
    alignSelf: 'flex-end', width: 26, height: 26,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  closeLine1: {
    position: 'absolute', width: 16, height: 2,
    borderRadius: 1, backgroundColor: colors.muted,
    transform: [{ rotate: '45deg' }],
  },
  closeLine2: {
    position: 'absolute', width: 16, height: 2,
    borderRadius: 1, backgroundColor: colors.muted,
    transform: [{ rotate: '-45deg' }],
  },

  // ── header — centered, compact ──
  header: { alignItems: 'center', marginBottom: 8 },
  // ZAINLY+ — typographic brand signature (serif, minimal, not a badge).
  // Cinzel is the same serif family used for the real Zainly wordmark
  // (see app/index.tsx brand lockup).
  brandRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    alignSelf: 'center', marginBottom: 6,
  },
  brandZainly: {
    fontFamily: 'Cinzel_500Medium',
    fontSize: 17, letterSpacing: 3.5, color: colors.primary,
  },
  brandPlus: {
    fontFamily: 'Cinzel_500Medium',
    fontSize: 13, color: colors.gold,
    marginLeft: 2, marginTop: 1,
  },
  brandLine: {
    width: 24, height: 1, backgroundColor: colors.gold,
    opacity: 0.55, marginBottom: 10,
  },
  title: {
    fontSize: 21, fontWeight: '800', color: colors.primary,
    lineHeight: 26, marginBottom: 5, textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, color: colors.muted, lineHeight: 18,
    textAlign: 'center', paddingHorizontal: 8,
  },

  // ── compare — compact two-column comparison ──
  compareRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 10,
    shadowColor: colors.primary, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  compareItem: { flex: 1 },
  compareDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 12 },
  compareLabelFree: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.1,
    color: colors.muted, marginBottom: 3,
  },
  compareValueFree: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  compareLabelPlus: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.1,
    color: colors.gold, marginBottom: 3,
  },
  compareValuePlus: { fontSize: 12.5, fontWeight: '700', color: colors.primary, lineHeight: 16 },

  // ── micro benefit — single compact line ──
  microBenefit: {
    fontSize: 11.5, color: colors.muted, textAlign: 'center',
    lineHeight: 15, marginBottom: 10, paddingHorizontal: 6,
  },

  // ── offerings states ──
  offeringsLoading: {
    height: 80, alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  offeringsUnavailable: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 12, marginBottom: 10,
  },
  offeringsUnavailableText: {
    fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 17,
  },

  // ── plans — vertical stack: sober monthly on top, dominant annual below ──
  plansColumn: { gap: 8, marginBottom: 10 },

  // radio indicator, shared between both cards
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.disabled,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  radioOuterSelected: { borderColor: colors.gold },
  radioInner: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.gold },

  // monthly — sober, compact, secondary
  monthlyCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  monthlyCardSelected: { borderColor: colors.gold, backgroundColor: colors.surface },
  monthlyCardBody: { flex: 1 },
  monthlyName: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 1 },
  monthlySub: { fontSize: 10.5, color: colors.muted },
  monthlyCardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthlyPrice: { fontSize: 13.5, fontWeight: '700', color: colors.primary },

  // annual — premium, dominant, badge overlapping the top edge
  annualWrap: { marginTop: 6 },
  annualBadgeOverlap: {
    position: 'absolute', top: -9, left: 12, zIndex: 1,
    backgroundColor: colors.gold,
    borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3,
    shadowColor: colors.gold, shadowOpacity: 0.3,
    shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  annualBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  annualCard: {
    backgroundColor: colors.goldSoft,
    borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.35)',
    padding: 12, paddingTop: 16,
    shadowColor: colors.primary, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  annualCardSelected: {
    borderColor: colors.gold, borderWidth: 2,
    shadowColor: colors.gold, shadowOpacity: 0.22,
    shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4,
  },
  annualTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  annualName: { fontSize: 14.5, fontWeight: '800', color: colors.primary },
  annualPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 1 },
  annualPrice: { fontSize: 19, fontWeight: '800', color: colors.primary },
  discountBadge: {
    backgroundColor: colors.success,
    borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1.5,
  },
  discountBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  annualSub: { fontSize: 11, color: colors.muted, marginBottom: 6 },
  planTagsRow: { flexDirection: 'row', gap: 5, marginBottom: 4, flexWrap: 'wrap' },
  planTag: {
    backgroundColor: 'rgba(45,106,79,0.10)',
    borderRadius: 7, paddingHorizontal: 5, paddingVertical: 1.5,
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.18)',
  },
  planTagText: { fontSize: 9, fontWeight: '600', color: colors.success },

  // ── CTA ──
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14, height: 50,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
    shadowColor: colors.primary, shadowOpacity: 0.35,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  ctaBtnPressed: { opacity: 0.82, transform: [{ scale: 0.977 }] },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },

  // ── legal — Apple-compliant, no truncation, fits within no-scroll layout ──
  legal: {
    fontSize: 9, color: colors.muted, lineHeight: 12,
    textAlign: 'center', marginBottom: 5,
    paddingHorizontal: spacing.xs,
  },

  // ── free btn ──
  freeBtn: {
    height: 36, alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  freeBtnText: { fontSize: 12.5, color: colors.muted, fontWeight: '500' },

  // ── footer ──
  footerLinks: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
  footerLink: { fontSize: 10, color: colors.muted },
  footerSep: { fontSize: 10, color: colors.disabled },
});
