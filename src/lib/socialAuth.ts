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
import { forceReleaseTransitionLease, type SignupVisualSnapshot } from '@/lib/transitionLease';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import {
  clearPendingOnboardingIfMatches,
  clearSessionAuthFlowId,
} from '@/lib/pendingOnboardingPlan';

// ─── Attempt generation guard ───────────────────────────────────────────────
//
// Protects against OAuth races, double taps, and late callbacks after logout.
// Each performSocialAuth call receives a unique generation number. After every
// async boundary (provider sign-in, session exchange, transition), the
// generation is checked — if it no longer matches the current attempt, the
// result is silently discarded.
//
// invalidateAllSocialAuthAttempts() is called by useLogout to immediately
// invalidate any in-flight attempt. A provider callback arriving after logout
// finds a stale generation and refuses to exchange the token.
//
// This guard is NOT based on a React boolean or the onboarding lease — it is a
// module-level integer that survives component unmounts and navigation.

let _currentGeneration = 0;

export function invalidateAllSocialAuthAttempts(): void {
  _currentGeneration++;
}

function startNewAttempt(): number {
  return ++_currentGeneration;
}

function isAttemptCurrent(gen: number): boolean {
  return gen === _currentGeneration;
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
    if (leaseId) {
      forceReleaseTransitionLease();
    }
    return { ok: false, reason: 'stale_attempt' };
  }

  if (!sessionResult.ok) {
    if (leaseId) {
      forceReleaseTransitionLease();
      leaseId = null;
    }
    return { ok: false, reason: sessionResult.reason, message: sessionResult.message };
  }

  const userId = sessionResult.userId;

  // ── Post-auth business state check ──────────────────────────────────
  // Before running any onboarding finalization, check if the user already
  // has a durable plan AND progress. This is the P0 safety guard: an
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
      if (leaseId) forceReleaseTransitionLease();
      return { ok: false, reason: 'state_check_failed', message: 'Impossible de vérifier l\'existence d\'un programme. Réessaie.' };
    }

    if (!isAttemptCurrent(gen)) {
      if (leaseId) forceReleaseTransitionLease();
      return { ok: false, reason: 'stale_attempt' };
    }

    try {
      existingProgress = await fetchProgress(userId);
    } catch {
      if (leaseId) forceReleaseTransitionLease();
      return { ok: false, reason: 'state_check_failed', message: 'Impossible de vérifier ta progression. Réessaie.' };
    }

    if (!isAttemptCurrent(gen)) {
      if (leaseId) forceReleaseTransitionLease();
      return { ok: false, reason: 'stale_attempt' };
    }

    // ── Case 1: User already has a durable plan + progress ───────────
    // Existing user — never finalize, never overwrite. Invalidate the
    // stale pending payload for this exact attempt (flowId + owner),
    // release the lease, and proceed to canonical authenticated launch.
    if (existingPlan && existingProgress) {
      if (leaseId) {
        forceReleaseTransitionLease();
        leaseId = null;
      }
      // Clear the stale pending payload — it belongs to this flowId and
      // this userId. If it doesn't match (different owner or flowId),
      // clearPendingOnboardingIfMatches returns 'superseded' and leaves
      // it untouched.
      await clearPendingOnboardingIfMatches(userId, flowId).catch(() => {});
      clearSessionAuthFlowId();
      return { ok: true, userId, skippedFinalization: true };
    }

    // ── Case 2: Partial/inconsistent state — fail closed ──────────────
    // A plan with no progress, or progress with no plan, is an
    // inconsistent state. Never repair silently during social auth —
    // fail closed and let the user retry. The existing runFinalize
    // repair logic handles this for email flows where the user is known
    // to be new.
    if (existingPlan || existingProgress) {
      if (leaseId) {
        forceReleaseTransitionLease();
        leaseId = null;
      }
      return {
        ok: false,
        reason: 'state_check_failed',
        message: 'Ton compte a un état incomplet. Contacte le support avant de continuer.',
      };
    }

    // ── Case 3: No plan, no progress — proceed with finalization ─────
    // The user is new (or has no program). Run the canonical onboarding
    // transition pipeline.
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
