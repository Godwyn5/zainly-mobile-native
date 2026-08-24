import { useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';
import { useSessionResultStore } from '@/store/sessionResultStore';
import { revenueCatLogOut } from '@/lib/revenueCat';
import { cancelUserHifzNotifications } from '@/notifications/scheduler';
import { clearNotificationData } from '@/notifications/storage';

/**
 * Generic sign-out primitive.
 * Resets Supabase, RevenueCat, the React Query cache, local session and
 * user-scoped resources so the next account never sees the previous user's data.
 */
export function useLogout() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const busyRef = useRef(false);
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const userId = useAuthStore((s) => s.user?.id);
  const clearResult = useSessionResultStore((s) => s.clearResult);

  const performLogout = useCallback(async (opts?: { preserveDeletionFlag?: boolean }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsLoggingOut(true);
    try {
      // 1. Invalidate server-side Supabase session first.
      const { error } = await supabase.auth.signOut();
      if (error && __DEV__) {
        console.warn('[useLogout] signOut error (best-effort ignored):', error.message);
      }

      // 2. Reset RevenueCat identity before the Zustand user disappears,
      //    so the provider does not attempt to log in B as A on a fast switch.
      await revenueCatLogOut().catch(() => {/* non-fatal */});

      // 3. Purge user-scoped notifications.
      if (userId) {
        await cancelUserHifzNotifications(userId).catch(() => {});
        await clearNotificationData(userId).catch(() => {});
      }

      // 4. Wipe the local query cache and any in-memory session result.
      queryClient.clear();
      clearResult();

      // 5. Remove the "account deleted" banner unless we are logging out
      //    as part of an account-deletion flow (where welcome.tsx needs to
      //    display the confirmation next).
      if (!opts?.preserveDeletionFlag) {
        await AsyncStorage.removeItem('account_deleted_success').catch(() => {});
      }

      // 6. Finally reset the auth store. Navigation is declarative: the root
      //    AuthGate will switch back to the public placeholder once session
      //    becomes null.
      setSession(null);
    } catch (err) {
      busyRef.current = false;
      setIsLoggingOut(false);
      if (__DEV__) {
        console.warn('[useLogout] logout failed', err);
      }
    }
    // isLoggingOut is intentionally left true on success because the
    // component will unmount as the auth guard redirects away.
  }, [queryClient, setSession, userId, clearResult]);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      'Se déconnecter ?',
      'Tu seras déconnecté de Zainly.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Se déconnecter', style: 'destructive', onPress: () => performLogout() },
      ],
      { cancelable: true },
    );
  }, [performLogout]);

  return { confirmLogout, isLoggingOut, performLogout };
}
