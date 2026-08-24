// ─── ROOT LAYOUT ─────────────────────────────────────────────────────────────
// Minimal technical shell. No visible screen, no onboarding, no recovery.
// It only hydrates the Supabase session, wraps providers, and guards routes.

import { useEffect } from 'react';
import { View } from 'react-native';
import { Slot, Redirect, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';
import { RevenueCatProvider } from '@/components/providers/RevenueCatProvider';
import { colors } from '@/theme/colors';

// Foreground notifications must be handled once at module level.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function NeutralSplash() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    />
  );
}

export function AuthGate() {
  const { session, ready } = useAuthStore();
  const userId = session?.user?.id ?? null;
  const pathname = usePathname();

  // While Supabase session hydration is unresolved, expose no business route.
  if (!ready) {
    return <NeutralSplash />;
  }

  if (userId) {
    // Authenticated users must never land on the public placeholder.
    if (pathname === '/' || pathname === '') {
      return <Redirect href="/(app)" />;
    }
  } else {
    // Unauthenticated users must never reach the protected (app) group.
    if (pathname.startsWith('/(app)')) {
      return <Redirect href="/" />;
    }
  }

  return <Slot />;
}

export default function RootLayout() {
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const next = data.session;
      useAuthStore.getState().setSession(next);
      useAuthStore.getState().setReady();
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      useAuthStore.getState().setSession(session);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <RevenueCatProvider>
        <AuthGate />
      </RevenueCatProvider>
    </QueryClientProvider>
  );
}
