// ─── useLogout ────────────────────────────────────────────────────────────────
// Full identity reset: Supabase signOut → clear RQ cache → clear Zustand stores
// → wipe user-scoped AsyncStorage keys.
// The app/(app)/_layout.tsx auth guard will handle navigation automatically
// once authStore.session becomes null.

import { useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { supabase }              from '@/db/client';
import { useAuthStore }          from '@/store/authStore';
import { useSessionResultStore } from '@/store/sessionResultStore';

export function useLogout() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const queryClient    = useQueryClient();
  const setSession     = useAuthStore(s => s.setSession);
  const userId         = useAuthStore(s => s.user?.id);
  const clearResult    = useSessionResultStore(s => s.clearResult);

  async function performLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      // 1. Sign out from Supabase (clears persisted session in AsyncStorage via the client)
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // 2. Clear React Query cache so next user starts fresh
      queryClient.clear();

      // 3. Clear sessionResultStore
      clearResult();

      // 4. Wipe user-scoped AsyncStorage keys
      if (userId) {
        const keys = [
          `zainly:onboardingIntroSeen:${userId}`,
          `zainly:onboardingPersonalAnswers:${userId}`,
        ];
        await AsyncStorage.multiRemove(keys).catch(() => {/* non-fatal */});
      }

      // 5. Reset auth Zustand store — triggers app/(app)/_layout.tsx guard → /(auth)/login
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
        { text: 'Se déconnecter', style: 'destructive', onPress: performLogout },
      ],
    );
  }

  return { confirmLogout, isLoggingOut };
}
