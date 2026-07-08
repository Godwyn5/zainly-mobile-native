// ─── useRevenueCatPaywall (Phase 2 — real purchase flow) ───────────────────────
// Loads RevenueCat offerings only when this hook is mounted (i.e. only from
// app/premium.tsx), never at app launch. Exposes purchase/restore actions and
// keeps CustomerInfo/entitlement state in sync via React Query invalidation.
// Never throws to the UI — all failures surface as typed state.

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getDefaultRevenueCatOffering,
  getZainlyPlusPackages,
  hasRevenueCatEntitlement,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  PurchasesPackage,
} from '@/lib/revenueCat';

export type PaywallPlan = 'annual' | 'monthly';

export interface UseRevenueCatPaywallResult {
  annualPackage: PurchasesPackage | null;
  monthlyPackage: PurchasesPackage | null;
  selectedPackage: PurchasesPackage | null;
  setSelectedPackage: (plan: PaywallPlan) => void;
  isLoadingOfferings: boolean;
  offeringsError: string | null;
  isPurchasing: boolean;
  isRestoring: boolean;
  purchaseSelectedPackage: () => Promise<
    { ok: true; hasEntitlement: boolean } | { ok: false; reason: 'cancelled' | 'error'; message?: string }
  >;
  restorePurchases: () => Promise<
    { ok: true; hasEntitlement: boolean } | { ok: false; reason: 'error'; message?: string }
  >;
  hasActiveEntitlementAfterAction: boolean | null;
}

export function useRevenueCatPaywall(userId: string | undefined): UseRevenueCatPaywallResult {
  const queryClient = useQueryClient();

  const [annualPackage, setAnnualPackage] = useState<PurchasesPackage | null>(null);
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PaywallPlan>('annual');
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(true);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [hasActiveEntitlementAfterAction, setHasActiveEntitlementAfterAction] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoadingOfferings(true);
      setOfferingsError(null);

      const offering = await getDefaultRevenueCatOffering();
      if (cancelled) return;

      if (!offering) {
        setOfferingsError('Offre temporairement indisponible. Réessaie dans quelques minutes.');
        setIsLoadingOfferings(false);
        return;
      }

      const { annual, monthly } = getZainlyPlusPackages(offering);
      setAnnualPackage(annual);
      setMonthlyPackage(monthly);

      if (!annual && !monthly) {
        setOfferingsError('Offre temporairement indisponible. Réessaie dans quelques minutes.');
      } else if (!annual) {
        setSelectedPlan('monthly');
      }

      setIsLoadingOfferings(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPackage = selectedPlan === 'annual' ? annualPackage ?? monthlyPackage : monthlyPackage ?? annualPackage;

  const setSelectedPackage = useCallback((plan: PaywallPlan) => {
    setSelectedPlan(plan);
  }, []);

  const invalidateCustomerInfo = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['revenueCatCustomerInfo', userId] });
  }, [queryClient, userId]);

  const purchaseSelectedPackage = useCallback(async (): Promise<
    { ok: true; hasEntitlement: boolean } | { ok: false; reason: 'cancelled' | 'error'; message?: string }
  > => {
    if (!selectedPackage) {
      return { ok: false, reason: 'error', message: 'Aucune offre sélectionnée.' };
    }

    setIsPurchasing(true);
    try {
      const result = await purchaseRevenueCatPackage(selectedPackage);

      if (!result.ok) {
        if (result.reason === 'cancelled') {
          return { ok: false, reason: 'cancelled' };
        }
        return { ok: false, reason: 'error', message: result.message };
      }

      const hasEntitlement = hasRevenueCatEntitlement(result.customerInfo);
      setHasActiveEntitlementAfterAction(hasEntitlement);
      invalidateCustomerInfo();
      return { ok: true, hasEntitlement };
    } finally {
      setIsPurchasing(false);
    }
  }, [selectedPackage, invalidateCustomerInfo]);

  const restorePurchases = useCallback(async (): Promise<
    { ok: true; hasEntitlement: boolean } | { ok: false; reason: 'error'; message?: string }
  > => {
    setIsRestoring(true);
    try {
      const result = await restoreRevenueCatPurchases();

      if (!result.ok) {
        return { ok: false, reason: 'error', message: result.message };
      }

      const hasEntitlement = hasRevenueCatEntitlement(result.customerInfo);
      setHasActiveEntitlementAfterAction(hasEntitlement);
      invalidateCustomerInfo();
      return { ok: true, hasEntitlement };
    } finally {
      setIsRestoring(false);
    }
  }, [invalidateCustomerInfo]);

  return {
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
    hasActiveEntitlementAfterAction,
  };
}
