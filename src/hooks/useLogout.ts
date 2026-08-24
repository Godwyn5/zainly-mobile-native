import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';

/**
 * Generic sign-out primitive.
 * Clears the Supabase session, the auth store, and the React Query cache
 * so the next user never sees the previous user's data.
 */
export function useLogout() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);

  const performLogout = useCallback(async (opts?: { preserveDeletionFlag?: boolean }) => {
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      queryClient.clear();
      setSession(null);
    } catch (err) {
      if (__DEV__) {
        console.warn('[useLogout] signOut failed', err);
      }
    } finally {
      setIsLoggingOut(false);
    }
  }, [queryClient, setSession]);

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
