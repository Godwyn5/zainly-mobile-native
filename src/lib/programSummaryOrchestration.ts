import type { QueryClient } from '@tanstack/react-query';
import { finalizeOnboardingV2Plan } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { clearPendingOnboardingIfMatches, readPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';
import { inspectDraftForOwner, clearOnboardingDraftForOwner, type OnboardingDraftOwner } from '@/lib/onboardingDraft';

export type ProgramSummaryAuthedOutcome =
  | { status: 'navigate' }
  | { status: 'navigate_clear_failed' }
  | { status: 'finalize_failed'; message?: string }
  | { status: 'session_changed' }
  | { status: 'handoff_failed' }
  | { status: 'superseded' }
  | { status: 'no_draft' }
  | { status: 'draft_owner_mismatch' };

interface OrchestrationDeps {
  finalize: typeof finalizeOnboardingV2Plan;
  handoff: typeof handOffFinalizedProgram;
  getSessionUserId: () => string | undefined;
  invalidateNonCritical: (queryClient: QueryClient, userId: string) => void;
  clearPending: typeof clearPendingOnboardingIfMatches;
}

const defaultDeps: OrchestrationDeps = {
  finalize: finalizeOnboardingV2Plan,
  handoff: handOffFinalizedProgram,
  getSessionUserId: () => undefined,
  invalidateNonCritical: (qc, uid) => {
    qc.invalidateQueries({ queryKey: ['dueReviews', uid] });
    qc.invalidateQueries({ queryKey: ['profile', uid] });
    qc.invalidateQueries({ queryKey: ['pendingOnboarding', uid] });
  },
  clearPending: clearPendingOnboardingIfMatches,
};

export async function orchestrateAuthedFinalize(
  queryClient: QueryClient,
  authedUserId: string,
  deps: Partial<OrchestrationDeps> = {},
): Promise<ProgramSummaryAuthedOutcome> {
  const d = { ...defaultDeps, ...deps };
  const getSessionUserId = d.getSessionUserId ?? (() => undefined);

  // ── Draft inspection guard ─────────────────────────────────────────
  // Inspect the draft stored under this authenticated user's physical key.
  // The discriminated result distinguishes:
  //   - absent: no data under the key → proceed (may use pending payload)
  //   - valid: well-formed envelope with matching owner → proceed
  //   - corrupt: data exists but is malformed → abort (never treat as absent)
  //   - owner_mismatch: envelope exists but belongs to a different owner
  //     → abort (never treat as absent, never expose the data)
  //
  // A corrupted or mismatched envelope under the user's key must NEVER be
  // silently treated as an ordinary absence. The finalization may proceed
  // without a draft only if the draft is genuinely absent (null key) — in
  // that case, finalization falls back to the pending payload path, which
  // has its own flowId/ownerUserId binding.
  const authedOwner: OnboardingDraftOwner = { kind: 'authenticated', userId: authedUserId };
  const inspection = await inspectDraftForOwner(authedOwner);
  if (inspection.status === 'corrupt') {
    return { status: 'draft_owner_mismatch' };
  }
  if (inspection.status === 'owner_mismatch') {
    return { status: 'draft_owner_mismatch' };
  }

  const outcome = await d.finalize(authedUserId, '');
  if (!outcome.ok) {
    return { status: 'finalize_failed', message: outcome.message };
  }

  if (getSessionUserId() !== authedUserId) {
    return { status: 'session_changed' };
  }

  const handoff = await d.handoff(queryClient, authedUserId);

  if (getSessionUserId() !== authedUserId) {
    return { status: 'session_changed' };
  }

  if (handoff.status === 'error') {
    // Pending payload is NOT cleared — it survives as the transaction marker
    // so a retry can detect the existing pair and re-attempt the handoff.
    return { status: 'handoff_failed' };
  }

  // Handoff succeeded — now safe to clear the pending payload for this user.
  // Read the pending's flowId to pass as the transaction identity — this
  // prevents clearing a NEWER pending from a different onboarding parcours.
  // A failure here is non-fatal: the plan+progress are durable in Supabase,
  // and the pending will be cleaned up on next read or logout. Never clears
  // another user's pending or an unclaimed pending.
  const pendingBeforeClear = await readPendingOnboardingPlan();
  const transactionId = pendingBeforeClear?.flowId ?? '';

  // Session check after the async read — the session may have changed
  // during the await. Never clear pending for a stale userId.
  if (getSessionUserId() !== authedUserId) {
    return { status: 'session_changed' };
  }

  if (transactionId) {
    const clearResult = await d.clearPending(authedUserId, transactionId);

    // Post-clear session check — the session may have changed during the
    // await. Never navigate or update visible state for a stale session.
    if (getSessionUserId() !== authedUserId) {
      return { status: 'session_changed' };
    }

    if (clearResult === 'storage_error') {
      // The pending matched but the storage delete failed. The pair is
      // durable in Supabase and canonical in the cache — navigation is
      // safe. The pending survives as a stale marker and will be cleaned
      // up on next read, logout, or a future retry.
      d.invalidateNonCritical(queryClient, authedUserId);
      await clearOnboardingDraftForOwner(authedOwner).catch(() => { /* non-fatal */ });
      return { status: 'navigate_clear_failed' };
    }

    if (clearResult === 'superseded') {
      // A newer transaction or a different user's pending is in storage.
      // This operation is obsolete — do NOT navigate or announce success.
      return { status: 'superseded' };
    }

    // 'cleared' or 'already_absent' — proceed to navigation.
    // already_absent is safe here because the session check above passed
    // and the finalize + handoff already succeeded for this user.
  }

  d.invalidateNonCritical(queryClient, authedUserId);
  // Clear the finalized user's draft — targeted, not global.
  await clearOnboardingDraftForOwner(authedOwner).catch(() => { /* non-fatal */ });
  return { status: 'navigate' };
}
