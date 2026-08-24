/// <reference types="jest" />
// ─── Trust-boundary audit: CompletedAuthProofV1 + GuestDraftHandoffV1 ───────
//
// These tests verify the REQUIRED INVARIANT:
//   A guest draft may be claimed only when all these conditions are true:
//     1. A CompletedAuthProofV1 exists with status='authenticated', proving
//        that a Supabase authentication result confirmed this exact user
//        for this exact onboarding transaction.
//     2. The proof's transactionFlowId matches the handoff envelope's
//        transactionFlowId.
//     3. The proof's userId matches the targetUserId.
//     4. The handoff's sourceGuestDraftFlowId matches the given guestFlowId.
//     5. The handoff is unconsumed (status = 'awaiting_auth') or idempotently
//        claimed by the same user.
//     6. The current session user matches targetUserId.
//
// The following are NOT sufficient authorization:
//   - ActiveOnboardingAuthFlowV1 (pre-auth marker, written before auth)
//   - GuestDraftHandoffV1 alone (the envelope cannot authenticate itself)
//   - GUEST_FLOW_KEY
//   - sourceGuestFlowId
//   - route parameters
//   - an unexpired 'awaiting_auth' status
//   - module memory (_sessionAuthFlowId)

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  savePendingOnboardingPlan,
  clearAllPendingOnboardingData,
  saveGuestDraftHandoff,
  readGuestDraftHandoff,
  clearGuestDraftHandoff,
  claimGuestDraftWithHandoff,
  saveCompletedAuthProof,
  readCompletedAuthProof,
  consumeCompletedAuthProof,
  clearCompletedAuthProof,
  invalidateStaleOnboardingAuthorization,
  setSessionAuthFlowId,
  clearSessionAuthFlowId,
  saveActiveOnboardingAuthFlow,
  clearActiveOnboardingAuthFlow,
} from '../pendingOnboardingPlan';
import {
  saveOnboardingDraftForOwner,
  readOnboardingDraftForOwner,
  purgeAllOnboardingDrafts,
  getOrCreateGuestFlowId,
  clearGuestFlowId,
  type OnboardingDraftOwner,
  type OnboardingDraftV1,
} from '../onboardingDraft';

// ── Mocks ───────────────────────────────────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  const mock = {
    getItem: jest.fn(async (key: string) => (key in store ? store[key] : null)),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => delete store[k]); }),
  };
  return { __esModule: true, default: mock };
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeDraft(name: string): OnboardingDraftV1 {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    currentStep: 'program_summary',
    firstName: name,
    learningMode: 'recommended',
    knownSurahs: [1, 2, 3],
    startingSurah: null,
    customSurahOrder: [],
    continueWithRest: true,
    notificationPreference: 'enabled',
    updatedAt: new Date().toISOString(),
  };
}

function makePlanInput(name: string) {
  return {
    firstName: name,
    learningMode: 'recommended' as const,
    knownSurahs: [1, 2, 3],
    startingSurah: null,
    customSurahOrder: [],
    continueWithRest: true,
    notificationPreference: 'enabled' as const,
  };
}

const userA = 'user-aaa-111';
const userB = 'user-bbb-222';
const ownerA: OnboardingDraftOwner = { kind: 'authenticated', userId: userA };
const ownerB: OnboardingDraftOwner = { kind: 'authenticated', userId: userB };

let guestFlowF: string;
let guestOwnerF: OnboardingDraftOwner;

beforeEach(async () => {
  await purgeAllOnboardingDrafts();
  await clearAllPendingOnboardingData();
  await clearGuestFlowId();
  await clearGuestDraftHandoff();
  clearSessionAuthFlowId();
  await clearActiveOnboardingAuthFlow();
  jest.clearAllMocks();

  // Set up two distinct guest flows
  guestFlowF = await getOrCreateGuestFlowId();
  guestOwnerF = { kind: 'guest', flowId: guestFlowF };
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ABANDONED TX-A + GUEST F + UNEXPIRED ACTIVE MARKER + APP KILL + LATER DIRECT GOOGLE LOGIN → NO CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

describe('1. Abandoned TX-A + guest F + direct Google login after app kill', () => {
  it('stale pre-auth marker + stale handoff + no completed proof → no claim; F remains isolated', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Alice'));

    // Pre-auth state from a previous onboarding session (abandoned)
    const txA = 'tx-abandoned-001';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveActiveOnboardingAuthFlow(txA);
    setSessionAuthFlowId(txA);

    // App kill simulation: clearAllPendingOnboardingData is NOT called
    // (process death). The pre-auth markers persist in AsyncStorage.

    // User reopens app and does a DIRECT Google login (no onboarding context).
    // performSocialAuth calls invalidateStaleOnboardingAuthorization():
    await invalidateStaleOnboardingAuthorization();

    // After invalidation, no completed proof exists (auth didn't go through
    // onboarding transition), so claim must fail.
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);

    // Guest draft remains isolated — not transferred to any user
    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft).toBeNull();

    // Guest draft still exists under guest key
    const guestDraft = await readOnboardingDraftForOwner(guestOwnerF);
    expect(guestDraft).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SAME SCENARIO WITH DIRECT APPLE LOGIN → NO CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

describe('2. Abandoned TX-A + guest F + direct Apple login after app kill', () => {
  it('stale pre-auth marker + stale handoff + invalidation → no claim; F isolated', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Bob'));

    const txA = 'tx-abandoned-002';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveActiveOnboardingAuthFlow(txA);

    // Direct Apple login → invalidateStaleOnboardingAuthorization
    await invalidateStaleOnboardingAuthorization();

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SAME SCENARIO WITH DIRECT EMAIL LOGIN/SIGNUP → NO CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

describe('3. Abandoned TX-A + guest F + direct email login/signup → no claim', () => {
  it('stale pre-auth marker + stale handoff + email invalidation → no claim', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Carol'));

    const txA = 'tx-abandoned-003';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveActiveOnboardingAuthFlow(txA);

    // Direct email login → invalidateStaleOnboardingAuthorization
    await invalidateStaleOnboardingAuthorization();

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. OLD PRE-AUTH TX-A MARKER + NEW DIRECT AUTH AS U → NO COMPLETED PROOF CREATED
// ═══════════════════════════════════════════════════════════════════════════════

describe('4. Old pre-auth marker + direct auth → no completed proof', () => {
  it('direct login invalidates stale markers and creates no completed proof', async () => {
    const txA = 'tx-old-004';
    await saveActiveOnboardingAuthFlow(txA);
    await saveGuestDraftHandoff(txA, guestFlowF);

    // Direct login invalidates stale onboarding authorization
    await invalidateStaleOnboardingAuthorization();

    // No completed proof should exist
    const proof = await readCompletedAuthProof();
    expect(proof).toBeNull();

    // Pre-auth markers should be cleared
    const handoff = await readGuestDraftHandoff();
    expect(handoff).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LEGITIMATE ONBOARDING TX-A + SUCCESSFUL AUTH AS U → COMPLETED PROOF + CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

describe('5. Legitimate onboarding TX-A + successful auth → completed proof + claim', () => {
  it('onboarding TX-A + completed proof {TX-A, U} + handoff TX-A + draft F → claim succeeds', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Dave'));

    // Pre-auth: program-summary saves pending plan + handoff
    const saved = await savePendingOnboardingPlan(makePlanInput('Dave'));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await saveGuestDraftHandoff(saved.flowId, guestFlowF);

    // Auth succeeds → runOnboardingTransition calls saveCompletedAuthProof
    await saveCompletedAuthProof(saved.flowId, userA);

    // Claim uses the completed proof (read internally)
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('claimed');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Dave');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. COMPLETED PROOF {TX-A, A} CANNOT AUTHORIZE CLAIM WHILE SESSION USER IS B
// ═══════════════════════════════════════════════════════════════════════════════

describe('6. Completed proof {TX-A, A} + session user B → no claim', () => {
  it('proof userId mismatch with session → reject with handoff_mismatch', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Eve'));

    const txA = 'tx-mismatch-006';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // Session is userB but proof is for userA
    const result = await claimGuestDraftWithHandoff(userB, guestFlowF, () => userB);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('handoff_mismatch');

    // Neither user has the draft
    const draftA = await readOnboardingDraftForOwner(ownerA);
    const draftB = await readOnboardingDraftForOwner(ownerB);
    expect(draftA).toBeNull();
    expect(draftB).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. APP KILL AFTER SUCCESSFUL ONBOARDING AUTH BUT BEFORE CLAIM → RECOVERY
// ═══════════════════════════════════════════════════════════════════════════════

describe('7. App kill after auth but before claim → persisted proof allows recovery', () => {
  it('completed proof survives app kill → same user can claim on next launch', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Frank'));

    const txA = 'tx-recovery-007';
    await saveGuestDraftHandoff(txA, guestFlowF);

    // Auth succeeded, proof was persisted, then app killed before claim
    await saveCompletedAuthProof(txA, userA);

    // Simulate app restart: in-memory state is gone, but AsyncStorage persists
    clearSessionAuthFlowId();

    // On next launch, claim reads the persisted completed proof
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('claimed');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Frank');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. APP KILL BEFORE AUTH SUCCEEDS → PRE-AUTH MARKER ALONE CANNOT AUTHORIZE
// ═══════════════════════════════════════════════════════════════════════════════

describe('8. App kill before auth succeeds → pre-auth marker alone insufficient', () => {
  it('pre-auth marker + handoff but no completed proof → no claim', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Grace'));

    const txA = 'tx-preauth-only-008';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveActiveOnboardingAuthFlow(txA);

    // App killed BEFORE auth completed → no completed proof exists
    // Simulate cold start: in-memory state gone
    clearSessionAuthFlowId();

    // No completed proof → claim must fail even though pre-auth marker exists
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_handoff');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. FORGED/STALE ROUTE PARAMETERS WITHOUT SUCCESSFUL AUTH → NO COMPLETED PROOF
// ═══════════════════════════════════════════════════════════════════════════════

describe('9. Forged route params without auth completion → no usable proof', () => {
  it('route params alone do not create a completed proof', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Heidi'));

    const txA = 'tx-forged-009';
    await saveGuestDraftHandoff(txA, guestFlowF);

    // Attacker has route params (flowId=txA) but auth never completed.
    // setSessionAuthFlowId is called by auth routes, but no completed proof
    // is created without a successful Supabase auth result.
    setSessionAuthFlowId(txA);

    // No saveCompletedAuthProof was called → no proof in AsyncStorage
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_handoff');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. COMPLETED PROOF IS CONSUMED IDEMPOTENTLY AND CANNOT BE REPLAYED
// ═══════════════════════════════════════════════════════════════════════════════

describe('10. Completed proof consumed idempotently — no replay', () => {
  it('first claim succeeds, second claim with consumed proof fails', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Ivan'));

    const txA = 'tx-consume-010';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // First claim succeeds
    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);
    expect(result1.reason).toBe('claimed');

    // Proof should now be consumed
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('consumed');

    // Second claim by a different user fails — proof userId mismatch
    const result2 = await claimGuestDraftWithHandoff(userB, guestFlowF, () => userB);
    expect(result2.ok).toBe(false);
    expect(result2.reason).toBe('handoff_mismatch');

    // UserB does not have the draft
    const draftB = await readOnboardingDraftForOwner(ownerB);
    expect(draftB).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. BEGINNING A DIRECT LOGIN EXPLICITLY INVALIDATES ABANDONED ONBOARDING AUTH
// ═══════════════════════════════════════════════════════════════════════════════

describe('11. Direct login invalidates abandoned onboarding authorization', () => {
  it('invalidateStaleOnboardingAuthorization clears all pre-auth markers', async () => {
    const txA = 'tx-invalidate-011';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveActiveOnboardingAuthFlow(txA);
    setSessionAuthFlowId(txA);
    await saveCompletedAuthProof(txA, userA);

    // Direct login triggers invalidation
    await invalidateStaleOnboardingAuthorization();

    // All onboarding authorization state is cleared
    const handoff = await readGuestDraftHandoff();
    expect(handoff).toBeNull();

    const proof = await readCompletedAuthProof();
    expect(proof).toBeNull();

    // Session auth flow ID is cleared
    // (clearSessionAuthFlowId is called inside invalidateStaleOnboardingAuthorization)
  });

  it('invalidateStaleOnboardingAuthorization preserves the guest draft itself', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Judy'));

    await invalidateStaleOnboardingAuthorization();

    // Guest draft is NOT cleared — only authorization is cleared
    const guestDraft = await readOnboardingDraftForOwner(guestOwnerF);
    expect(guestDraft).not.toBeNull();
    expect(guestDraft?.firstName).toBe('Judy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. LEGITIMATE ONBOARDING AUTH STILL WORKS FOR GOOGLE AND EMAIL PATH
// ═══════════════════════════════════════════════════════════════════════════════

describe('12. Legitimate onboarding auth works for Google and email paths', () => {
  it('onboarding TX-A + completed proof + handoff → claim succeeds (Google path)', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Google-User'));

    const saved = await savePendingOnboardingPlan(makePlanInput('Google-User'));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await saveGuestDraftHandoff(saved.flowId, guestFlowF);

    // Google auth succeeds → runOnboardingTransition creates completed proof
    await saveCompletedAuthProof(saved.flowId, userA);

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('claimed');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Google-User');
  });

  it('onboarding TX-A + completed proof + handoff → claim succeeds (email path)', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Email-User'));

    const saved = await savePendingOnboardingPlan(makePlanInput('Email-User'));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await saveGuestDraftHandoff(saved.flowId, guestFlowF);

    // Email auth succeeds → runOnboardingTransition creates completed proof
    await saveCompletedAuthProof(saved.flowId, userA);

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('claimed');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Email-User');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Crash recovery idempotence with completed proof
// ═══════════════════════════════════════════════════════════════════════════════

describe('Crash recovery idempotence with completed proof', () => {
  it('retry after crash is idempotent — no duplicate or loss', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Idempotent'));

    const txA = 'tx-idempotent-013';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // First claim succeeds
    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);

    // Simulate crash after claim but before UI navigates away
    // Retry: handoff is 'claimed' by userA, user copy exists
    const result2 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result2.ok).toBe(true);
    expect(result2.reason).toBe('already_owned');

    // Draft is still intact
    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Idempotent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: Session change during claim
// ═══════════════════════════════════════════════════════════════════════════════

describe('Session change during claim', () => {
  it('session changes U→B during claim → abort, no destructive cleanup', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('SessionChange'));

    const txA = 'tx-session-change-014';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // Session changes to userB during the claim
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userB);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('session_changed');

    // Neither user has the draft
    const draftA = await readOnboardingDraftForOwner(ownerA);
    const draftB = await readOnboardingDraftForOwner(ownerB);
    expect(draftA).toBeNull();
    expect(draftB).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: GuestDraftHandoff envelope validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('GuestDraftHandoff envelope', () => {
  it('saveGuestDraftHandoff writes a valid envelope', async () => {
    await saveGuestDraftHandoff('tx-env-001', guestFlowF);
    const handoff = await readGuestDraftHandoff();
    expect(handoff).not.toBeNull();
    expect(handoff?.transactionFlowId).toBe('tx-env-001');
    expect(handoff?.sourceGuestDraftFlowId).toBe(guestFlowF);
    expect(handoff?.status).toBe('awaiting_auth');
  });

  it('clearGuestDraftHandoff removes the envelope', async () => {
    await saveGuestDraftHandoff('tx-env-002', guestFlowF);
    await clearGuestDraftHandoff();
    const handoff = await readGuestDraftHandoff();
    expect(handoff).toBeNull();
  });

  it('corrupted handoff is rejected and cleared', async () => {
    await AsyncStorage.setItem('zainly:onboardingV2:guestDraftHandoff', '{not valid json');
    const handoff = await readGuestDraftHandoff();
    expect(handoff).toBeNull();
  });

  it('expired handoff is rejected and cleared', async () => {
    const expiredIso = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const expired = {
      version: 1,
      transactionFlowId: 'tx-expired',
      sourceGuestDraftFlowId: guestFlowF,
      status: 'awaiting_auth',
      claimedByUserId: null,
      createdAt: expiredIso,
    };
    await AsyncStorage.setItem('zainly:onboardingV2:guestDraftHandoff', JSON.stringify(expired));
    const handoff = await readGuestDraftHandoff();
    expect(handoff).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL: CompletedAuthProofV1 validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('CompletedAuthProofV1', () => {
  it('saveCompletedAuthProof writes a valid proof', async () => {
    await saveCompletedAuthProof('tx-proof-001', userA);
    const proof = await readCompletedAuthProof();
    expect(proof).not.toBeNull();
    expect(proof?.transactionFlowId).toBe('tx-proof-001');
    expect(proof?.userId).toBe(userA);
    expect(proof?.status).toBe('authenticated');
  });

  it('clearCompletedAuthProof removes the proof', async () => {
    await saveCompletedAuthProof('tx-proof-002', userA);
    await clearCompletedAuthProof();
    const proof = await readCompletedAuthProof();
    expect(proof).toBeNull();
  });

  it('consumeCompletedAuthProof marks status as consumed', async () => {
    await saveCompletedAuthProof('tx-proof-003', userA);
    await consumeCompletedAuthProof();
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('consumed');
  });

  it('corrupted proof is rejected and cleared', async () => {
    await AsyncStorage.setItem('zainly:onboardingV2:completedAuthProof', '{not valid json');
    const proof = await readCompletedAuthProof();
    expect(proof).toBeNull();
  });

  it('expired proof is rejected and cleared', async () => {
    const expiredIso = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const expired = {
      version: 1,
      transactionFlowId: 'tx-expired-proof',
      userId: userA,
      status: 'authenticated',
      createdAt: expiredIso,
    };
    await AsyncStorage.setItem('zainly:onboardingV2:completedAuthProof', JSON.stringify(expired));
    const proof = await readCompletedAuthProof();
    expect(proof).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRASH-CUT MATRIX: Reachable states from the real production write order
//
// Production mutation order in claimGuestDraftWithHandoff:
//   1. Read proof (readCompletedAuthProof)
//   2. Read handoff (readGuestDraftHandoff)
//   3. Validate proof, handoff, target user, session
//   4. claimDraftForUser:
//      a. Check existing user copy (idempotent retry)
//      b. Read guest draft
//      c. Write user copy (saveOnboardingDraftForOwner) — throws → write_failed
//      d. Readback user copy — null → write_failed
//      e. Delete guest copy — .catch (non-security-critical)
//      f. Clear guest flow ID
//   5. Mark handoff=claimed (AsyncStorage.setItem) — throws → write_failed
//   6. Readback handoff=claimed — mismatch → write_failed
//   7. Consume proof (consumeCompletedAuthProof) — catch (non-fatal, retry-safe)
//   8. Clear guest flow ID (cosmetic)
//
// Reachable crash states (proof is NEVER consumed before handoff is durably marked):
//   Before claim:          user absent, guest exists, handoff=awaiting, proof=authenticated
//   After user write:      user exists,  guest exists, handoff=awaiting, proof=authenticated
//   After guest delete:    user exists,  guest gone,   handoff=awaiting, proof=authenticated
//   After handoff mark:    user exists,  guest gone,   handoff=claimed,   proof=authenticated
//   After proof consume:   user exists,  guest gone,   handoff=claimed,   proof=consumed
// ═══════════════════════════════════════════════════════════════════════════════

describe('Crash-cut matrix — reachable states from real write order', () => {
  //
  // Cut A: After Supabase auth, before proof write (runOnboardingTransition crash).
  //   State: guest draft exists, handoff=awaiting, NO proof.
  //   Recovery: claim fails 'no_handoff'. User retries transition (session still active).
  //
  it('Cut A: auth succeeded but no proof written → claim fails, guest draft safe', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutA'));
    const txA = 'tx-cut-A';
    await saveGuestDraftHandoff(txA, guestFlowF);
    // No saveCompletedAuthProof — crashed before it was called

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_handoff');

    // Guest draft untouched
    const guestDraft = await readOnboardingDraftForOwner(guestOwnerF);
    expect(guestDraft?.firstName).toBe('CutA');
  });

  //
  // Cut B: After proof write, before claim called (navigation crash).
  //   State: guest draft exists, handoff=awaiting, proof=authenticated.
  //   Recovery: claim succeeds on next launch.
  //
  it('Cut B: proof written but claim not called → claim succeeds on restart', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutB'));
    const txA = 'tx-cut-B';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    clearSessionAuthFlowId();

    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('claimed');

    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('CutB');
  });

  //
  // Cut C: After user write+readback, before guest delete.
  //   State: user copy exists, guest copy exists, handoff=awaiting, proof=authenticated.
  //   Recovery: retry detects user copy → already_owned, cleans stale guest.
  //
  it('Cut C: user copy written, guest not deleted → retry returns already_owned', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutC'));
    const txA = 'tx-cut-C';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // Run claim — succeeds fully
    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);

    // Re-create guest copy to simulate crash before deletion
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutC'));

    // Proof is consumed, handoff is claimed (claim completed)
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('consumed');
    const handoff = await readGuestDraftHandoff();
    expect(handoff?.status).toBe('claimed');

    // Retry: already_owned, guest cleaned
    const result2 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result2.ok).toBe(true);
    expect(result2.reason).toBe('already_owned');

    expect(await readOnboardingDraftForOwner(guestOwnerF)).toBeNull();
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('CutC');
  });

  //
  // Cut D removed from reachable crash cuts.
  // The state handoff=awaiting_auth + proof=consumed is NOT reachable under
  // the strict write order: proof consumption (step 7) only runs after
  // handoff write (step 5) AND readback (step 6) both succeed.
  // If handoff write or readback fails, the function returns write_failed
  // and proof remains authenticated.
  // This state is tested as a defensive/legacy-state test below.

  //
  // Cut E: After handoff marked, before proof consumed.
  //   State: user copy exists, guest gone, handoff=claimed, proof=authenticated.
  //   Recovery: retry detects handoff=claimed + user copy → already_owned,
  //   then consumes proof.
  //
  it('Cut E: handoff claimed, proof not consumed → retry returns already_owned and consumes proof', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutE'));
    const txA = 'tx-cut-E';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // Run claim — succeeds fully
    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);

    // Reset proof to authenticated (simulating consume failure)
    await saveCompletedAuthProof(txA, userA);

    // Handoff is claimed, proof is authenticated
    const handoff = await readGuestDraftHandoff();
    expect(handoff?.status).toBe('claimed');
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('authenticated');

    // Retry: handoff=claimed + user copy → already_owned, proof consumed
    const result2 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result2.ok).toBe(true);
    expect(result2.reason).toBe('already_owned');

    // Proof is now consumed
    const proofAfter = await readCompletedAuthProof();
    expect(proofAfter?.status).toBe('consumed');

    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('CutE');
  });

  //
  // Cut F: After proof consumed (final state).
  //   State: user copy exists, guest gone, handoff=claimed, proof=consumed.
  //   Recovery: retry returns already_owned.
  //
  it('Cut F: proof consumed, handoff claimed → retry returns already_owned', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('CutF'));
    const txA = 'tx-cut-F';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);

    // Verify final state
    expect((await readCompletedAuthProof())?.status).toBe('consumed');
    expect((await readGuestDraftHandoff())?.status).toBe('claimed');

    const result2 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result2.ok).toBe(true);
    expect(result2.reason).toBe('already_owned');

    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('CutF');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEFENSIVE: Legacy/corruption state — handoff=awaiting_auth + proof=consumed
//
// This state is NOT reachable under the strict write order (handoff is always
// durably marked before proof is consumed). It can only occur from:
//   - Legacy data written by a previous version of the code
//   - Storage corruption
//   - Manual test manipulation
//
// The safety-net guard in claimGuestDraftWithHandoff (lines 951-966) handles
// this state defensively: if a user copy exists, return already_owned;
// if not, reject as a potential replay.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Defensive: legacy/corruption state — handoff=awaiting_auth + proof=consumed', () => {
  it('legacy state: consumed proof + awaiting_auth handoff + user copy exists → already_owned', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Legacy1'));
    const txA = 'tx-legacy-001';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    // Run claim — succeeds fully (handoff marked, proof consumed)
    const result1 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result1.ok).toBe(true);

    // Simulate legacy/corruption: reset handoff to awaiting_auth
    await saveGuestDraftHandoff(txA, guestFlowF);

    // Proof is consumed, handoff is awaiting_auth — NOT a reachable crash cut
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('consumed');
    const handoff = await readGuestDraftHandoff();
    expect(handoff?.status).toBe('awaiting_auth');

    // Safety-net guard: consumed proof + user copy exists → already_owned
    const result2 = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result2.ok).toBe(true);
    expect(result2.reason).toBe('already_owned');

    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Legacy1');
  });

  it('corruption state: consumed proof + awaiting_auth handoff + NO user copy → already_claimed (replay blocked)', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Legacy2'));
    const txA = 'tx-legacy-002';
    await saveGuestDraftHandoff(txA, guestFlowF);

    // Manually set proof to consumed without running claim
    await saveCompletedAuthProof(txA, userA);
    await consumeCompletedAuthProof();

    // No user copy exists — this is a replay/corruption, not a recovery
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_claimed');

    // Guest draft is untouched
    expect((await readOnboardingDraftForOwner(guestOwnerF))?.firstName).toBe('Legacy2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE-INJECTION: 10 injected cuts into the real production operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Failure-injection: 10 injected cuts into real production operations', () => {
  const mockAsyncStorage = AsyncStorage as unknown as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
    getAllKeys: jest.Mock;
    multiRemove: jest.Mock;
  };

  // Helper: temporarily override setItem to throw for a specific key
  function withSetItemFailure(keyToFail: string, fn: () => Promise<void>): Promise<void> {
    const original = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === keyToFail) throw new Error('Storage write failed');
      original(key, value);
    });
    return fn().finally(() => {
      mockAsyncStorage.setItem.mockImplementation(original);
    });
  }

  // Helper: temporarily override removeItem to throw
  function withRemoveItemFailure(fn: () => Promise<void>): Promise<void> {
    const original = mockAsyncStorage.removeItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.removeItem.mockImplementation(async () => {
      throw new Error('Storage remove failed');
    });
    return fn().finally(() => {
      mockAsyncStorage.removeItem.mockImplementation(original);
    });
  }

  // Helper: temporarily override getItem to return null for a specific key (readback failure)
  function withGetItemNull(keyToFail: string, fn: () => Promise<void>): Promise<void> {
    const original = mockAsyncStorage.getItem.getMockImplementation() ?? (async () => null);
    mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === keyToFail) return null;
      return original(key);
    });
    return fn().finally(() => {
      mockAsyncStorage.getItem.mockImplementation(original);
    });
  }

  function setupClaim(): Promise<void> {
    return (async () => {
      await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Inject'));
      await saveGuestDraftHandoff('tx-inject', guestFlowF);
      await saveCompletedAuthProof('tx-inject', userA);
    })();
  }

  //
  // Cut 1: User-copy write failure
  //
  it('Cut 1: user-copy write fails → claim returns write_failed, proof remains authenticated', async () => {
    await setupClaim();
    const userDraftKey = `zainly:onboardingDraft:v2:user:${userA}`;

    await withSetItemFailure(userDraftKey, async () => {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');
    });

    // Proof remains authenticated (not consumed)
    const proof = await readCompletedAuthProof();
    expect(proof?.status).toBe('authenticated');
    // Handoff remains awaiting_auth
    const handoff = await readGuestDraftHandoff();
    expect(handoff?.status).toBe('awaiting_auth');
    // Guest draft untouched
    expect((await readOnboardingDraftForOwner(guestOwnerF))?.firstName).toBe('Inject');
    // No user copy
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();

    // Retry succeeds after fix
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect(retry.reason).toBe('claimed');
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');
  });

  //
  // Cut 2: User-copy readback failure (getItem returns null for user draft)
  //
  it('Cut 2: user-copy readback returns null → claim returns write_failed, proof authenticated', async () => {
    await setupClaim();
    const userDraftKey = `zainly:onboardingDraft:v2:user:${userA}`;

    // Only fail readback AFTER the user draft write, not the initial check
    let userDraftWritten = false;
    const originalGet = mockAsyncStorage.getItem.getMockImplementation() ?? (async () => null);
    const originalSet = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === userDraftKey) {
        await originalSet(key, value);
        userDraftWritten = true;
        return;
      }
      return originalSet(key, value);
    });
    mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === userDraftKey && userDraftWritten) return null;
      return originalGet(key);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');
    } finally {
      mockAsyncStorage.setItem.mockImplementation(originalSet);
      mockAsyncStorage.getItem.mockImplementation(originalGet);
    }

    // Proof remains authenticated
    expect((await readCompletedAuthProof())?.status).toBe('authenticated');
    // Handoff remains awaiting_auth
    expect((await readGuestDraftHandoff())?.status).toBe('awaiting_auth');
    // No user copy visible (readback failed, but write may have landed)
    // Guest draft still exists
    expect((await readOnboardingDraftForOwner(guestOwnerF))?.firstName).toBe('Inject');

    // Retry succeeds
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
  });

  //
  // Cut 3: Guest-delete failure
  //   Guest deletion uses .catch — non-security-critical. Claim succeeds.
  //   User copy is durable. Stale guest copy is orphaned but harmless.
  //
  it('Cut 3: guest-delete fails → claim still succeeds, guest copy orphaned, retry cleans up', async () => {
    await setupClaim();
    const guestDraftKey = `zainly:onboardingDraft:v2:guest:${guestFlowF}`;

    // Fail removeItem for the guest draft key (clearOnboardingDraftForOwner uses removeItem)
    const originalRemove = mockAsyncStorage.removeItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.removeItem.mockImplementation(async (key: string) => {
      if (key === guestDraftKey) throw new Error('Storage remove failed');
      return originalRemove(key);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      // Claim succeeds — guest deletion is non-fatal
      expect(result.ok).toBe(true);
      expect(result.reason).toBe('claimed');

      // User copy exists
      expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');
      // Proof is consumed
      expect((await readCompletedAuthProof())?.status).toBe('consumed');
      // Handoff is claimed
      expect((await readGuestDraftHandoff())?.status).toBe('claimed');
    } finally {
      mockAsyncStorage.removeItem.mockImplementation(originalRemove);
    }

    // Retry returns already_owned
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect(retry.reason).toBe('already_owned');
  });

  //
  // Cut 4: Handoff-claimed write failure
  //   With strict marking, claim returns write_failed. Proof remains authenticated.
  //
  it('Cut 4: handoff-claimed write fails → claim returns write_failed, proof authenticated', async () => {
    await setupClaim();

    await withSetItemFailure('zainly:onboardingV2:guestDraftHandoff', async () => {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');
    });

    // Proof remains authenticated (NOT consumed — strict order)
    expect((await readCompletedAuthProof())?.status).toBe('authenticated');
    // Handoff remains awaiting_auth
    expect((await readGuestDraftHandoff())?.status).toBe('awaiting_auth');
    // User copy exists (claimDraftForUser succeeded)
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');
    // Guest copy is gone (claimDraftForUser deleted it)
    expect(await readOnboardingDraftForOwner(guestOwnerF)).toBeNull();

    // Retry: user copy exists → already_owned, handoff marked, proof consumed
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect(retry.reason).toBe('already_owned');
    expect((await readGuestDraftHandoff())?.status).toBe('claimed');
    expect((await readCompletedAuthProof())?.status).toBe('consumed');
  });

  //
  // Cut 5: Handoff-claimed readback failure (getItem returns null for handoff)
  //
  it('Cut 5: handoff-claimed readback returns null → claim returns write_failed, proof authenticated', async () => {
    await setupClaim();

    // Only fail readback AFTER the handoff write, not the initial read
    let handoffWritten = false;
    const originalGet = mockAsyncStorage.getItem.getMockImplementation() ?? (async () => null);
    const originalSet = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === 'zainly:onboardingV2:guestDraftHandoff') {
        await originalSet(key, value);
        handoffWritten = true;
        return;
      }
      return originalSet(key, value);
    });
    mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === 'zainly:onboardingV2:guestDraftHandoff' && handoffWritten) return null;
      return originalGet(key);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');
    } finally {
      mockAsyncStorage.setItem.mockImplementation(originalSet);
      mockAsyncStorage.getItem.mockImplementation(originalGet);
    }

    // Proof remains authenticated
    expect((await readCompletedAuthProof())?.status).toBe('authenticated');
    // User copy exists
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');

    // Retry succeeds
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
  });

  //
  // Cut 6: Proof-consumed write failure
  //   Proof consumption is wrapped in catch — claim succeeds, proof remains authenticated.
  //   Retry will consume proof idempotently.
  //
  it('Cut 6: proof-consumed write fails → claim succeeds, proof remains authenticated, retry consumes', async () => {
    await setupClaim();

    await withSetItemFailure('zainly:onboardingV2:completedAuthProof', async () => {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      // Claim succeeds — proof consumption is non-fatal
      expect(result.ok).toBe(true);
      expect(result.reason).toBe('claimed');
    });

    // Handoff is claimed
    expect((await readGuestDraftHandoff())?.status).toBe('claimed');
    // Proof remains authenticated (consume failed)
    expect((await readCompletedAuthProof())?.status).toBe('authenticated');
    // User copy exists
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');

    // Retry: already_owned + consumes proof
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect(retry.reason).toBe('already_owned');
    expect((await readCompletedAuthProof())?.status).toBe('consumed');
  });

  //
  // Cut 7: Proof-consumed readback failure
  //   consumeCompletedAuthProof throws on readback, but claim catches it.
  //   Claim succeeds, proof may or may not be consumed.
  //
  it('Cut 7: proof-consumed readback fails → claim succeeds, retry is safe', async () => {
    await setupClaim();

    // Only fail readback of the proof AFTER consume write, not the initial read
    let proofConsumed = false;
    const originalGet = mockAsyncStorage.getItem.getMockImplementation() ?? (async () => null);
    const originalSet = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === 'zainly:onboardingV2:completedAuthProof') {
        const parsed = JSON.parse(value);
        if (parsed.status === 'consumed') {
          await originalSet(key, value);
          proofConsumed = true;
          return;
        }
      }
      return originalSet(key, value);
    });
    mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === 'zainly:onboardingV2:completedAuthProof' && proofConsumed) return null;
      return originalGet(key);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      // Claim succeeds — proof consumption failure is caught
      expect(result.ok).toBe(true);
      expect(result.reason).toBe('claimed');
    } finally {
      mockAsyncStorage.setItem.mockImplementation(originalSet);
      mockAsyncStorage.getItem.mockImplementation(originalGet);
    }

    // Handoff is claimed
    expect((await readGuestDraftHandoff())?.status).toBe('claimed');
    // User copy exists
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Inject');

    // Retry is safe
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect(retry.reason).toBe('already_owned');
  });

  //
  // Cut 8: Completed-proof initial write failure (saveCompletedAuthProof)
  //   saveCompletedAuthProof now throws. runOnboardingTransition catches it
  //   and returns proof_persist_failed. Tested in onboardingTransition.test.ts.
  //   Here we test that the claim fails without the proof.
  //
  it('Cut 8: completed-proof initial write fails → no proof, claim fails no_handoff', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Cut8'));
    await saveGuestDraftHandoff('tx-cut-8', guestFlowF);

    // saveCompletedAuthProof throws because setItem fails
    await withSetItemFailure('zainly:onboardingV2:completedAuthProof', async () => {
      await expect(saveCompletedAuthProof('tx-cut-8', userA)).rejects.toThrow();
    });

    // No proof in storage
    expect(await readCompletedAuthProof()).toBeNull();

    // Claim fails
    const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_handoff');

    // Guest draft untouched
    expect((await readOnboardingDraftForOwner(guestOwnerF))?.firstName).toBe('Cut8');
    // No user copy
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();

    // Another user sees nothing
    expect(await readOnboardingDraftForOwner({ kind: 'authenticated', userId: 'userB' })).toBeNull();
  });

  //
  // Cut 9: Completed-proof initial readback failure
  //   saveCompletedAuthProof writes but readback returns null → throws.
  //
  it('Cut 9: completed-proof readback returns null → saveCompletedAuthProof throws', async () => {
    await saveGuestDraftHandoff('tx-cut-9', guestFlowF);

    await withGetItemNull('zainly:onboardingV2:completedAuthProof', async () => {
      await expect(saveCompletedAuthProof('tx-cut-9', userA)).rejects.toThrow('readback');
    });

    // No usable proof
    // (write may have landed but readback failed, so saveCompletedAuthProof threw)
    // Claim would fail if called
  });

  //
  // Cut 10: Direct-login invalidation failure
  //   invalidateStaleOnboardingAuthorization throws on removeItem failure.
  //
  it('Cut 10: direct-login invalidation fails → throws (fail-closed)', async () => {
    await saveGuestDraftHandoff('tx-cut-10', guestFlowF);
    await saveCompletedAuthProof('tx-cut-10', userA);

    await withRemoveItemFailure(async () => {
      await expect(invalidateStaleOnboardingAuthorization()).rejects.toThrow('Storage remove failed');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION: Strict write order — proof never consumed before handoff marked
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression: strict write order — proof never consumed before handoff durably marked', () => {
  it('handoff write failure leaves proof authenticated (not consumed)', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Strict1'));
    const txA = 'tx-strict-001';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    const mockAsyncStorage = AsyncStorage as unknown as {
      getItem: jest.Mock;
      setItem: jest.Mock;
      removeItem: jest.Mock;
      getAllKeys: jest.Mock;
      multiRemove: jest.Mock;
    };

    const original = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === 'zainly:onboardingV2:guestDraftHandoff') throw new Error('Handoff write failed');
      return original(key, value);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');

      // CRITICAL: proof must remain authenticated, NOT consumed
      const proof = await readCompletedAuthProof();
      expect(proof?.status).toBe('authenticated');
    } finally {
      mockAsyncStorage.setItem.mockImplementation(original);
    }

    // Retry succeeds
    const retry = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
    expect(retry.ok).toBe(true);
    expect((await readCompletedAuthProof())?.status).toBe('consumed');
    expect((await readGuestDraftHandoff())?.status).toBe('claimed');
  });

  it('handoff readback failure leaves proof authenticated (not consumed)', async () => {
    await saveOnboardingDraftForOwner(guestOwnerF, makeDraft('Strict2'));
    const txA = 'tx-strict-002';
    await saveGuestDraftHandoff(txA, guestFlowF);
    await saveCompletedAuthProof(txA, userA);

    const mockAsyncStorage = AsyncStorage as unknown as {
      getItem: jest.Mock;
      setItem: jest.Mock;
      removeItem: jest.Mock;
      getAllKeys: jest.Mock;
      multiRemove: jest.Mock;
    };

    const originalGet = mockAsyncStorage.getItem.getMockImplementation() ?? (async () => null);
    // Let the handoff write succeed, but readback returns null
    let allowHandoffWrite = true;
    const originalSet = mockAsyncStorage.setItem.getMockImplementation() ?? (async () => {});
    mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === 'zainly:onboardingV2:guestDraftHandoff') {
        await originalSet(key, value);
        allowHandoffWrite = false;
        return;
      }
      return originalSet(key, value);
    });
    mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === 'zainly:onboardingV2:guestDraftHandoff' && !allowHandoffWrite) {
        return null; // readback fails
      }
      return originalGet(key);
    });

    try {
      const result = await claimGuestDraftWithHandoff(userA, guestFlowF, () => userA);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_failed');

      // CRITICAL: proof must remain authenticated
      const proof = await readCompletedAuthProof();
      expect(proof?.status).toBe('authenticated');
    } finally {
      mockAsyncStorage.setItem.mockImplementation(originalSet);
      mockAsyncStorage.getItem.mockImplementation(originalGet);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION: invalidateStaleOnboardingAuthorization is fail-closed
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression: invalidateStaleOnboardingAuthorization is fail-closed', () => {
  it('invalidation throws when AsyncStorage.removeItem fails', async () => {
    await saveGuestDraftHandoff('tx-fix2-001', guestFlowF);
    await saveCompletedAuthProof('tx-fix2-001', userA);

    const mockAsyncStorage = AsyncStorage as unknown as {
      getItem: jest.Mock;
      setItem: jest.Mock;
      removeItem: jest.Mock;
      getAllKeys: jest.Mock;
      multiRemove: jest.Mock;
    };

    const original = mockAsyncStorage.removeItem.getMockImplementation();
    mockAsyncStorage.removeItem.mockImplementation(async () => {
      throw new Error('Storage remove failed');
    });

    try {
      await expect(invalidateStaleOnboardingAuthorization()).rejects.toThrow();
    } finally {
      mockAsyncStorage.removeItem.mockImplementation(original);
    }
  });

  it('invalidation succeeds when AsyncStorage works normally', async () => {
    await saveGuestDraftHandoff('tx-fix2-002', guestFlowF);
    await saveCompletedAuthProof('tx-fix2-002', userA);

    await invalidateStaleOnboardingAuthorization();

    expect(await readGuestDraftHandoff()).toBeNull();
    expect(await readCompletedAuthProof()).toBeNull();
  });
});
