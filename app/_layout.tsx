import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_600SemiBold } from '@expo-google-fonts/cinzel';
import { supabase } from '@/db/client';
import { useAuthStore } from '@/store/authStore';
import { RevenueCatProvider } from '@/components/providers/RevenueCatProvider';
import { DashboardReadyProvider } from '@/components/providers/DashboardReadyProvider';
import { ColdStartSplash } from '@/components/launch/ColdStartSplash';
import { LaunchErrorScreen } from '@/components/launch/LaunchErrorScreen';
import { TransitionCoverOverlay } from '@/components/auth/TransitionCoverOverlay';
import { prepareAuthenticatedLaunch, purgeUserScopedCaches } from '@/lib/prepareAuthenticatedLaunch';
import { clearOnboardingStateForSessionExpiry, hasValidPendingOnboardingPlan, readActiveOnboardingAuthFlow } from '@/lib/pendingOnboardingPlan';
import { clearOnboardingDraftForOwner, prepareGuestLaunchIfNeeded } from '@/lib/onboardingDraft';
import {
  subscribeToTransitionLease,
  getLeaseSnapshot,
  clearTransitionLease,
  forceReleaseTransitionLease,
} from '@/lib/transitionLease';
import {
  acceptResultForUser,
  canRenderStackForUser,
  canRenderOnboardingStackForUser,
  shouldShowCustomSplash,
  shouldShowPreparationError,
  shouldShowMinimalOverlay,
  shouldSignOutForAccountNotFound,
  createInitialPreparationState,
  createPreparingState,
  createReadyState,
  createAccountNotFoundState,
  createErrorState,
  type PreparationState,
} from '@/lib/preparationStateMachine';
import { configureGoogleSignIn } from '@/lib/socialAuth';
import AccountNotFoundScreen, {
  type AccountNotFoundPhase,
} from '@/components/auth/AccountNotFoundScreen';

// ── Google Sign-In configuration (module level, runs once) ──────────────────
// webClientId is required to obtain an idToken from Google Sign-In.
// iosClientId is optional — if omitted, the plugin reads from GoogleService-Info.plist.
const _googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const _googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
if (_googleWebClientId) {
  configureGoogleSignIn(_googleWebClientId, _googleIosClientId);
} else if (__DEV__) {
  console.warn(
    '[socialAuth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing — Google Sign-In will not produce an idToken.'
  );
}

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
      .then(async ({ data: { session }, error }) => {
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
        // Guest path: clear stale guest draft BEFORE setReady() so no
        // onboarding screen can read an old firstName during bootstrap.
        // Authenticated path: no cleanup needed — user drafts are isolated.
        if (!session) {
          await prepareGuestLaunchIfNeeded(
            hasValidPendingOnboardingPlan,
            readActiveOnboardingAuthFlow,
          );
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
        // Do NOT clear the onboarding draft here. The draft is now
        // physically isolated by owner key in AsyncStorage — user A's
        // draft is under a different key than user B's, so no global
        // clear is needed at auth boundaries.
        //
        // INITIAL_SESSION(null): a guest draft may exist and must survive
        //   until explicit claim or abandonment.
        // SIGNED_IN: a guest draft must survive for guest→user claim.
        // SIGNED_OUT: the previous user's draft is under their own key;
        //   it is not visible to the next user.
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
  const pathname = usePathname();

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

  // ── Transition lease — atomic state machine ──
  // The snapshot contains the full handoff identity (userId, flowId,
  // leaseId, sessionGen, cacheVerified, visual). We read it synchronously
  // during render via useSyncExternalStore.
  //
  // Phases: IDLE → ACTIVE → DATA_READY_COVERED → DASHBOARD_READY → IDLE
  //
  // DATA_READY_COVERED: lease inactive for routing AND handoff verified.
  //   canRenderStack=true so the Stack mounts with (app) behind.
  //   A signup cover overlay is shown on top until the dashboard signals.
  // DASHBOARD_READY: dashboard confirmed plan+progress+onLayout.
  //   accountPreparation committed to 'ready', cover removed, token cleared.
  const leaseSnapshot = useSyncExternalStore(
    subscribeToTransitionLease,
    getLeaseSnapshot,
    getLeaseSnapshot,
  );

  const leaseActive = leaseSnapshot.phase === 'active';

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
  // Do NOT clear the onboarding draft on null→userId: that is the
  // guest→auth transition where the guest draft must survive for
  // claimDraftForUser. Do NOT clear on userId→null: useLogout handles
  // its own targeted cleanup. Only clear on user-a→user-b: remove
  // user-a's draft so it doesn't linger in AsyncStorage (B can't read
  // it anyway due to physical key isolation, but we clean up for hygiene).
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      handoffReadyRef.current = null;
      forceReleaseTransitionLease();
      // Only clear previous user's draft on actual user-a→user-b switch.
      // null→userId (login) and userId→null (logout) are handled elsewhere.
      if (prevUserIdRef.current && userId && prevUserIdRef.current !== userId) {
        clearOnboardingDraftForOwner(
          { kind: 'authenticated', userId: prevUserIdRef.current }
        ).catch(() => { /* non-fatal */ });
      }
      prevUserIdRef.current = userId;
    }
  }, [userId]);

  // ── Synchronous handoff matching during render ──
  // Compute matchingReadyHandoff from the snapshot read during THIS render.
  // When true, canRenderStack=true so the Stack mounts with (app) behind.
  // The cover overlay is shown on top until the dashboard signals ready.
  const matchingReadyHandoff =
    (leaseSnapshot.phase === 'data_ready_covered' ||
      leaseSnapshot.phase === 'dashboard_ready') &&
    leaseSnapshot.userId === userId &&
    leaseSnapshot.cacheVerified === true;

  // ── Cover overlay: mounted from ACTIVE through DATA_READY_COVERED ──
  // Decided synchronously during render — never in an effect.
  // Mounting already during ACTIVE (as soon as the lease's visual snapshot
  // is available) means the SAME overlay instance is already sitting on
  // top, unconditionally, BEFORE Stack.Protected ever swaps (auth) for
  // (app) at DATA_READY_COVERED — closing the native-stack transition race
  // where a freshly-mounted overlay could be outrun by react-native-screens'
  // own route-removal transition. It is removed only once the dashboard
  // reports its first onLayout (phase leaves DATA_READY_COVERED).
  const showCoverOverlay =
    leaseSnapshot.phase === 'active' ||
    (leaseSnapshot.phase === 'data_ready_covered' &&
      leaseSnapshot.userId === userId &&
      leaseSnapshot.cacheVerified === true);

  // ── Promote DASHBOARD_READY → commit durable state → clear token ──
  // This effect runs AFTER the render in which the dashboard signaled
  // ready. It commits the durable accountPreparation state to 'ready'
  // and then clears the lease token. The durable state ensures
  // subsequent renders stay ready even after the token is cleared.
  useEffect(() => {
    if (leaseSnapshot.phase === 'dashboard_ready' && leaseSnapshot.userId === userId && userId) {
      handoffReadyRef.current = userId;
      setAccountPreparation(createReadyState(userId));
      const leaseId = leaseSnapshot.leaseId;
      if (leaseId) {
        clearTransitionLease(leaseId);
      }
    }
  }, [leaseSnapshot, userId]);

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
        } else if (result.status === 'account_not_found') {
          setAccountPreparation(createAccountNotFoundState(preparationUserId));
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

  // ── account_not_found: fail-closed local sign-out + cache purge ──
  // When prepareAuthenticatedLaunch returns 'account_not_found', the user
  // authenticated (e.g. via Google) but has no Zainly account (plan +
  // progress both null, no pending onboarding). We sign out locally and
  // purge user-scoped caches so no stale data leaks.
  //
  // Three-phase state machine:
  //   signing_out     — signOut in flight, buttons disabled, spinner shown
  //   ready_to_choose — signOut succeeded + caches purged + session null,
  //                     buttons enabled
  //   sign_out_error  — signOut failed, error + retry shown, no navigation
  //
  // CRITICAL: accountNotFoundUserId is set BEFORE calling signOut. This
  // ensures the overlay stays visible when onAuthStateChange fires
  // (setSession(null) → userId null → authed false). Without this, the
  // overlay would disappear for one render frame, briefly exposing the
  // guest auth stack.
  const [accountNotFoundUserId, setAccountNotFoundUserId] =
    useState<string | null>(null);
  const [accountNotFoundPhase, setAccountNotFoundPhase] =
    useState<AccountNotFoundPhase | null>(null);
  const accountNotFoundSignOutRef = useRef<string | null>(null);
  const [accountNotFoundRetryCount, setAccountNotFoundRetryCount] =
    useState(0);

  useEffect(() => {
    if (!shouldSignOutForAccountNotFound(authed, accountPreparation, userId)) return;
    if (!userId) return;
    // Idempotency: prevent concurrent signOut calls from multiple Auth
    // events or React effect re-invocations (e.g. Strict Mode double-invoke).
    if (accountNotFoundSignOutRef.current === userId) return;

    accountNotFoundSignOutRef.current = userId;
    // Set userId + phase BEFORE the async signOut so the overlay is
    // already visible when the session-null transition fires.
    setAccountNotFoundUserId(userId);
    setAccountNotFoundPhase('signing_out');

    let cancelled = false;
    (async () => {
      try {
        await supabase.auth.signOut({ scope: 'local' });
        if (cancelled) return;
        purgeUserScopedCaches(queryClient, userId);
        // Belt-and-suspenders: confirm local session is null for this user.
        if (useAuthStore.getState().session?.user?.id === userId) {
          useAuthStore.getState().setSession(null);
        }
        setAccountNotFoundPhase('ready_to_choose');
      } catch {
        if (cancelled) return;
        // Clear the ref so a retry can re-enter.
        accountNotFoundSignOutRef.current = null;
        setAccountNotFoundPhase('sign_out_error');
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, accountPreparation.status, userId, accountNotFoundRetryCount]);

  // Clear the account-not-found overlay when a different user logs in.
  useEffect(() => {
    if (userId && accountNotFoundUserId && userId !== accountNotFoundUserId) {
      setAccountNotFoundUserId(null);
      setAccountNotFoundPhase(null);
      accountNotFoundSignOutRef.current = null;
    }
  }, [userId, accountNotFoundUserId]);

  const dismissAccountNotFound = useCallback(() => {
    setAccountNotFoundUserId(null);
    setAccountNotFoundPhase(null);
    accountNotFoundSignOutRef.current = null;
  }, []);

  const retryAccountNotFoundSignOut = useCallback(() => {
    setAccountNotFoundPhase('signing_out');
    setAccountNotFoundRetryCount((c) => c + 1);
  }, []);

  // For authenticated users, also require account preparation.
  // matchingReadyHandoff is computed synchronously during render from the
  // lease snapshot. When true, it is equivalent to accountPreparation ===
  // 'ready' for this exact render — canRenderStack is true immediately,
  // showMinimalScreen stays false, and the dashboard mounts without any
  // intermediate beige screen.
  const preparationReady =
    (accountPreparation.userId === userId &&
      accountPreparation.status === 'ready') ||
      matchingReadyHandoff;

  const canRenderStack = canRenderStackForUser(
    initialVisualReleased,
    ready,
    authed,
    { userId, status: preparationReady ? 'ready' : accountPreparation.status },
    userId,
  );

  // Separate gate for needs_onboarding: the Stack must mount so expo-router
  // can navigate to /onboarding-v2/name, but (app) must NOT be included.
  // The splash stays on top until the onboarding route is ready.
  const canRenderOnboardingStack = canRenderOnboardingStackForUser(
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

  // Minimal beige screen: during resolving (session unknown), post-boot
  // preparation (e.g. after in-app login), or needs_onboarding BEFORE the
  // onboarding-v2 route is active. Once the user is on any /onboarding-v2/*
  // route, the overlay disappears so they can interact with the onboarding
  // screens. It does NOT reappear on step changes within onboarding-v2.
  // It also disappears after finalization (status becomes 'ready', not
  // 'needs_onboarding', so canRenderOnboardingStack becomes false).
  const onboardingRouteActive = pathname.startsWith('/onboarding-v2/');
  const showMinimalScreen = shouldShowMinimalOverlay(
    ready,
    authed,
    bootCompletedRef.current,
    canRenderStack,
    canRenderOnboardingStack,
    showPreparationError,
    onboardingRouteActive,
  );

  // Mark boot complete once the stack is first rendered (either app or
  // onboarding-only). This prevents the branded splash from replaying.
  useEffect(() => {
    if (canRenderStack || canRenderOnboardingStack) {
      bootCompletedRef.current = true;
    }
  }, [canRenderStack, canRenderOnboardingStack]);

  // ── Navigate to onboarding-v2 for needs_onboarding users ────────────
  // Fire exactly once per stable (userId + needs_onboarding) pair. The
  // ref guard prevents duplicate navigation on re-render. The Stack is
  // already mounted with onboarding-v2 routes (canRenderOnboardingStack),
  // so router.replace is safe here.
  const onboardingNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (canRenderOnboardingStack && userId && onboardingNavRef.current !== userId) {
      onboardingNavRef.current = userId;
      // Use a microtask to ensure the Stack has mounted before navigating.
      // This avoids 'navigation not ready' errors during initial boot.
      requestAnimationFrame(() => {
        router.replace('/onboarding-v2/name');
      });
    }
    // Reset the ref when userId changes or needs_onboarding clears so a
    // future needs_onboarding for the same or different user can fire.
    if (!canRenderOnboardingStack && onboardingNavRef.current !== null) {
      onboardingNavRef.current = null;
    }
  }, [canRenderOnboardingStack, userId]);

  const showAccountNotFound =
    !!accountNotFoundUserId && ready && accountNotFoundPhase !== null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthBootstrap />
      <RevenueCatProvider />
      {showAccountNotFound ? (
        <AccountNotFoundScreen
          phase={accountNotFoundPhase}
          onCommencer={() => {
            dismissAccountNotFound();
            router.replace('/onboarding-v2/name');
          }}
          onAutreCompte={() => {
            dismissAccountNotFound();
            router.replace('/welcome');
          }}
          onRetry={retryAccountNotFoundSignOut}
        />
      ) : canRenderOnboardingStack ? (
        // ── needs_onboarding: mount Stack with ONLY onboarding-v2 routes ──
        // The splash/minimal screen is layered on top via showMinimalScreen
        // so the user never sees the Stack until the onboarding route is
        // ready. (app) and public routes are excluded — no tabs, no
        // TodayScreen, no dashboard content.
        <>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: SPLASH_BEIGE } }}>
            {/* Onboarding V2 flow — accessible in any auth state. */}
            <Stack.Screen name="onboarding-v2" />
          </Stack>
          {showMinimalScreen && (
            <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />
          )}
        </>
      ) : showMinimalScreen ? (
        <View style={{ flex: 1, backgroundColor: SPLASH_BEIGE }} />
      ) : showBrandedSplash ? (
        <ColdStartSplash fontsLoaded={fontsLoaded} />
      ) : showPreparationError ? (
        <LaunchErrorScreen onRetry={triggerRetry} />
      ) : (
        <DashboardReadyProvider>
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
              <Stack.Screen name="welcome" options={{ animation: 'none', contentStyle: { backgroundColor: '#F7F2E7' } }} />
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" options={{ animation: 'none', contentStyle: { backgroundColor: '#F7F2E7' } }} />
            </Stack.Protected>

            {/* Onboarding V1 adapters, V2 flow, and premium paywall —
                accessible in any auth state. V1 adapters redirect to V2. */}
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="onboarding-v2" options={{ animation: 'none', contentStyle: { backgroundColor: '#F7F2E7' } }} />
            <Stack.Screen name="premium" />
          </Stack>
          {showCoverOverlay && leaseSnapshot.visual && (
            <TransitionCoverOverlay visible={showCoverOverlay} visual={leaseSnapshot.visual} />
          )}
        </DashboardReadyProvider>
      )}
    </QueryClientProvider>
  );
}
