// ─── useZainlyPlusAccess ────────────────────────────────────────────────────────
// Reads the 'zainly_plus' RevenueCat entitlement and falls back to the legacy
// profile.is_premium flag when RevenueCat has no active entitlement.
// This is the source of truth for Zainly+ access across the app (daily limit
// gating in app/(app)/(tabs)/index.tsx and app/(app)/session.tsx, and the
// subscription card in app/(app)/(tabs)/profile.tsx).

import { useQuery } from '@tanstack/react-query';
import {
  getRevenueCatCustomerInfo,
  hasRevenueCatEntitlement,
  CustomerInfo,
} from '@/lib/revenueCat';
import { useProfile } from '@/hooks/useProfile';

const ZAINLY_PLUS_ENTITLEMENT_ID = 'zainly_plus';

export type ZainlyPlusAccessSource = 'revenuecat' | 'profile_fallback' | 'none';

export interface ZainlyPlusAccess {
  hasZainlyPlus: boolean;
  source: ZainlyPlusAccessSource;
  isLoading: boolean;
  error: string | null;
  customerInfo?: CustomerInfo | null;
}

export function useZainlyPlusAccess(userId: string | undefined): ZainlyPlusAccess {
  const { data: profileData, isLoading: isProfileLoading } = useProfile(userId);

  const {
    data: customerInfo,
    isLoading: isCustomerInfoLoading,
    error: customerInfoError,
  } = useQuery({
    queryKey: ['revenueCatCustomerInfo', userId],
    queryFn: () => getRevenueCatCustomerInfo(),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const hasRevenueCatAccess = hasRevenueCatEntitlement(
    customerInfo,
    ZAINLY_PLUS_ENTITLEMENT_ID
  );
  const hasProfileFallbackAccess = profileData?.is_premium === true;

  let hasZainlyPlus = false;
  let source: ZainlyPlusAccessSource = 'none';

  if (hasRevenueCatAccess) {
    hasZainlyPlus = true;
    source = 'revenuecat';
  } else if (hasProfileFallbackAccess) {
    hasZainlyPlus = true;
    source = 'profile_fallback';
  }

  return {
    hasZainlyPlus,
    source,
    isLoading: isCustomerInfoLoading || isProfileLoading,
    error: customerInfoError instanceof Error ? customerInfoError.message : null,
    customerInfo: customerInfo ?? null,
  };
}
