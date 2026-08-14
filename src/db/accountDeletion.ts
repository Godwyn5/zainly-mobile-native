import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from '@supabase/supabase-js';
import { supabase } from './client';

export type AccountDeletionRequestStatus = 'pending' | 'processing' | 'completed' | 'canceled';

export interface AccountDeletionRequestParams {
  userId: string;
  email?: string | null;
  reason?: string | null;
}

export type RequestAccountDeletionResult =
  | { error?: undefined }
  | { error: 'already_requested' | 'unknown' };

// Postgres unique_violation error code.
const UNIQUE_VIOLATION_CODE = '23505';

export async function requestAccountDeletion(
  params: AccountDeletionRequestParams
): Promise<RequestAccountDeletionResult> {
  const { userId, email = null, reason = null } = params;

  const { error } = await supabase.from('account_deletion_requests').insert({
    user_id: userId,
    email,
    reason,
    status: 'pending',
  });

  if (!error) {
    return {};
  }

  if (error.code === UNIQUE_VIOLATION_CODE) {
    return { error: 'already_requested' };
  }

  return { error: 'unknown' };
}

// ─── deleteAccountSelfService (V2 — real deletion) ────────────────────────────
// Calls the 'delete-account' Supabase Edge Function. The current session's
// JWT is attached automatically by supabase.functions.invoke — never pass a
// userId from the client; the function derives it server-side from the JWT.

export type DeleteAccountErrorCode =
  | 'unauthorized'
  | 'network'
  | 'invalid_body'
  | 'identity_invalid'
  | 'unknown_provider'
  | 'apple_code_missing'
  | 'apple_exchange_failed'
  | 'apple_identity_mismatch'
  | 'apple_validation_failed'
  | 'apple_revoke_failed'
  | 'internal_error'
  | 'unknown';

export interface DeleteAccountResult {
  ok: boolean;
  error?: DeleteAccountErrorCode;
  message?: string;
}

type DeleteAccountFunctionResponse =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteAccountSelfService(
  appleAuthorizationCode?: string,
): Promise<DeleteAccountResult> {
  try {
    const body: Record<string, unknown> = {};
    if (appleAuthorizationCode) {
      body.appleAuthorizationCode = appleAuthorizationCode;
    }

    const { data, error } = await supabase.functions.invoke<DeleteAccountFunctionResponse>(
      'delete-account',
      { method: 'POST', body }
    );

    if (error) {
      if (error instanceof FunctionsHttpError) {
        let status: number | undefined;
        let errorBody: { error?: string } | undefined;
        try {
          status = error.context?.status;
          errorBody = await error.context?.json();
        } catch {
          // Response body wasn't JSON — fall back to generic error.
        }
        if (status === 401) {
          return { ok: false, error: 'unauthorized' };
        }
        // Allowlist of server error codes — unknown values become 'unknown'
        const serverCode = errorBody?.error;
        const allowedCodes = new Set<DeleteAccountErrorCode>([
          'invalid_body',
          'identity_invalid',
          'unknown_provider',
          'apple_code_missing',
          'apple_exchange_failed',
          'apple_identity_mismatch',
          'apple_validation_failed',
          'apple_revoke_failed',
          'internal_error',
        ]);
        if (serverCode && allowedCodes.has(serverCode as DeleteAccountErrorCode)) {
          return { ok: false, error: serverCode as DeleteAccountErrorCode };
        }
        return { ok: false, error: 'unknown' };
      }
      if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
        return { ok: false, error: 'network' };
      }
      return { ok: false, error: 'unknown' };
    }

    if (!data || data.ok !== true) {
      const failed = data as { ok: false; error: string } | null;
      const serverCode = failed?.error;
      const allowedCodes = new Set<DeleteAccountErrorCode>([
        'invalid_body',
        'identity_invalid',
        'unknown_provider',
        'apple_code_missing',
        'apple_exchange_failed',
        'apple_identity_mismatch',
        'apple_validation_failed',
        'apple_revoke_failed',
        'internal_error',
      ]);
      if (serverCode && allowedCodes.has(serverCode as DeleteAccountErrorCode)) {
        return { ok: false, error: serverCode as DeleteAccountErrorCode };
      }
      return { ok: false, error: 'unknown' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}
