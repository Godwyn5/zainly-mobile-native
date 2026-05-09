import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function isStaleTokenError(msg: string): boolean {
  return (
    msg.includes('Invalid Refresh Token') ||
    msg.includes('Refresh Token Not Found') ||
    msg.includes('refresh_token_not_found')
  );
}

async function clearInvalidAuthSession(
  setSession: (s: null) => void,
  setReady: () => void,
) {
  try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
  setSession(null);
  setReady();
}

function AuthBootstrap() {
  const { setSession, setReady } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          if (isStaleTokenError(error.message)) {
            clearInvalidAuthSession(setSession, setReady);
          } else {
            if (__DEV__) console.warn('[auth] getSession error (non-token)');
            setSession(null);
            setReady();
          }
          return;
        }
        setSession(session);
        setReady();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (isStaleTokenError(msg)) {
          clearInvalidAuthSession(setSession, setReady);
        } else {
          if (__DEV__) console.warn('[auth] getSession threw (non-token)');
          setSession(null);
          setReady();
        }
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthBootstrap />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
