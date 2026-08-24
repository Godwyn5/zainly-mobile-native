// ─── RevenueCatProvider (Phase 1 — read-only) ──────────────────────────────────
// Configures RevenueCat once, then keeps the RevenueCat identity in sync with
// the current Supabase auth session (logIn on session, logOut on sign-out).
// Passes through children. Never throws, never blocks the app — all RevenueCat
// calls in src/lib/revenueCat.ts are best-effort and swallow their own errors.

import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  configureRevenueCatOnce,
  revenueCatLogIn,
  revenueCatLogOut,
} from '@/lib/revenueCat';

export function RevenueCatProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id);
  const ready = useAuthStore((s) => s.ready);
  const lastSyncedUserId = useRef<string | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ready) return;
    if (lastSyncedUserId.current === (userId ?? null)) return;

    (async () => {
      await configureRevenueCatOnce(userId ?? null);

      // Only the logIn branch can fail in a way that matters for purchase
      // linking — logOut is best-effort/non-critical (useLogout.ts already
      // calls it directly too, and the auth guard navigates away regardless
      // of RevenueCat state on sign-out).
      let syncedSuccessfully = true;
      if (userId) {
        syncedSuccessfully = await revenueCatLogIn(userId);
      } else {
        await revenueCatLogOut();
      }

      if (!syncedSuccessfully) {
        // Never mark a failed logIn as synced — this ref gates re-entry into
        // this effect for the *same* userId, so silently marking it done
        // here would permanently strand the anonymous-purchase-to-account
        // link until logout/login or app restart. Leaving it unset lets the
        // next natural trigger (userId actually changing again, e.g. a
        // fresh session object after logout->login, or a fresh app launch
        // resetting this ref) retry — without looping synchronously here,
        // since this effect only re-runs when ready/userId/queryClient
        // themselves change again. This provider is a reactive safety net,
        // not the sole guarantee: useLogout explicitly calls revenueCatLogOut
        // directly, so the invalidation below also covers the anonymous state.
        return;
      }

      lastSyncedUserId.current = userId ?? null;

      // Force any mounted useZainlyPlusAccess query to refetch AFTER the
      // native identity switch resolves, so a fast logout->login on the same
      // device never briefly reuses the previous account's entitlement.
      queryClient.invalidateQueries({ queryKey: ['revenueCatCustomerInfo'] });
    })();
  }, [ready, userId, queryClient]);

  return <>{children}</>;
}
