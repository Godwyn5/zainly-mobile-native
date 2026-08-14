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
  | 'function_failed'
  | 'provider_reauth_cancelled'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'google_revoke_failed'
  | 'apple_code_missing'
  | 'apple_exchange_failed'
  | 'apple_identity_mismatch'
  | 'apple_revoke_failed'
  | 'unknown';

export interface DeleteAccountResult {
  ok: boolean;
  error?: DeleteAccountErrorCode;
  message?: string;
  step?: string;
}

type DeleteAccountFunctionResponse =
  | { ok: true }
  | { ok: false; error: string; step?: string };

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
      { method: 'POST', body: JSON.stringify(body) }
    );

    if (error) {
      if (error instanceof FunctionsHttpError) {
        let status: number | undefined;
        let body: { error?: string; step?: string } | undefined;
        try {
          status = error.context?.status;
          body = await error.context?.json();
        } catch {
          // Response body wasn't JSON — ignore, fall back to error.message below.
        }
        if (status === 401) {
          return { ok: false, error: 'unauthorized', message: body?.error ?? 'Session invalide.' };
        }
        return { ok: false, error: 'function_failed', message: body?.error ?? error.message, step: body?.step };
      }
      if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
        return { ok: false, error: 'network', message: error.message };
      }
      return { ok: false, error: 'unknown', message: error.message };
    }

    if (!data || data.ok !== true) {
      const failed = data as { ok: false; error: string; step?: string } | null;
      return { ok: false, error: 'function_failed', message: failed?.error, step: failed?.step };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'unknown', message: err instanceof Error ? err.message : String(err) };
  }
}
