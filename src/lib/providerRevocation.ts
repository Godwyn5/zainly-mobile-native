// ─── Provider revocation for account deletion ──────────────────────────────
//
// Distinct from signOutGoogle() (logout). This module handles revocation
// of OAuth provider access ONLY during account deletion.
//
// Google: GoogleSignin.signIn() re-auth → stable ID comparison → revokeAccess().
// Apple: refreshAsync() with user + state → authorizationCode → Edge Function
//   performs server-side token exchange and revocation.
//
// Identities are determined from Supabase canonical user.identities, never
// from email or name. Unknown providers cause a closed failure.

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
import type { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '@/db/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LinkedProvider = 'google' | 'apple';

export type RevocationErrorCode =
  | 'provider_reauth_cancelled'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'google_revoke_failed'
  | 'google_reauth_failed'
  | 'apple_code_missing'
  | 'apple_state_mismatch'
  | 'apple_user_mismatch'
  | 'apple_reauth_failed'
  | 'unknown_provider'
  | 'identity_invalid'
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

export type IdentityDetectionResult =
  | { ok: true; identities: DetectedIdentity[] }
  | { ok: false; reason: RevocationErrorCode; message?: string };

const ALLOWED_PROVIDERS = new Set(['email', 'google', 'apple']);
const SOCIAL_PROVIDERS = new Set(['google', 'apple']);

/**
 * Runtime validation of a single UserIdentity-like object.
 * Accesses only typed fields required by the revocation workflow.
 * Does not propagate the upstream `any` from identity_data.
 */
function isValidIdentityEntry(
  entry: unknown,
): entry is { provider: string; identity_id: string } {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  return (
    typeof obj.provider === 'string' && obj.provider.length > 0 &&
    typeof obj.identity_id === 'string' && obj.identity_id.length > 0
  );
}

/**
 * Detects linked social providers from Supabase canonical user.identities.
 *
 * Returns:
 * - { ok: true, identities: [] } for email-only accounts
 * - { ok: true, identities: [...] } for accounts with Google/Apple
 * - { ok: false, reason: 'unknown_provider' } if any provider is not email/google/apple
 * - { ok: false, reason: 'identity_invalid' } if identities is missing/null/empty/malformed
 *   or if a Google/Apple identity has an empty identity_id
 *
 * Never compares emails. Never uses client-supplied identifiers as canonical.
 */
export function detectSocialIdentities(
  identities: UserIdentity[] | undefined | null,
): IdentityDetectionResult {
  if (!identities || !Array.isArray(identities) || identities.length === 0) {
    return {
      ok: false,
      reason: 'identity_invalid',
      message: 'Aucune identité trouvée pour ce compte.',
    };
  }

  const result: DetectedIdentity[] = [];

  for (const entry of identities) {
    if (!isValidIdentityEntry(entry)) {
      return {
        ok: false,
        reason: 'identity_invalid',
        message: 'Une identité est mal formée.',
      };
    }

    const provider = entry.provider;

    if (!ALLOWED_PROVIDERS.has(provider)) {
      return {
        ok: false,
        reason: 'unknown_provider',
        message: `Fournisseur non pris en charge: ${provider}.`,
      };
    }

    if (SOCIAL_PROVIDERS.has(provider)) {
      if (!entry.identity_id || entry.identity_id.length === 0) {
        return {
          ok: false,
          reason: 'identity_invalid',
          message: `Identifiant de fournisseur manquant pour ${provider}.`,
        };
      }
      result.push({
        provider: provider as LinkedProvider,
        identityId: entry.identity_id,
      });
    }
    // email provider: no revocation needed, skip
  }

  return { ok: true, identities: result };
}

// ─── Google revocation ──────────────────────────────────────────────────────

export type GoogleRevocationResult =
  | { ok: true }
  | { ok: false; reason: RevocationErrorCode; message?: string };

/**
 * Re-authenticates with Google to prove the user owns the Google identity
 * linked to this Supabase account, then revokes access.
 *
 * Phases and their errors:
 * - Authentication failure or cancellation → google_reauth_failed or provider_reauth_cancelled
 * - Wrong stable ID → provider_mismatch
 * - revokeAccess() failure → google_revoke_failed
 *
 * Retry contract:
 * 1. A first revocation may succeed.
 * 2. The Edge Function may then fail.
 * 3. A retry requests a new Google authentication.
 * 4. A new authorization can then be revoked before retrying deletion.
 */
export async function revokeGoogleAccess(
  expectedGoogleIdentityId: string,
): Promise<GoogleRevocationResult> {
  // Phase 1: Re-authentication
  let response: SignInResponse;
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    }

    response = await GoogleSignin.signIn();
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        return { ok: false, reason: 'provider_reauth_cancelled' };
      }
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, reason: 'provider_unavailable', message: 'Google Play Services n\'est pas disponible.' };
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'google_reauth_failed', message };
  }

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

  // Phase 2: Identity verification — compare stable Google user ID to Supabase identity_id.
  // NEVER compare emails.
  if (googleUserId !== expectedGoogleIdentityId) {
    return { ok: false, reason: 'provider_mismatch', message: 'Le compte Google sélectionné ne correspond pas au compte lié.' };
  }

  // Phase 3: Revocation
  try {
    await GoogleSignin.revokeAccess();
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      return { ok: false, reason: 'google_revoke_failed', message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Network') || message.includes('network')) {
      return { ok: false, reason: 'network', message };
    }
    return { ok: false, reason: 'google_revoke_failed', message };
  }

  return { ok: true };
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
 * Uses refreshAsync (not signInAsync) because:
 * - The stable Apple user identifier is available from Supabase identity_id.
 * - refreshAsync presents a native confirmation using the known user.
 * - It returns a fresh AppleAuthenticationCredential with authorizationCode.
 *
 * Controls:
 * - state: cryptographically random, exact equality on return.
 * - credential.user: exact equality with Supabase Apple identity_id.
 * - authorizationCode: non-empty string.
 * - Code kept in memory only — never persisted to AsyncStorage, SecureStore,
 *   React Query, Zustand, or logs.
 * - Cancellation produces no mutation.
 *
 * NOT marked as functional before testing on a physical iPhone.
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

    const credential = await AppleAuthentication.refreshAsync({
      user: expectedAppleUserId,
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

    if (!credential.authorizationCode || credential.authorizationCode.length === 0) {
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
 * Ordered saga (not atomic, recoverable by retry):
 * 1. Fetch fresh Supabase user
 * 2. Detect social identities (fail-closed)
 * 3. If Apple linked → obtain Apple authorizationCode via refreshAsync
 * 4. If Google linked → re-authenticate + revokeAccess
 * 5. Return proof (appleAuthorizationCode) for the Edge Function
 *
 * If any step fails, returns an error — no deletion should proceed.
 * If Google revocation succeeds but the Edge Function later fails, a retry
 * requests a new Google authentication and revokes the new authorization
 * before retrying deletion.
 */
export async function prepareRevocationProofs(): Promise<RevocationPreparationResult> {
  try {
    // 1. Fetch fresh Supabase user
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return { ok: false, reason: 'unknown', message: 'Impossible de vérifier ta session.' };
    }

    // 2. Detect social identities from canonical user.identities (fail-closed)
    const detection = detectSocialIdentities(
      user.identities as UserIdentity[] | undefined,
    );

    if (!detection.ok) {
      return { ok: false, reason: detection.reason, message: detection.message };
    }

    if (detection.identities.length === 0) {
      // Email-only account — no revocation needed
      return { ok: true, proof: {} };
    }

    const proof: RevocationProof = {};

    // 3. Apple first (reversible proof collection before irreversible revocation)
    const appleIdentity = detection.identities.find((i) => i.provider === 'apple');
    if (appleIdentity) {
      const appleResult = await obtainAppleRevocationProof(appleIdentity.identityId);
      if (!appleResult.ok) {
        return { ok: false, reason: appleResult.reason, message: appleResult.message };
      }
      proof.appleAuthorizationCode = appleResult.authorizationCode;
    }

    // 4. Google revocation (irreversible)
    const googleIdentity = detection.identities.find((i) => i.provider === 'google');
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
