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
} from '@/lib/pendingOnboardingPlan';

// ─── Attempt generation guard & session mutation serializer ────────────────
//
// Protects against OAuth races, double taps, and late callbacks after logout.
// Each performSocialAuth call receives a unique generation number. After every
// async boundary (provider sign-in, session exchange, transition), the
// generation is checked — if it no longer matches the current attempt, the
// result is silently discarded.
//
// invalidateAllSocialAuthAttempts() is called by useLogout to immediately
// invalidate any in-flight attempt AND acquire the session mutation lock so
// that any in-flight exchange completes before logout removes the session.
//
// Session mutation serializer:
//   signInWithIdToken (called by exchangeSocialCredential) does NOT acquire
//   the Supabase internal lock — it calls _saveSession + _notifyAllSubscribers
//   directly. signOut DOES acquire the lock. Without serialization, a late
//   _saveSession can install a session AFTER logout's _removeSession has
//   already run, leaving a zombie session in AsyncStorage.
//
//   The serializer ensures that if an exchange is in-flight when logout
//   starts, logout waits for the exchange to complete (including _saveSession),
//   THEN removes the session. If the exchange resolves after logout detected
//   a stale generation, the coordinator calls supabase.auth.signOut({ scope:
//   'local' }) to remove the zombie session without revoking tokens globally.
//
//   scope: 'local' is used for zombie cleanup because the logout's global
//   signOut may have already revoked the token server-side — a second global
//   call would fail with 401 (handled gracefully by the SDK). 'local' only
//   removes the session from storage and emits SIGNED_OUT, which is exactly
//   the cleanup needed for a zombie session.

let _currentGeneration = 0;

// Session mutation lock — serializes social exchange and logout.
// Resolves to 'exchanged' if the exchange completed, or 'cancelled' if
// logout was waiting and the exchange result was discarded.
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
 * Serializes an async operation (social exchange or logout) so that
 * _saveSession (inside signInWithIdToken) and _removeSession (inside signOut)
 * cannot interleave. The Supabase SDK does not serialize these internally.
 */
function serializeSessionMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = _sessionMutationChain.then(fn, fn) as Promise<T>;
  _sessionMutationChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Waits for any in-flight session mutation (social exchange) to complete
 * before proceeding. Called by useLogout before supabase.auth.signOut().
 */
export async function waitForSocialAuthSessionMutation(): Promise<void> {
  await _sessionMutationChain.catch(() => {});
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
  | { ok: false; reason: SocialAuthFailureReason | 'auth_error' | 'state_check_failed' | 'stale_attempt'; message?: string; transitionError?: OnboardingTransitionResult };

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
): Promise<SocialAuthSessionResult> {
  return serializeSessionMutation(async () => {
    try {
      const signInParams: {
        provider: 'apple' | 'google';
        token: string;
        nonce?: string;
      } = {
        provider: credential.provider,
        token: credential.token,
      };

      if (credential.nonce) {
        signInParams.nonce = credential.nonce;
      }

      const { data, error } = await supabase.auth.signInWithIdToken(signInParams);

      if (error) {
        return { ok: false, reason: 'auth_error', message: error.message };
      }

      if (!data.session) {
        return { ok: false, reason: 'auth_error', message: 'Aucune session retournée par Supabase.' };
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

  let leaseId: string | null = null;

  if (flowId) {
    try {
      leaseId = beginOnboardingTransition(flowId, visual ?? undefined);
    } catch {
      return { ok: false, reason: 'unknown', message: 'Une transition est déjà en cours.' };
    }
  }

  const sessionResult = await exchangeSocialCredential(credResult.credential);

  if (!isAttemptCurrent(gen)) {
    // Stale attempt detected after exchange. The SDK may have already
    // saved a session via _saveSession. Clean it up with scope: 'local'
    // so we don't revoke tokens globally (the logout's global signOut
    // may have already done that, or a new session may now be active).
    if (leaseId) {
      releaseTransitionLease(leaseId);
    }
    // Best-effort zombie session cleanup — the serializer ensures this
    // runs after the exchange's _saveSession completed.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch { /* best-effort */ }
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
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* best-effort */ }
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
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* best-effort */ }
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
