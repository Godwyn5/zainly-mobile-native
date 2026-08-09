// ─── useRestorePurchases ──────────────────────────────────────────────────────
// Shared restore logic used by both the Profile screen and the Paywall.
// Reuses restoreRevenueCatPurchases + hasRevenueCatEntitlement from the
// RevenueCat wrapper — never makes a second, parallel implementation.
// All failures surface as typed state; never throws to the UI.

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  restoreRevenueCatPurchases,
  hasRevenueCatEntitlement,
} from '@/lib/revenueCat';

export type RestoreResult =
  | { ok: true; hasEntitlement: boolean }
  | { ok: false; reason: 'already_restoring' | 'error'; message?: string };

export function useRestorePurchases(userId: string | undefined) {
  const queryClient = useQueryClient();
  const [isRestoring, setIsRestoring] = useState(false);
  const isRestoringRef = useRef(false);

  const restore = useCallback(async (): Promise<RestoreResult> => {
    if (isRestoringRef.current) {
      return { ok: false, reason: 'already_restoring' };
    }

    isRestoringRef.current = true;
    setIsRestoring(true);
    try {
      const result = await restoreRevenueCatPurchases();

      if (!result.ok) {
        return { ok: false, reason: 'error', message: result.message };
      }

      const hasEntitlement = hasRevenueCatEntitlement(result.customerInfo);

      queryClient.invalidateQueries({
        queryKey: ['revenueCatCustomerInfo', userId],
      });

      return { ok: true, hasEntitlement };
    } finally {
      isRestoringRef.current = false;
      setIsRestoring(false);
    }
  }, [queryClient, userId]);

  return { restore, isRestoring };
}
