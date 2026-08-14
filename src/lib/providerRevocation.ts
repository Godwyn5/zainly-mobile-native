// ─── Provider revocation for account deletion ──────────────────────────────
//
// Distinct from signOutGoogle() (logout). This module handles irreversible
// revocation of OAuth provider access ONLY during account deletion.
//
// Google: GoogleSignin.revokeAccess() after re-authentication + identity match.
// Apple: signInAsync with state + user verification to obtain a fresh
//   authorizationCode, transmitted to the Edge Function for server-side
//   revocation.
//
// Identities are determined from Supabase canonical user.identities, never
// from email or name.

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
} from '@react-native-google-signin/google-signin';
import { supabase } from '@/db/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LinkedProvider = 'google' | 'apple';

export type RevocationErrorCode =
  | 'provider_reauth_cancelled'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'google_revoke_failed'
  | 'apple_code_missing'
  | 'apple_state_mismatch'
  | 'apple_user_mismatch'
  | 'apple_reauth_failed'
  | 'google_reauth_failed'
  | 'unknown_provider'
  | 'network'
  | 'unknown';

export interface RevocationProof {
  appleAuthorizationCode?: string;
}

export type RevocationPreparationResult =
  | { ok: true; proof: RevocationProof }
  | { ok: false; reason: RevocationErrorCode; message?: string };

// ─── Identity detection ─────────────────────────────────────────────────────

export interface DetectedIdentity {
  provider: LinkedProvider;
  identityId: string;
}

/**
 * Detects linked social providers from Supabase canonical user.identities.
 * Returns an array of detected social identities (google, apple).
 * Email-only accounts return an empty array.
 * Unknown providers are ignored (not treated as social).
 */
export function detectSocialIdentities(
  identities: { provider: string; identity_id: string }[] | undefined | null,
): DetectedIdentity[] {
  if (!identities || !Array.isArray(identities)) return [];

  const result: DetectedIdentity[] = [];
  for (const id of identities) {
    if (id.provider === 'google' || id.provider === 'apple') {
      result.push({ provider: id.provider, identityId: id.identity_id });
    }
  }
  return result;
}

// ─── Google revocation ──────────────────────────────────────────────────────

/**
 * Re-authenticates with Google to prove the user owns the Google identity
 * linked to this Supabase account, then revokes access.
 *
 * Steps:
 * 1. signIn() — fresh Google credential
 * 2. Compare Google user.id to the Supabase identity's identity_id
 * 3. If match → revokeAccess()
 * 4. If mismatch → fail closed, no revocation, no deletion
 */
export async function revokeGoogleAccess(
  expectedGoogleIdentityId: string,
): Promise<{ ok: true } | { ok: false; reason: RevocationErrorCode; message?: string }> {
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    }

    const response: SignInResponse = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) {
      return { ok: false, reason: 'provider_reauth_cancelled' };
    }

    if (!isSuccessResponse(response)) {
      return { ok: false, reason: 'google_reauth_failed', message: 'Réponse Google inattendue.' };
    }

    const googleUserId = response.data.user.id;
    if (!googleUserId) {
      return { ok: false, reason: 'google_reauth_failed', message: 'Google n\'a pas retourné d\'identifiant utilisateur.' };
    }

    // Compare stable Google user ID to Supabase identity_id.
    // NEVER compare emails.
    if (googleUserId !== expectedGoogleIdentityId) {
      return { ok: false, reason: 'provider_mismatch', message: 'Le compte Google sélectionné ne correspond pas au compte lié.' };
    }

    await GoogleSignin.revokeAccess();

    return { ok: true };
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        return { ok: false, reason: 'provider_reauth_cancelled' };
      }
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, reason: 'provider_unavailable', message: 'Google Play Services n\'est pas disponible.' };
      }
      return { ok: false, reason: 'google_revoke_failed', message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    // If we got here, the error occurred after signIn succeeded (during revokeAccess)
    // or during signIn with a non-standard error. Either way, it's a Google failure.
    return { ok: false, reason: 'google_revoke_failed', message };
  }
}

// ─── Apple revocation proof ─────────────────────────────────────────────────

function generateStateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  Crypto.getRandomValues(bytes);
  let state = '';
  for (let i = 0; i < length; i++) {
    state += chars[bytes[i] % chars.length];
  }
  return state;
}

/**
 * Obtains a fresh Apple authorizationCode for server-side revocation.
 *
 * Uses signInAsync (not refreshAsync) because:
 * - refreshAsync requires the stable Apple `user` identifier, which Supabase
 *   stores in identity_data but may not always expose reliably.
 * - signInAsync is the canonical re-authentication flow recommended by Apple
 *   for account deletion, producing a fresh authorizationCode each time.
 * - The state token prevents CSRF; credential.user is verified against the
 *   expected Apple identity.
 *
 * The authorizationCode is returned in memory only — never persisted to
 * AsyncStorage, SecureStore, React Query, Zustand, or logs.
 */
export async function obtainAppleRevocationProof(
  expectedAppleUserId: string,
): Promise<
  | { ok: true; authorizationCode: string }
  | { ok: false; reason: RevocationErrorCode; message?: string }
> {
  try {
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return { ok: false, reason: 'provider_unavailable', message: 'L\'authentification Apple n\'est pas disponible sur cet appareil.' };
    }

    const state = generateStateToken();

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [],
      state,
    });

    // Verify state matches (CSRF protection)
    if (credential.state !== state) {
      return { ok: false, reason: 'apple_state_mismatch', message: 'La réponse Apple ne correspond pas à la requête.' };
    }

    // Verify Apple user matches the Supabase-linked Apple identity
    if (credential.user !== expectedAppleUserId) {
      return { ok: false, reason: 'apple_user_mismatch', message: 'Le compte Apple sélectionné ne correspond pas au compte lié.' };
    }

    if (!credential.authorizationCode) {
      return { ok: false, reason: 'apple_code_missing', message: 'Apple n\'a pas retourné de code d\'autorisation.' };
    }

    return { ok: true, authorizationCode: credential.authorizationCode };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, reason: 'provider_reauth_cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'apple_reauth_failed', message };
  }
}

// ─── Full orchestration ─────────────────────────────────────────────────────

/**
 * Orchestrates provider revocation proofs before account deletion.
 *
 * Order:
 * 1. Fetch fresh Supabase user
 * 2. Detect social identities
 * 3. If Apple linked → obtain Apple authorizationCode
 * 4. If Google linked → re-authenticate + revokeAccess
 * 5. Return proof (appleAuthorizationCode) for the Edge Function
 *
 * If any step fails, returns an error — no deletion should proceed.
 * If Google revocation succeeds but the Edge Function later fails, a retry
 * can re-authenticate Google again (revokeAccess is idempotent — revoking
 * an already-revoked token is a no-op).
 */
export async function prepareRevocationProofs(): Promise<RevocationPreparationResult> {
  try {
    // 1. Fetch fresh Supabase user
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return { ok: false, reason: 'unknown', message: 'Impossible de vérifier ta session.' };
    }

    // 2. Detect social identities from canonical user.identities
    const socialIdentities = detectSocialIdentities(
      user.identities as { provider: string; identity_id: string }[] | undefined,
    );

    if (socialIdentities.length === 0) {
      // Email-only account — no revocation needed
      return { ok: true, proof: {} };
    }

    const proof: RevocationProof = {};

    // 3. Apple first (reversible proof collection before irreversible revocation)
    const appleIdentity = socialIdentities.find((i) => i.provider === 'apple');
    if (appleIdentity) {
      const appleResult = await obtainAppleRevocationProof(appleIdentity.identityId);
      if (!appleResult.ok) {
        return { ok: false, reason: appleResult.reason, message: appleResult.message };
      }
      proof.appleAuthorizationCode = appleResult.authorizationCode;
    }

    // 4. Google revocation (irreversible)
    const googleIdentity = socialIdentities.find((i) => i.provider === 'google');
    if (googleIdentity) {
      const googleResult = await revokeGoogleAccess(googleIdentity.identityId);
      if (!googleResult.ok) {
        return { ok: false, reason: googleResult.reason, message: googleResult.message };
      }
    }

    return { ok: true, proof };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'unknown', message };
  }
}
