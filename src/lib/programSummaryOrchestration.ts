import type { QueryClient } from '@tanstack/react-query';
import { finalizeOnboardingV2PlanWithPremiumGate } from '@/lib/onboardingFinalize';
import { handOffFinalizedProgram } from '@/lib/onboardingDashboardHandoff';
import { clearPendingOnboardingForUser } from '@/lib/pendingOnboardingPlan';

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
  clearPending: typeof clearPendingOnboardingForUser;
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
  clearPending: clearPendingOnboardingForUser,
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
  // A failure here is non-fatal: the plan+progress are durable in Supabase,
  // and the pending will be cleaned up on next read or logout. Never clears
  // another user's pending.
  await d.clearPending(authedUserId);

  d.invalidateNonCritical(queryClient, authedUserId);
  return { status: 'navigate' };
}
