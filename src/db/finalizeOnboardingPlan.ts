// ─── Atomic onboarding finalization via PostgreSQL RPC ──────────────────────
// Calls the `finalize_onboarding_plan` Postgres function (SECURITY DEFINER)
// which inserts plan + progress in a single transaction with a per-user
// advisory lock.  Identity is derived from auth.uid() server-side — the
// client never passes user_id.
//
// This replaces the old two-step client-side approach (upsertPlan +
// resetProgressForNewPlan) that was vulnerable to TOCTOU races, partial
// state on failure, and silent overwrites via ON CONFLICT DO UPDATE.
//
// The RPC must be deployed via the SQL migration before this code is
// active in production.  See:
//   supabase/migrations/20260811000000_finalize_onboarding_plan.sql

import { supabase } from './client';
import type { PlanPayload, ProgressPayload } from '@/core/planEngine';

export type FinalizePlanRpcResult =
  | { ok: true; reason: 'created' | 'already_finalized' }
  | { ok: false; reason: 'inconsistent_state' | 'not_authenticated' | 'rpc_error'; message?: string };

/**
 * Atomically creates plan + progress for a user via a single Postgres
 * transaction.  The user's identity is obtained from auth.uid() inside
 * the RPC — userId is NOT passed to the function.
 *
 * Returns:
 *   - { ok: true, reason: 'created' }           — both rows inserted
 *   - { ok: true, reason: 'already_finalized' } — both rows already exist
 *   - { ok: false, reason: 'inconsistent_state' } — exactly one row exists
 *   - { ok: false, reason: 'not_authenticated' } — no verified JWT
 *   - { ok: false, reason: 'rpc_error', message } — network / PostgREST error
 */
export async function finalizeOnboardingPlanRpc(
  planPayload: PlanPayload,
  progressPayload: ProgressPayload,
): Promise<FinalizePlanRpcResult> {
  const { data, error } = await supabase.rpc('finalize_onboarding_plan', {
    p_plan: planPayload,
    p_progress: progressPayload,
  });

  if (error) {
    return {
      ok: false,
      reason: 'rpc_error',
      message: error.message,
    };
  }

  // The RPC returns jsonb: { ok: boolean, reason: string }
  const result = data as { ok?: boolean; reason?: string };

  if (!result || typeof result.ok !== 'boolean') {
    return {
      ok: false,
      reason: 'rpc_error',
      message: 'Réponse inattendue du serveur.',
    };
  }

  if (result.ok) {
    return {
      ok: true,
      reason: result.reason as 'created' | 'already_finalized',
    };
  }

  return {
    ok: false,
    reason: (result.reason as 'inconsistent_state' | 'not_authenticated') ?? 'rpc_error',
  };
}
