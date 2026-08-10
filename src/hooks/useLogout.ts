// ─── useLogout ────────────────────────────────────────────────────────────────
// Full identity reset: Supabase signOut → clear RQ cache → clear Zustand stores
// → wipe user-scoped AsyncStorage keys.
// Navigation is handled declaratively by Stack.Protected in app/_layout.tsx:
// when session becomes null, the (app) group is automatically removed.

import { useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { supabase }              from '@/db/client';
import { useAuthStore }          from '@/store/authStore';
import { useSessionResultStore } from '@/store/sessionResultStore';
import { cancelUserHifzNotifications } from '@/notifications/scheduler';
import { clearNotificationData }       from '@/notifications/storage';
import { revenueCatLogOut }            from '@/lib/revenueCat';
import { clearAllPendingOnboardingData } from '@/lib/pendingOnboardingPlan';
import { clearOnboardingDraft }           from '@/lib/onboardingDraft';
import { signOutGoogle, invalidateAllSocialAuthAttempts } from '@/lib/socialAuth';

export function useLogout() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const queryClient    = useQueryClient();
  const setSession     = useAuthStore(s => s.setSession);
  const userId         = useAuthStore(s => s.user?.id);
  const clearResult    = useSessionResultStore(s => s.clearResult);

  async function performLogout(opts?: { preserveDeletionFlag?: boolean }) {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    // 0. Invalidate any in-flight social auth attempt — a late OAuth callback
    //    arriving after logout must not exchange its token for a session.
    invalidateAllSocialAuthAttempts();

    try {
      // 1. Sign out from Supabase (clears persisted session in AsyncStorage via the client).
      //    Best-effort: after account deletion the Auth user no longer exists server-side,
      //    so this call can fail — local cleanup below must still run regardless.
      const { error } = await supabase.auth.signOut();
      if (error && __DEV__) console.warn('[useLogout] signOut error (ignored, best-effort):', error.message);

      // 2. Best-effort RevenueCat identity reset — must never affect logout flow
      await revenueCatLogOut().catch(() => {/* non-fatal */});

      // 2a. Best-effort Google Sign-Out — clears the native Google credential
      // so a different account can sign in after logout. Must never affect flow.
      await signOutGoogle();

      // 2b. Clear any pending onboarding-v2 payload — a logout must never
      // leave a pending plan that a different account could claim after
      // re-login. This is the primary defense against A→B leakage.
      await clearAllPendingOnboardingData().catch(() => {/* non-fatal */});
      // 2c. Clear the in-memory onboarding draft — it has no ownerUserId or
      // flowId, so it must be wiped at every auth boundary to prevent
      // account A's answers from being finalized by account B.
      await clearOnboardingDraft().catch(() => {/* non-fatal */});

      // 3. Clear React Query cache so next user starts fresh
      queryClient.clear();

      // 4. Clear sessionResultStore
      clearResult();

      // 5. Wipe user-scoped AsyncStorage keys
      if (userId) {
        // Cancel scheduled Hifz reminders for this user — prevents stale
        // notifications firing for a different account after re-login.
        await cancelUserHifzNotifications(userId).catch(() => {});
        await clearNotificationData(userId).catch(() => {});

        // V1 onboarding keys — no longer written by any code, but may still
        // exist on devices that used a previous app version. Clean them at
        // logout as a cheap migration safety net to prevent cross-account
        // data leakage.
        const keys = [
          `zainly:onboardingIntroSeen:${userId}`,
          `zainly:onboardingPersonalAnswers:${userId}`,
        ];
        await AsyncStorage.multiRemove(keys).catch(() => {/* non-fatal */});
      }

      // 5b. Clean any stale account-deletion flag — a simple logout must never
      //     display the "account deleted" banner. When called from
      //     performAccountDeletion (preserveDeletionFlag), the flag is kept so
      //     welcome.tsx can show the confirmation banner after navigation.
      if (!opts?.preserveDeletionFlag) {
        await AsyncStorage.removeItem('account_deleted_success').catch(() => {});
      }

      // 6. Reset auth Zustand store — Stack.Protected handles navigation
      setSession(null);

    } catch (err) {
      setIsLoggingOut(false);
      const msg = err instanceof Error ? err.message : 'Erreur inconnue.';
      Alert.alert('Erreur', `Impossible de se déconnecter.\n${msg}`);
    }
    // Note: isLoggingOut is intentionally NOT reset to false on success —
    // the component will unmount when the auth guard redirects to login.
  }

  function confirmLogout() {
    Alert.alert(
      'Se déconnecter ?',
      'Tu devras te reconnecter pour accéder à ton plan.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Se déconnecter', style: 'destructive', onPress: () => performLogout() },
      ],
    );
  }

  return { confirmLogout, isLoggingOut, performLogout };
}
