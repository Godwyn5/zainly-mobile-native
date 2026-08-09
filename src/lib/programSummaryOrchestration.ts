import type { QueryClient } from '@tanstack/react-query';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { clearPendingOnboardingIfMatches, readPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';

export type ProgramSummaryAuthedOutcome =
  | { status: 'navigate' }
  | { status: 'premium_sync_failed' }
  | { status: 'premium_entitlement_missing' }
  | { status: 'finalize_failed'; message?: string }
  | { status: 'session_changed' }
  | { status: 'handoff_failed' }
  | { status: 'no_draft' };

interface OrchestrationDeps {
  finalizeWithPremiumGate: typeof finalizeOnboardingV2PlanWithPremiumGate;
  handoff: typeof handOffFinalizedProgram;
  getSessionUserId: () => string | undefined;
  invalidateNonCritical: (queryClient: QueryClient, userId: string) => void;
  clearPending: typeof clearPendingOnboardingIfMatches;
}

const defaultDeps: OrchestrationDeps = {
  finalizeWithPremiumGate: finalizeOnboardingV2PlanWithPremiumGate,
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

  const outcome = await d.finalizeWithPremiumGate(authedUserId, '');
  if (outcome.status === 'premium_sync_failed') {
    return { status: 'premium_sync_failed' };
  }
  if (outcome.status === 'premium_entitlement_missing') {
    return { status: 'premium_entitlement_missing' };
  }
  if (!outcome.finalize.ok) {
    return { status: 'finalize_failed', message: outcome.finalize.message };
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
    await d.clearPending(authedUserId, transactionId);
  }

  d.invalidateNonCritical(queryClient, authedUserId);
  return { status: 'navigate' };
}
