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
