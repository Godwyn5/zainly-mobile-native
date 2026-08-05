import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_600SemiBold } from '@expo-google-fonts/cinzel';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';
import { RevenueCatProvider } from '@/components/providers/RevenueCatProvider';
import { ColdStartSplash } from '@/components/launch/ColdStartSplash';
import { LaunchErrorScreen } from '@/components/launch/LaunchErrorScreen';
import { prepareAuthenticatedLaunch } from '@/lib/prepareAuthenticatedLaunch';
import { clearOnboardingStateForSessionExpiry } from '@/lib/pendingOnboardingPlan';

// ── Foreground notification handler ──────────────────────────────────────────
// Must be called once at module level (outside any component).
// Without this, expo-notifications silently discards every foreground
// notification — the SDK default is to NOT show them.
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
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
  // Clear all onboarding state for the expired session:
  // - Draft is cleared unconditionally (no ownerUserId, must not leak).
  // - Pending payload is cleared only if owned by a specific user.
  // - Unclaimed pre-auth pending payload survives (may belong to a new flow).
  try { await clearOnboardingStateForSessionExpiry(); } catch { /* non-fatal */ }
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
      (event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ── 2D Gate ──────────────────────────────────────────────────────────────────

const MIN_LOGO_VISIBLE_MS = 1200;
const PREPARATION_TIMEOUT_MS = 10_000;

type AccountPreparationState = {
  userId: string | null;
  status: 'idle' | 'preparing' | 'ready' | 'error';
  error?: unknown;
};

export default function RootLayout() {
  const { session, ready } = useAuthStore();
  const userId = session?.user?.id ?? null;

  const [fontsLoaded] = useFonts({
    Amiri_700Bold,
    Cinzel_600SemiBold,
  });

  // ── Dimension A: initial visual release ──
  // Timer starts only when fontsLoaded becomes true. Once released, stays
  // released — never re-armed on logout or account switch.
  const [initialVisualReleased, setInitialVisualReleased] = useState(false);

  useEffect(() => {
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setInitialVisualReleased(true);
    }, MIN_LOGO_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  // ── Dimension B: account preparation ──
  // Tracks whether the dashboard-critical queries for the CURRENT userId
  // have been resolved. Reset to idle whenever userId changes.
  const [accountPreparation, setAccountPreparation] =
    useState<AccountPreparationState>({
      userId: null,
      status: 'idle',
    });

  // Stable retry counter — incrementing re-triggers the preparation effect.
  const [retryCount, setRetryCount] = useState(0);
  const triggerRetry = useCallback(() => setRetryCount((c) => c + 1), []);

  // Generation token — increments on every preparation effect run. A result
  // is only accepted if the generation at completion time still matches the
  // generation at start time. This covers: account switch, retry, late
  // response, timeout, and React Strict Mode double-invoke.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!ready || !userId) return;

    const generation = ++generationRef.current;
    let cancelled = false;
    const preparationUserId = userId;

    setAccountPreparation({
      userId: preparationUserId,
      status: 'preparing',
    });

    const preparationPromise = prepareAuthenticatedLaunch(
      queryClient,
      preparationUserId,
      { force: retryCount > 0 },
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ status: 'error'; error: unknown }>(
      (resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ status: 'error', error: 'timeout' });
        }, PREPARATION_TIMEOUT_MS);
      },
    );

    Promise.race([preparationPromise, timeoutPromise])
      .then((result) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (cancelled) return;
        // Guard against stale completion from a previous generation
        // (account switch, retry, or Strict Mode double-invoke).
        if (generationRef.current !== generation) return;
        // Guard against stale completion from a previous userId.
        if (useAuthStore.getState().session?.user?.id !== preparationUserId) return;

        if (result.status === 'ready') {
          setAccountPreparation({
            userId: preparationUserId,
            status: 'ready',
          });
        } else {
          // On timeout: cancel only the preparation queries scoped to
          // preparationUserId so their late results don't populate the
          // cache. Unrelated queries (e.g. session/background refreshes)
          // are intentionally left running.
          if (result.error === 'timeout') {
            const cancelKeys = [
              ['plan', preparationUserId],
              ['progress', preparationUserId],
              ['dueReviews', preparationUserId],
              ['profile', preparationUserId],
              ['revenueCatCustomerInfo', preparationUserId],
              ['pendingOnboarding', preparationUserId],
            ];
            cancelKeys.forEach((queryKey) => {
              queryClient.cancelQueries({ queryKey }).catch(() => {/* non-fatal */});
            });
          }
          setAccountPreparation({
            userId: preparationUserId,
            status: 'error',
            error: result.error,
          });
        }
      });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [ready, userId, retryCount]);

  // ── Gate decision ──
  const showSplash = !fontsLoaded || !initialVisualReleased || !ready;

  const authed = ready && !!session;
  const guest = ready && !session;

  // For authenticated users, also require account preparation.
  const canRenderStack =
    initialVisualReleased &&
    ready &&
    (!authed || (accountPreparation.userId === userId && accountPreparation.status === 'ready'));

  const showPreparationError =
    authed &&
    accountPreparation.userId === userId &&
    accountPreparation.status === 'error';

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthBootstrap />
      <RevenueCatProvider />
      {showSplash ? (
        <ColdStartSplash fontsLoaded={fontsLoaded} />
      ) : showPreparationError ? (
        <LaunchErrorScreen onRetry={triggerRetry} />
      ) : canRenderStack ? (
        <Stack screenOptions={{ headerShown: false }}>
          {/* Private routes — accessible ONLY when authenticated.
              When session becomes null, these are automatically removed
              and their history is cleared by Stack.Protected. */}
          <Stack.Protected guard={authed}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>

          {/* Public routes — accessible when NOT authenticated.
              When session becomes true, these are automatically removed. */}
          <Stack.Protected guard={guest}>
            <Stack.Screen name="welcome" />
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
          </Stack.Protected>

          {/* Onboarding V1 adapters, V2 flow, and premium paywall —
              accessible in any auth state. V1 adapters redirect to V2. */}
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="onboarding-v2" />
          <Stack.Screen name="premium" />
        </Stack>
      ) : (
        <ColdStartSplash fontsLoaded={fontsLoaded} />
      )}
    </QueryClientProvider>
  );
}
