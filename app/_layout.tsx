import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
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
import {
  subscribeToTransitionLease,
  hasActiveTransitionLease,
  consumeVerifiedHandoff,
  clearVerifiedHandoff,
} from '@/lib/transitionLease';
import {
  acceptResultForUser,
  canRenderStackForUser,
  shouldShowCustomSplash,
  shouldShowPreparationError,
  createInitialPreparationState,
  createPreparingState,
  createReadyState,
  createErrorState,
  type PreparationState,
} from '@/lib/preparationStateMachine';

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
const SPLASH_BEIGE = '#F7F2E7';

export default function RootLayout() {
  const { session, ready } = useAuthStore();
  const userId = session?.user?.id ?? null;

  const [fontsLoaded] = useFonts({
    Amiri_700Bold,
    Cinzel_600SemiBold,
  });

  // ── Boot completion tracking ──
  // Set once the stack is first rendered (initial boot complete).
  // Never reset — ensures the branded splash is never replayed after
  // login, logout, background return, or any subsequent auth change.
  const bootCompletedRef = useRef(false);

  // ── Dimension A: initial visual release ──
  // The 1200ms branded-splash timer is authed-only. Guests get an immediate
  // release so they see Welcome without delay. Once released, stays released
  // — never re-armed on logout or account switch.
  const [initialVisualReleased, setInitialVisualReleased] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      // Guest: release immediately, no branded splash timer.
      setInitialVisualReleased(true);
      return;
    }
    // Authenticated: start the branded-splash timer only during initial boot.
    // After boot completes, initialVisualReleased is already true and the
    // timer is never re-armed.
    if (bootCompletedRef.current) return;
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setInitialVisualReleased(true);
    }, MIN_LOGO_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [fontsLoaded, ready, session]);

  // ── Transition lease ──
  // When an onboarding transition lease is active (signup/login handler is
  // running finalize+handoff), treat the user as NOT yet authenticated so
  // Stack.Protected keeps the (auth) group mounted and the dashboard does
  // not appear prematurely.
  const leaseActive = useSyncExternalStore(
    subscribeToTransitionLease,
    hasActiveTransitionLease,
    hasActiveTransitionLease,
  );

  // Track the previous lease state to detect lease release.
  const prevLeaseActiveRef = useRef(false);

  // ── Dimension B: account preparation ──
  // Tracks whether the dashboard-critical queries for the CURRENT userId
  // have been resolved. Reset to idle whenever userId changes.
  const [accountPreparation, setAccountPreparation] =
    useState<PreparationState>(createInitialPreparationState());

  // Stable retry counter — incrementing re-triggers the preparation effect.
  const [retryCount, setRetryCount] = useState(0);
  const triggerRetry = useCallback(() => setRetryCount((c) => c + 1), []);

  // Generation token — increments on every preparation effect run. A result
  // is only accepted if the generation at completion time still matches the
  // generation at start time. This covers: account switch, retry, late
  // response, timeout, and React Strict Mode double-invoke.
  const generationRef = useRef(0);

  // Track whether preparation was completed via a verified handoff for the
  // current userId. When true, the preparation effect skips entirely —
  // the cache is already verified and ready. Reset when userId changes.
  const handoffReadyRef = useRef<string | null>(null);
  const prevUserIdRef = useRef<string | null>(null);

  // Clear handoff bypass when userId changes (account switch, logout).
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      handoffReadyRef.current = null;
      clearVerifiedHandoff();
      prevUserIdRef.current = userId;
    }
  }, [userId]);

  // ── Consume verified handoff when lease is released ──
  // When the transition lease transitions from active to inactive, the
  // signup/login handler has already populated and verified the cache.
  // If a verified handoff exists for the current userId, we can skip
  // the preparing state entirely — set accountPreparation directly to
  // ready. This eliminates the white/beige screen that would otherwise
  // appear between the signup screen and the dashboard.
  //
  // If no handoff exists (error path, session change, or userId mismatch),
  // fall back to the preparing state so the preparation effect runs
  // normally.
  useEffect(() => {
    if (prevLeaseActiveRef.current && !leaseActive && userId) {
      const handoff = consumeVerifiedHandoff(userId);
      if (handoff) {
        // Cache is verified — skip preparing, go directly to ready.
        handoffReadyRef.current = userId;
        setAccountPreparation(createReadyState(userId));
      } else {
        // No valid handoff — run normal preparation.
        handoffReadyRef.current = null;
        setAccountPreparation(createPreparingState(userId));
      }
    }
    prevLeaseActiveRef.current = leaseActive;
  }, [leaseActive, userId]);

  useEffect(() => {
    if (!ready || !userId) return;
    // Skip preparation while a transition lease is active — the signup/login
    // handler is running finalize+handoff and will release the lease when
    // the cache is ready. prepareAuthenticatedLaunch would run prematurely.
    if (leaseActive) return;
    // Skip if preparation was already completed via a verified handoff
    // for this exact userId — the cache is already populated and verified.
    // But NOT on retry — a manual retry must re-run preparation.
    if (handoffReadyRef.current === userId && retryCount === 0) return;

    const generation = ++generationRef.current;
    let cancelled = false;
    const preparationUserId = userId;

    setAccountPreparation(createPreparingState(preparationUserId));

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
        // or userId (account switch, retry, or Strict Mode double-invoke).
        if (!acceptResultForUser(
          generation,
          generationRef.current,
          preparationUserId,
          useAuthStore.getState().session?.user?.id ?? null,
        )) return;

        if (result.status === 'ready') {
          setAccountPreparation(createReadyState(preparationUserId));
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
          setAccountPreparation(createErrorState(preparationUserId, result.error));
        }
      });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [ready, userId, retryCount, leaseActive]);

  // ── Gate decision ──
  // While a transition lease is active, the signup/login screen is still
  // mounted and running finalize+handoff. The session may already exist in
  // Supabase, but we must NOT treat the user as authenticated — the route
  // group must not swap yet.
  const authed = ready && !!session && !leaseActive;
  const guest = ready && (!session || leaseActive);

  // For authenticated users, also require account preparation.
  const canRenderStack = canRenderStackForUser(
    initialVisualReleased,
    ready,
    authed,
    accountPreparation,
    userId,
  );

  const showPreparationError = shouldShowPreparationError(
    authed,
    accountPreparation,
    userId,
  );

  const showBrandedSplash = shouldShowCustomSplash(
    bootCompletedRef.current,
    ready,
    authed,
    canRenderStack,
    showPreparationError,
  );

  // Minimal beige screen: during resolving (session unknown) or post-boot
  // preparation (e.g. after in-app login). Never the branded splash.
  const showMinimalScreen =
    !ready || (bootCompletedRef.current && authed && !canRenderStack && !showPreparationError);

  // Mark boot complete once the stack is first rendered.
  useEffect(() => {
    if (canRenderStack) {
      bootCompletedRef.current = true;
    }
  }, [canRenderStack]);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthBootstrap />
      <RevenueCatProvider />
      {showMinimalScreen ? (
        <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />
      ) : showBrandedSplash ? (
        <ColdStartSplash fontsLoaded={fontsLoaded} />
      ) : showPreparationError ? (
        <LaunchErrorScreen onRetry={triggerRetry} />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F5F0E6' } }}>
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
      )}
    </QueryClientProvider>
  );
}
