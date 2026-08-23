import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  getOrCreateGuestFlowId,
  type OnboardingDraftOwner,
} from '@/lib/onboardingDraft';

export interface DraftOwnerResult {
  /** The current draft owner, or null while the guest flowId is being resolved. */
  owner: OnboardingDraftOwner | null;
  /**
   * The guest flowId that was active before authentication, preserved
   * across the auth boundary so that program-summary.tsx can pass it to
   * saveGuestDraftHandoff before navigating to auth. Null if the user
   * was never a guest in this runtime.
   *
   * IMPORTANT: This value DESCRIBES the guest flowId — it does NOT
   * authorize a draft claim. The claim decision is made by
   * claimGuestDraftWithHandoff, which validates a GuestDraftHandoff
   * envelope that explicitly binds the transactionFlowId to the
   * sourceGuestDraftFlowId. A persisted guest flowId alone is not
   * proof of an active onboarding transaction.
   */
  sourceGuestFlowId: string | null;
}

/**
 * Computes the onboarding draft owner based on the current auth state.
 *
 * - Authenticated users: { kind: 'authenticated', userId }
 * - Guests: { kind: 'guest', flowId } with a real flowId from
 *   getOrCreateGuestFlowId — never empty.
 *
 * Returns { owner: null, sourceGuestFlowId: null } while the guest flowId
 * is being resolved (guest path only). Authenticated users get a non-null
 * owner immediately.
 *
 * CRITICAL: The guest flowId is resolved BEFORE authentication and kept in
 * state. When the user authenticates (null → userId), the hook returns
 * { kind: 'authenticated', userId } as the owner, but sourceGuestFlowId
 * still holds the original guest flowId. program-summary.tsx uses this
 * value to write the GuestDraftHandoff envelope (binding the transaction
 * to the exact guest draft) before navigating to auth.
 *
 * This hook DESCRIBES ownership — it does NOT authorize handoffs. The
 * claim decision is made by claimGuestDraftWithHandoff, which validates
 * the handoff envelope. A stale sourceGuestFlowId alone can never
 * authorize a claim.
 *
 * All onboarding-v2 screens should use this hook to get their draft owner
 * and pass it to the owner-aware draft APIs.
 */
export function useDraftOwner(): DraftOwnerResult {
  const userId = useAuthStore(s => s.session?.user?.id);
  const [guestFlowId, setGuestFlowId] = useState<string | null>(null);

  useEffect(() => {
    // Always resolve the guest flowId, even if already authenticated.
    // This ensures that if the user was a guest before authenticating
    // (same runtime), the sourceGuestFlowId is preserved in state.
    // If the user is already authenticated at mount (e.g. direct social
    // login), the resolved flowId is irrelevant — it won't be used for
    // a claim because there's no active onboarding transaction.
    let cancelled = false;
    getOrCreateGuestFlowId().then(fid => {
      if (!cancelled) setGuestFlowId(fid);
    });
    return () => { cancelled = true; };
  }, []);

  // Memoized on the underlying primitives (userId, guestFlowId) so the
  // returned owner keeps a STABLE reference across re-renders that don't
  // actually change identity. Without this, a new object literal would be
  // returned on every render, breaking referential equality for any
  // `useEffect(..., [draftOwner])` dependency — causing the resume/restore
  // effect to re-fire on every unrelated state update (e.g. selecting a
  // card) and potentially overwrite a fresh local edit with the last
  // persisted value before it's saved.
  const owner = useMemo<OnboardingDraftOwner | null>(() => {
    if (userId) return { kind: 'authenticated', userId };
    if (guestFlowId) return { kind: 'guest', flowId: guestFlowId };
    return null;
  }, [userId, guestFlowId]);

  return { owner, sourceGuestFlowId: guestFlowId };
}
