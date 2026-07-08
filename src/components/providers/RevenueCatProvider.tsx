// ─── RevenueCatProvider (Phase 1 — read-only) ──────────────────────────────────
// Configures RevenueCat once, then keeps the RevenueCat identity in sync with
// the current Supabase auth session (logIn on session, logOut on sign-out).
// Renders nothing. Never throws, never blocks the app — all RevenueCat calls
// in src/lib/revenueCat.ts are best-effort and swallow their own errors.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { configureRevenueCatOnce, revenueCatLogIn, revenueCatLogOut } from '@/lib/revenueCat';

export function RevenueCatProvider() {
  const userId = useAuthStore((s) => s.user?.id);
  const ready = useAuthStore((s) => s.ready);
  const lastSyncedUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    if (lastSyncedUserId.current === (userId ?? null)) return;

    lastSyncedUserId.current = userId ?? null;

    (async () => {
      await configureRevenueCatOnce(userId ?? null);

      if (userId) {
        await revenueCatLogIn(userId);
      } else {
        await revenueCatLogOut();
      }
    })();
  }, [ready, userId]);

  return null;
}
