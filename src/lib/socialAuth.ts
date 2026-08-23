// ─── Social auth — Apple & Google native sign-in via Supabase signInWithIdToken ─
//
// Architecture:
//   1. Provider adapters acquire native credentials (identityToken / idToken).
//   2. A normalized result type (SocialAuthResult) is produced — never nullable token.
//   3. The coordinator exchanges the token via supabase.auth.signInWithIdToken,
//      then reuses the existing onboarding transition pipeline when flowId is present.
//
// Nonce contract:
//   - Apple: a raw random nonce is generated. SHA-256(rawNonce) as hex is passed
//     to signInAsync({ nonce: hashedNonce }). The RAW nonce is passed to
//     signInWithIdToken({ nonce: rawNonce }). Supabase hashes it server-side
//     and compares to the `nonce` claim in Apple's JWT.
//   - Google: the Original API does not support a nonce parameter. signInWithIdToken
//     is called without nonce for Google.

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleSignin,
  isSuccessResponse,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
  type SignInResponse,
  type ConfigureParams,
} from '@react-native-google-signin/google-signin';
import { supabase } from '@/db/client';
import type { QueryClient } from '@tanstack/react-query';
import {
  beginOnboardingTransition,
  setTransitionUserId,
  runOnboardingTransition,
  type OnboardingTransitionResult,
} from '@/lib/onboardingTransition';
import {
  releaseTransitionLease,
  type SignupVisualSnapshot,
} from '@/lib/transitionLease';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import {
  clearPendingOnboardingIfMatches,
  clearSessionAuthFlowId,
  invalidateStaleOnboardingAuthorization,
} from '@/lib/pendingOnboardingPlan';
import { purgeUserScopedCaches } from '@/lib/prepareAuthenticatedLaunch';
import { clearOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useAuthStore } from '@/store/authStore';

// ─── Attempt generation guard & unified session mutation queue ──────────────
//
// Protects against OAuth races, double taps, and late callbacks after logout.
// Each performSocialAuth call receives a unique generation number. After every
// async boundary (provider sign-in, session exchange, transition), the
// generation is checked — if it no longer matches the current attempt, the
// result is silently discarded.
//
// invalidateAllSocialAuthAttempts() is called by useLogout to immediately
// invalidate any in-flight attempt.
//
// Unified session mutation queue:
//   Both the social exchange (signInWithIdToken → _saveSession) and the
//   logout (signOut → _removeSession) are enqueued in the SAME promise chain.
//   This guarantees they cannot interleave — the Supabase SDK does not
//   serialize these internally.
//
//   Order when logout fires during an in-flight exchange:
//     1. logout calls invalidateAllSocialAuthAttempts() (immediate, sync)
//     2. logout enqueues its signOut in the mutation queue
//     3. the in-flight exchange is already in the queue and finishes first
//     4. if the exchange installed a session after invalidation, the
//        coordinator's stale-attempt cleanup (signOut scope:local) runs
//        INSIDE the exchange's queue slot (before the next item)
//     5. logout's signOut runs next, removing any remaining session
//     6. a new social auth attempt can only enqueue after logout's signOut
//     7. no old callback can subsequently remove the new session
//
//   A rejected mutation does not block subsequent mutations — the chain
//   catches errors and continues.

let _currentGeneration = 0;

// The unified queue — both exchanges and logout signOut are serialized here.
let _sessionMutationChain: Promise<unknown> = Promise.resolve();

export function invalidateAllSocialAuthAttempts(): void {
  _currentGeneration++;
}

function startNewAttempt(): number {
  return ++_currentGeneration;
}

function isAttemptCurrent(gen: number): boolean {
  return gen === _currentGeneration;
}

/**
 * Enqueues an async session mutation (social exchange or logout signOut)
 * in the unified chain.  Mutations execute sequentially — _saveSession
 * and _removeSession can never interleave.  A rejected mutation does not
 * block subsequent mutations.
 */
function enqueueSessionMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = _sessionMutationChain.then(fn, fn) as Promise<T>;
  // Catch errors on the chain itself so a rejection doesn't break
  // subsequent enqueued mutations.  The caller receives their own error
  // via the returned `next` promise.
  _sessionMutationChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Enqueues the logout signOut in the unified session mutation queue.
 * Called by useLogout AFTER invalidateAllSocialAuthAttempts().  The
 * signOut runs after any in-flight exchange completes, ensuring no
 * late _saveSession can reinstall a session after logout.
 *
 * The caller's signOut scope is preserved — useLogout passes its
 * own signOut function, so the global/local scope decision stays there.
 */
export async function enqueueLogoutSessionMutation(
  signOutFn: () => Promise<{ error: unknown } | void>,
): Promise<void> {
  await enqueueSessionMutation(async () => {
    await signOutFn();
  });
}

/**
 * Waits for all currently-queued session mutations to complete.
 * Used by tests to deterministically wait for in-flight exchanges
 * before asserting on session state.
 */
export async function waitForSessionMutationQueue(): Promise<void> {
  await _sessionMutationChain.catch(() => {});
}

// ─── Fail-closed sign-out for account_not_found ─────────────────────────────
//
// Shared by BOTH boundaries per the product decision:
//   1. src/lib/socialAuth.ts (this file) — the interactive direct-login path,
//      called synchronously inside performSocialAuth so login-methods.tsx
//      can render the "Compte introuvable" message inline, no navigation.
//   2. app/_layout.tsx — the cold-start / root-gate path, for a session that
//      already exists (persisted) but was never checked interactively (e.g.
//      the app was killed right after OAuth, before this function ran).
//
// Enqueued in the SAME unified session mutation queue as every other
// sign-in/sign-out — this prevents it from racing with a concurrent
// exchange or logout. Idempotent: if the session for `userId` is already
// gone by the time this runs (e.g. the other boundary already handled it),
// the signOut call is skipped and this is treated as success — required
// for the cold-start case where cleanup must be safely repeatable.
export async function signOutForAccountNotFound(
  userId: string,
  queryClient: QueryClient,
): Promise<{ ok: true } | { ok: false }> {
  const signOutOutcome = await enqueueSessionMutation(async (): Promise<{ ok: boolean }> => {
    if (useAuthStore.getState().session?.user?.id !== userId) {
      // Already signed out (or a different user is now signed in) —
      // idempotent no-op, treated as success.
      return { ok: true };
    }
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) return { ok: false };
    } catch {
      return { ok: false };
    }
    return { ok: true };
  });

  if (!signOutOutcome.ok) {
    return { ok: false };
  }

  // Targeted purge — only this user's cached queries and onboarding draft.
  // Never a global queryClient.clear() (that would affect a different
  // account that may already be mid sign-in on a shared device).
  purgeUserScopedCaches(queryClient, userId);
  await clearOnboardingDraftForOwner({ kind: 'authenticated', userId }).catch(() => {});

  // Belt-and-suspenders: confirm local state no longer considers this user
  // authenticated, even if the onAuthStateChange SIGNED_OUT event is still
  // in flight. Guarded so a concurrent, already-current session isn't
  // clobbered.
  if (useAuthStore.getState().session?.user?.id === userId) {
    useAuthStore.getState().setSession(null);
  }

  return { ok: true };
}

// ─── Normalized internal types ──────────────────────────────────────────────

export type SocialProvider = 'apple' | 'google';

export type SocialAuthCredential = {
  provider: SocialProvider;
  token: string;
  nonce?: string;
  email: string | null;
  fullName: string | null;
};

export type SocialAuthFailureReason = 'cancelled' | 'unavailable' | 'no_token' | 'config_error' | 'network' | 'unknown';

export type SocialAuthResult =
  | { ok: true; credential: SocialAuthCredential }
  | { ok: false; reason: SocialAuthFailureReason; message?: string };

export type SocialAuthSessionResult =
  | { ok: true; session: import('@supabase/supabase-js').Session; userId: string }
  | { ok: false; reason: SocialAuthFailureReason | 'auth_error'; message?: string };

export type SocialAuthFullResult =
  | { ok: true; userId: string; transitionResult?: OnboardingTransitionResult; skippedFinalization?: boolean }
  | { ok: false; reason: SocialAuthFailureReason | 'auth_error' | 'state_check_failed' | 'stale_attempt' | 'account_not_found' | 'signout_failed'; message?: string; transitionError?: OnboardingTransitionResult };

// ─── Nonce generation ───────────────────────────────────────────────────────
//
// Apple nonce contract (verified from official sources):
//   1. Generate a cryptographically secure raw nonce (32 chars).
//   2. Compute SHA-256(rawNonce) as hex lowercase.
//   3. Pass the HASH to signInAsync({ nonce: hashedNonce }) — Apple embeds it
//      in the ID token's `nonce` claim.
//   4. Pass the RAW nonce to supabase.auth.signInWithIdToken({ nonce: rawNonce })
//      — Supabase computes SHA-256(rawNonce) and compares to the JWT claim.
//
// Sources:
//   - Apple/Google Cloud: "request.nonce = sha256(nonce)" (hex)
//   - Supabase Swift example: request.nonce = sha256(nonce), signInWithIdToken(nonce: rawNonce)
//   - better-auth PR #8870: "client must SHA-256 hash the nonce before ASAuthorizationAppleIDRequest"
//   - expo-apple-authentication Swift: request.nonce = options.nonce (no hashing by Expo)

function generateRawNonce(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  Crypto.getRandomValues(bytes);
  let nonce = '';
  for (let i = 0; i < length; i++) {
    nonce += chars[bytes[i] % chars.length];
  }
  return nonce;
}

async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

// ─── Apple adapter ──────────────────────────────────────────────────────────

export async function signInWithApple(): Promise<SocialAuthResult> {
  try {
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return { ok: false, reason: 'unavailable', message: "L'authentification Apple n'est pas disponible sur cet appareil." };
    }

    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { ok: false, reason: 'no_token', message: "Apple n'a pas retourné de jeton d'identité." };
    }

    let fullName: string | null = null;
    if (credential.fullName) {
      const parts = [
        credential.fullName.givenName,
        credential.fullName.middleName,
        credential.fullName.familyName,
      ].filter(Boolean);
      fullName = parts.length > 0 ? parts.join(' ') : null;
    }

    return {
      ok: true,
      credential: {
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
        email: credential.email,
        fullName,
      },
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, reason: 'cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'unknown', message };
  }
}

// ─── Google adapter ─────────────────────────────────────────────────────────

let googleConfigured = false;

export function configureGoogleSignIn(webClientId: string, iosClientId?: string): void {
  const options: ConfigureParams = iosClientId
    ? { webClientId, iosClientId }
    : { webClientId };
  GoogleSignin.configure(options);
  googleConfigured = true;
}

export async function signInWithGoogle(): Promise<SocialAuthResult> {
  if (!googleConfigured) {
    return { ok: false, reason: 'config_error', message: 'Google Sign-In n\'est pas configuré. Appelez configureGoogleSignIn() au démarrage.' };
  }

  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    }

    const response: SignInResponse = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) {
      return { ok: false, reason: 'cancelled' };
    }

    if (!isSuccessResponse(response)) {
      return { ok: false, reason: 'unknown', message: 'Réponse Google inattendue.' };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      return { ok: false, reason: 'no_token', message: "Google n'a pas retourné de jeton d'identité. Vérifiez le webClientId." };
    }

    const userInfo = response.data.user;
    let fullName: string | null = null;
    if (userInfo.name) {
      fullName = userInfo.name;
    } else if (userInfo.givenName || userInfo.familyName) {
      fullName = [userInfo.givenName, userInfo.familyName].filter(Boolean).join(' ') || null;
    }

    return {
      ok: true,
      credential: {
        provider: 'google',
        token: idToken,
        email: userInfo.email,
        fullName,
      },
    };
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        return { ok: false, reason: 'cancelled' };
      }
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, reason: 'unavailable', message: 'Google Play Services n\'est pas disponible.' };
      }
      if (err.code === statusCodes.IN_PROGRESS) {
        return { ok: false, reason: 'unknown', message: 'Une opération de connexion est déjà en cours.' };
      }
      return { ok: false, reason: 'unknown', message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'unknown', message };
  }
}

// ─── Session exchange ───────────────────────────────────────────────────────

export async function exchangeSocialCredential(
  credential: SocialAuthCredential,
  onExchangeComplete?: () => Promise<void>,
): Promise<SocialAuthSessionResult> {
  return enqueueSessionMutation(async () => {
    try {
      // Apple: nonce is required (raw nonce, Supabase hashes server-side).
      // Google: nonce must NOT be included — GoogleSignin.signIn() does not
      // produce a nonce in the ID token, and Supabase rejects mismatched
      // nonce presence with "Passed nonce and nonce in id_token should either
      // both exist or not."
      const signInParams: {
        provider: 'apple' | 'google';
        token: string;
        nonce?: string;
      } = {
        provider: credential.provider,
        token: credential.token,
      };

      if (credential.provider === 'apple' && credential.nonce) {
        signInParams.nonce = credential.nonce;
      }

      const { data, error } = await supabase.auth.signInWithIdToken(signInParams);

      if (error) {
        return { ok: false, reason: 'auth_error', message: 'La connexion a échoué. Vérifie ta connexion réseau et réessaie.' };
      }

      if (!data.session) {
        return { ok: false, reason: 'auth_error', message: 'Aucune session retournée par Supabase.' };
      }

      // If the caller provided a stale-check callback, run it INSIDE
      // this queue slot — before the slot ends and the next queued
      // mutation (logout or a new exchange) starts.  This ensures
      // that any zombie session cleanup (signOut scope:local) runs
      // before logout's signOut, with no possibility of interleaving.
      if (onExchangeComplete) {
        await onExchangeComplete();
      }

      return {
        ok: true,
        session: data.session,
        userId: data.session.user.id,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Network') || message.includes('network') || message.includes('fetch')) {
        return { ok: false, reason: 'network', message };
      }
      return { ok: false, reason: 'unknown', message };
    }
  });
}

// ─── Full coordinator ───────────────────────────────────────────────────────
//
// Reuses the existing onboarding transition pipeline (beginOnboardingTransition
// + runOnboardingTransition) when flowId is present. For non-onboarding flows,
// Stack.Protected handles navigation automatically after session creation.

export async function performSocialAuth(
  provider: SocialProvider,
  queryClient: QueryClient,
  options?: {
    flowId?: string;
    visual?: SignupVisualSnapshot;
  },
): Promise<SocialAuthFullResult> {
  const gen = startNewAttempt();

  const credResult = provider === 'apple'
    ? await signInWithApple()
    : await signInWithGoogle();

  if (!isAttemptCurrent(gen)) {
    return { ok: false, reason: 'stale_attempt' };
  }

  if (!credResult.ok) {
    return { ok: false, reason: credResult.reason, message: credResult.message };
  }

  const { flowId, visual } = options ?? {};

  // ── Direct login invalidation ──────────────────────────────────────
  // When authentication starts WITHOUT onboarding context (no flowId),
  // invalidate any stale onboarding authorization from a previous session.
  // This prevents an abandoned pre-auth marker from authorizing a guest
  // draft claim for this unrelated authentication.
  if (!flowId) {
    try {
      await invalidateStaleOnboardingAuthorization();
    } catch {
      return { ok: false, reason: 'unknown', message: 'Impossible de réinitialiser l\'état d\'authentification. Redémarre l\'application.' };
    }
  }

  let leaseId: string | null = null;

  if (flowId) {
    try {
      leaseId = beginOnboardingTransition(flowId, visual ?? undefined);
    } catch {
      return { ok: false, reason: 'unknown', message: 'Une transition est déjà en cours.' };
    }
  }

  // The stale-check callback runs INSIDE the exchange's queue slot,
  // after signInWithIdToken + _saveSession complete but BEFORE the
  // slot ends.  This ensures zombie cleanup (signOut scope:local) runs
  // before any subsequently-queued logout signOut or new exchange.
  const onExchangeComplete = async () => {
    if (!isAttemptCurrent(gen)) {
      // Stale attempt: _saveSession already installed a session.
      // Clean it up NOW, inside this queue slot, before the next
      // queued mutation (logout signOut or B's exchange) starts.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch { /* best-effort zombie cleanup */ }
    }
  };

  const sessionResult = await exchangeSocialCredential(credResult.credential, onExchangeComplete);

  if (!isAttemptCurrent(gen)) {
    // Stale attempt — cleanup already ran inside the exchange's queue slot.
    if (leaseId) {
      releaseTransitionLease(leaseId);
    }
    return { ok: false, reason: 'stale_attempt' };
  }

  if (!sessionResult.ok) {
    if (leaseId) {
      releaseTransitionLease(leaseId);
      leaseId = null;
    }
    return { ok: false, reason: sessionResult.reason, message: sessionResult.message };
  }

  const userId = sessionResult.userId;

  // ── Post-auth business state check ──────────────────────────────────
  // Before running any onboarding finalization, check if the user already
  // has a durable plan AND progress. This is the safety guard: an
  // existing user who signs in via social auth from signup-methods with a
  // flowId must NEVER have their program overwritten.
  //
  // The check uses the canonical Supabase userId — never email, name,
  // created_at, or SDK-supplied metadata.
  //
  // If the state check itself fails (network, Supabase down), we fail
  // closed: no finalization, no overwrite, retry allowed.
  if (flowId) {
    let existingPlan: Awaited<ReturnType<typeof fetchPlan>>;
    let existingProgress: Awaited<ReturnType<typeof fetchProgress>>;

    try {
      existingPlan = await fetchPlan(userId);
    } catch {
      if (leaseId) releaseTransitionLease(leaseId);
      return { ok: false, reason: 'state_check_failed', message: 'Impossible de vérifier l\'existence d\'un programme. Réessaie.' };
    }

    if (!isAttemptCurrent(gen)) {
      if (leaseId) releaseTransitionLease(leaseId);
      // No signOut({scope:'local'}) here — the session was already
      // installed inside the exchange's queue slot, and logout's signOut
      // (already queued) will remove it.  Enqueueing a separate cleanup
      // here could interleave with B's exchange and incorrectly remove
      // B's session.
      return { ok: false, reason: 'stale_attempt' };
    }

    try {
      existingProgress = await fetchProgress(userId);
    } catch {
      if (leaseId) releaseTransitionLease(leaseId);
      return { ok: false, reason: 'state_check_failed', message: 'Impossible de vérifier ta progression. Réessaie.' };
    }

    if (!isAttemptCurrent(gen)) {
      if (leaseId) releaseTransitionLease(leaseId);
      // Same as above — no separate cleanup.  Logout's signOut handles it.
      return { ok: false, reason: 'stale_attempt' };
    }

    // ── Case 1: User already has a durable plan + progress ───────────
    if (existingPlan && existingProgress) {
      if (leaseId) {
        releaseTransitionLease(leaseId);
        leaseId = null;
      }
      await clearPendingOnboardingIfMatches(userId, flowId).catch(() => {});
      clearSessionAuthFlowId();
      return { ok: true, userId, skippedFinalization: true };
    }

    // ── Case 2: Partial/inconsistent state — fail closed ──────────────
    if (existingPlan || existingProgress) {
      if (leaseId) {
        releaseTransitionLease(leaseId);
        leaseId = null;
      }
      return {
        ok: false,
        reason: 'state_check_failed',
        message: 'Ton compte a un état incomplet. Contacte le support avant de continuer.',
      };
    }

    // ── Case 3: No plan, no progress — proceed with finalization ─────
  }

  if (leaseId && flowId) {
    const sessionGen = sessionResult.session.access_token?.slice(-16) ?? `${Date.now()}-${userId.slice(-8)}`;
    setTransitionUserId(userId);

    const transitionResult = await runOnboardingTransition(
      queryClient,
      userId,
      leaseId,
      sessionGen,
      visual ?? {
        surfaceType: 'signup',
        email: credResult.credential.email ?? '',
        password: '',
        confirm: '',
        showPw: false,
        showConfirm: false,
      },
    );
    leaseId = null;

    if (!isAttemptCurrent(gen)) {
      return { ok: false, reason: 'stale_attempt' };
    }

    if (transitionResult.status === 'error') {
      return { ok: false, reason: 'unknown', transitionError: transitionResult };
    }

    return { ok: true, userId, transitionResult };
  }

  return { ok: true, userId: sessionResult.userId };
}

// ─── Google Sign-Out (for logout cleanup) ───────────────────────────────────

export async function signOutGoogle(): Promise<void> {
  try {
    if (googleConfigured) {
      await GoogleSignin.signOut();
    }
  } catch {
    // Best-effort — must never affect logout flow
  }
}
