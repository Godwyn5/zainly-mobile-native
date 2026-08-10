// ─── Social auth — Apple & Google native sign-in via Supabase signInWithIdToken ─
//
// Architecture:
//   1. Provider adapters acquire native credentials (identityToken / idToken).
//   2. A normalized result type (SocialAuthResult) is produced — never nullable token.
//   3. The coordinator exchanges the token via supabase.auth.signInWithIdToken,
//      then reuses the existing onboarding transition pipeline when flowId is present.
//
// Nonce contract:
//   - Apple: a raw random nonce is generated, passed to signInAsync({ nonce }) AND
//     to signInWithIdToken({ nonce }). Supabase hashes it server-side (SHA-256) and
//     compares against the nonce_hash claim in Apple's JWT. The raw nonce is never
//     sent to Apple — Apple embeds the hash in the token.
//   - Google: the Original API does not support a nonce parameter. signInWithIdToken
//     is called without nonce for Google.

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
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
  | { ok: true; userId: string; transitionResult?: OnboardingTransitionResult }
  | { ok: false; reason: SocialAuthFailureReason | 'auth_error'; message?: string; transitionError?: OnboardingTransitionResult };

// ─── Nonce generation ───────────────────────────────────────────────────────

function generateNonce(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let nonce = '';
  const bytes = new Uint8Array(length);
  // Use crypto.getRandomValues if available (React Native hermes polyfill)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      nonce += chars[bytes[i] % chars.length];
    }
  } else {
    // Fallback — less critical since Apple also provides replay protection
    for (let i = 0; i < length; i++) {
      nonce += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return nonce;
}

// ─── Apple adapter ──────────────────────────────────────────────────────────

export async function signInWithApple(): Promise<SocialAuthResult> {
  try {
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return { ok: false, reason: 'unavailable', message: "L'authentification Apple n'est pas disponible sur cet appareil." };
    }

    const rawNonce = generateNonce();

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: rawNonce,
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
  const credResult = provider === 'apple'
    ? await signInWithApple()
    : await signInWithGoogle();

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

  if (!sessionResult.ok) {
    if (leaseId) {
      forceReleaseTransitionLease();
      leaseId = null;
    }
    return { ok: false, reason: sessionResult.reason, message: sessionResult.message };
  }

  if (leaseId && flowId) {
    const userId = sessionResult.userId;
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
