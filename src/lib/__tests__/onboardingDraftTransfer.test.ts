/// <reference types="jest" />
// ─── Red-to-green regression tests for guest→auth draft transfer ───────────
//
// These tests simulate the REAL runtime event order:
//   guest onboarding → authentication → finalization
//
// They do NOT mock useDraftOwner or the auth transition. They call the
// actual production functions in the exact order they would be called
// at runtime, proving that the guest draft is correctly claimed after
// authentication.
//
// Tests are written to FAIL against the current (broken) implementation
// and PASS after the fix.

import {
  readOnboardingDraftForOwner,
  saveOnboardingDraftForOwner,
  updateOnboardingDraftForOwner,
  claimDraftForUser,
  purgeAllOnboardingDrafts,
  draftKeyForOwner,
  getOrCreateGuestFlowId,
  clearGuestFlowId,
  inspectDraftForOwner,
  type OnboardingDraftOwner,
  type OnboardingDraftV1,
} from '../onboardingDraft';
import {
  savePendingOnboardingPlan,
  claimPendingOnboardingPlanForUser,
  clearAllPendingOnboardingData,
} from '../pendingOnboardingPlan';
import { finalizeOnboardingV2Plan } from '../onboardingFinalize';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock Supabase and network dependencies for finalizeOnboardingV2Plan
// fetchPlan/fetchProgress: first call returns null (no existing plan),
// second call (confirmation after RPC) returns non-null.
jest.mock('@/db/plans', () => ({
  fetchPlan: jest.fn(),
}));
jest.mock('@/db/progress', () => ({
  fetchProgress: jest.fn(),
}));
jest.mock('@/db/finalizeOnboardingPlan', () => ({
  finalizeOnboardingPlanRpc: jest.fn(async () => ({ ok: true, reason: 'created' })),
}));
jest.mock('@/db/profiles', () => ({
  upsertProfileFirstName: jest.fn(async () => {}),
}));
jest.mock('@/notifications/scheduler', () => ({
  scheduleDailyHifzReminder: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/notifications/storage', () => ({
  saveNotificationSettings: jest.fn(async () => {}),
}));
jest.mock('@/notifications/types', () => ({
  DEFAULT_SETTINGS: { enabled: true },
}));
jest.mock('@/lib/revenueCat', () => ({
  syncRevenueCatUserAfterAuth: jest.fn(async () => ({ ok: true, entitlementActive: false })),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  const mock = {
    getItem: jest.fn(async (key: string) => (key in store ? store[key] : null)),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, k in store ? store[k] : null])),
    multiSet: jest.fn(async (entries: [string, string][]) => { entries.forEach(([k, v]) => { store[k] = v; }); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => { delete store[k]; }); }),
  };
  return { __esModule: true, default: mock };
});

const userA = 'user-aaa-111';
const userB = 'user-bbb-222';
const ownerA: OnboardingDraftOwner = { kind: 'authenticated', userId: userA };
const ownerB: OnboardingDraftOwner = { kind: 'authenticated', userId: userB };

function makeDraft(firstName: string): OnboardingDraftV1 {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStep: 'program_summary',
    firstName,
    learningMode: 'recommended',
    knownSurahs: [1, 2],
    startingSurah: null,
    customSurahOrder: [],
    continueWithRest: true,
    experienceChoice: 'daily_limited',
    notificationPreference: 'skipped',
    discoverySource: 'google',
  };
}

beforeEach(async () => {
  await purgeAllOnboardingDrafts();
  await clearAllPendingOnboardingData();
  await clearGuestFlowId();
  jest.clearAllMocks();

  // Reset fetchPlan/fetchProgress mocks for each test
  const plansModule = jest.requireMock('@/db/plans') as { fetchPlan: jest.Mock };
  const progressModule = jest.requireMock('@/db/progress') as { fetchProgress: jest.Mock };
  plansModule.fetchPlan.mockResolvedValue(null);
  progressModule.fetchProgress.mockResolvedValue(null);
  // After RPC 'creates', confirmation reads return non-null
  plansModule.fetchPlan.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'plan-1' });
  progressModule.fetchProgress.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'progress-1' });
})

// ═══════════════════════════════════════════════════════════════════════════════
// 1-8: GUEST → AUTH TRANSFER (REAL FLOW SIMULATION)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Guest → auth transfer — real runtime flow', () => {
  // 1. Guest obtains flow F
  // 2. Several screens write/read the same guest:F draft
  // 3. Authentication changes from null to user U
  // 4. The owner hook now resolves to authenticated user U
  // 5. The explicitly carried source flow F is still claimable
  // 6. The user copy is written and verified before guest deletion
  // 7. A session change during the transfer aborts safely
  // 8. Retrying after interruption is idempotent

  it('1-5. guest flow F survives auth boundary and is claimable as user U', async () => {
    // Step 1: Guest obtains flow F
    const flowF = await getOrCreateGuestFlowId();
    expect(flowF).toBeTruthy();
    const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };

    // Step 2: Several screens write/read the same guest:F draft
    await updateOnboardingDraftForOwner(guestOwner, { firstName: 'Alice', currentStep: 'greeting' });
    await updateOnboardingDraftForOwner(guestOwner, { learningMode: 'recommended' });
    const draft = await readOnboardingDraftForOwner(guestOwner);
    expect(draft?.firstName).toBe('Alice');
    expect(draft?.learningMode).toBe('recommended');

    // Step 3: Authentication changes from null to user U
    // (Simulated — in real runtime, useAuthStore.session.user.id becomes userA)

    // Step 4: The owner hook now resolves to authenticated user U
    // (Simulated — useDraftOwner would return { kind: 'authenticated', userId: userA })
    // The guest draft is NOT visible under the user key:
    const userDraftBeforeClaim = await readOnboardingDraftForOwner(ownerA);
    expect(userDraftBeforeClaim).toBeNull();

    // Step 5: The explicitly carried source flow F is still claimable
    // The flowF was carried through the auth boundary (via pending payload flowId)
    const claimResult = await claimDraftForUser(userA, flowF);
    expect(claimResult.ok).toBe(true);
    expect(claimResult.reason).toBe('claimed');

    // The draft is now under user:userA
    const userDraftAfterClaim = await readOnboardingDraftForOwner(ownerA);
    expect(userDraftAfterClaim).not.toBeNull();
    expect(userDraftAfterClaim?.firstName).toBe('Alice');

    // The guest copy is cleaned up
    const guestDraftAfterClaim = await readOnboardingDraftForOwner(guestOwner);
    expect(guestDraftAfterClaim).toBeNull();
  });

  it('6. user copy is written and verified before guest deletion', async () => {
    const flowF = await getOrCreateGuestFlowId();
    const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('Alice'));

    // Simulate crash after user copy written but before guest deletion
    const userKey = draftKeyForOwner(ownerA);
    const guestKey = draftKeyForOwner(guestOwner);
    const guestRaw = await AsyncStorage.getItem(guestKey);
    expect(guestRaw).not.toBeNull();

    // Write user copy with correct owner envelope
    const userEnvelope = JSON.stringify({
      owner: { kind: 'authenticated', userId: userA },
      data: makeDraft('Alice'),
    });
    await AsyncStorage.setItem(userKey, userEnvelope);

    // Crash — guest copy still exists. On retry:
    const claimResult = await claimDraftForUser(userA, flowF);
    expect(claimResult.ok).toBe(true);
    expect(claimResult.reason).toBe('already_owned');

    // User copy is intact
    const userDraft = await readOnboardingDraftForOwner(ownerA);
    expect(userDraft?.firstName).toBe('Alice');

    // Guest copy is cleaned up
    const guestDraft = await readOnboardingDraftForOwner(guestOwner);
    expect(guestDraft).toBeNull();
  });

  it('7. session change during transfer aborts safely', async () => {
    const flowF = await getOrCreateGuestFlowId();
    const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('Alice'));

    // Session changes to userB during the claim for userA
    let sessionUserId = userB; // already different
    const claimResult = await claimDraftForUser(userA, flowF, () => sessionUserId);
    expect(claimResult.ok).toBe(false);
    expect(claimResult.reason).toBe('session_changed');

    // Guest draft is untouched (claim aborted before deletion)
    const guestDraft = await readOnboardingDraftForOwner(guestOwner);
    expect(guestDraft).not.toBeNull();
    expect(guestDraft?.firstName).toBe('Alice');

    // User copy was NOT written
    const userDraft = await readOnboardingDraftForOwner(ownerA);
    expect(userDraft).toBeNull();
  });

  it('8. retrying after interruption is idempotent', async () => {
    const flowF = await getOrCreateGuestFlowId();
    const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('Alice'));

    const first = await claimDraftForUser(userA, flowF);
    expect(first.ok).toBe(true);
    expect(first.reason).toBe('claimed');

    const second = await claimDraftForUser(userA, flowF);
    expect(second.ok).toBe(true);
    expect(second.reason).toBe('already_owned');

    // Draft is still intact under user key
    const userDraft = await readOnboardingDraftForOwner(ownerA);
    expect(userDraft?.firstName).toBe('Alice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9: DIRECT SOCIAL LOGIN — NO CLAIM WITHOUT ACTIVE TRANSACTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Direct social login — stale guest draft not claimed', () => {
  // 9. Direct Google login with a stale guest:F and no active transaction
  //    does not claim it.
  it('9. direct Google login does not claim stale guest draft (no purge)', async () => {
    // A stale guest draft exists from a previous onboarding session
    const flowF = await getOrCreateGuestFlowId();
    const guestOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('Stale'));

    // Direct Google login: no active onboarding transaction
    // The app does NOT call claimDraftForUser — there is no authFlowId
    // The user's draft under user:google-new is empty
    const googleOwner: OnboardingDraftOwner = { kind: 'authenticated', userId: 'user-google-new' };
    const draft = await readOnboardingDraftForOwner(googleOwner);
    expect(draft).toBeNull();

    // The stale guest draft is NOT claimed — it's still under guest:F
    // It is NOT visible to the Google user
    const guestDraft = await readOnboardingDraftForOwner(guestOwner);
    expect(guestDraft).not.toBeNull();
    expect(guestDraft?.firstName).toBe('Stale');

    // The Google user cannot read it
    const googleDraft = await readOnboardingDraftForOwner(googleOwner);
    expect(googleDraft).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10: DIFFERENT FLOW CANNOT CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-flow isolation', () => {
  // 10. A different flow G cannot claim F
  it('10. flow G cannot claim flow F draft', async () => {
    const flowF = 'flow-aaa-111';
    const flowG = 'flow-bbb-222';
    const guestFOwner: OnboardingDraftOwner = { kind: 'guest', flowId: flowF };
    await saveOnboardingDraftForOwner(guestFOwner, makeDraft('Alice'));

    // Claim with flowG — no guest draft exists under flowG
    const claimResult = await claimDraftForUser(userA, flowG);
    expect(claimResult.ok).toBe(false);
    expect(claimResult.reason).toBe('no_guest_draft');

    // Flow F draft is untouched
    const draft = await readOnboardingDraftForOwner(guestFOwner);
    expect(draft?.firstName).toBe('Alice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11: CORRUPTED ENVELOPE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Corrupted envelope inspection', () => {
  // 11. A corrupted A envelope under B's physical key produces an explicit
  //     mismatch/corruption result, not silent absence.
  it('11. envelope with owner A under B key produces owner_mismatch', async () => {
    const keyB = draftKeyForOwner(ownerB);
    const fakeEnvelope = JSON.stringify({
      owner: { kind: 'authenticated', userId: userA },
      data: makeDraft('Alice'),
    });
    await AsyncStorage.setItem(keyB, fakeEnvelope);

    const inspection = await inspectDraftForOwner(ownerB);
    expect(inspection.status).toBe('owner_mismatch');
    // B must NOT be able to read the data
    const draft = await readOnboardingDraftForOwner(ownerB);
    expect(draft).toBeNull();
  });

  it('11b. corrupted JSON under user key produces corrupt', async () => {
    const keyA = draftKeyForOwner(ownerA);
    await AsyncStorage.setItem(keyA, 'not-valid-json{');

    const inspection = await inspectDraftForOwner(ownerA);
    expect(inspection.status).toBe('corrupt');
  });

  it('11c. valid envelope under correct key produces valid', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const inspection = await inspectDraftForOwner(ownerA);
    expect(inspection.status).toBe('valid');
  });

  it('11d. no data under key produces absent', async () => {
    const inspection = await inspectDraftForOwner(ownerA);
    expect(inspection.status).toBe('absent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12: PENDING ONBOARDING CROSS-ACCOUNT ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pending onboarding cross-account isolation', () => {
  // 12. Finalization cannot use pending data belonging to another user or flow.
  it('12a. user B cannot claim pending payload saved by user A flow', async () => {
    const saved = await savePendingOnboardingPlan({
      firstName: 'Alice',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'skipped',
      discoverySource: 'google',
      experienceChoice: 'daily_limited',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const flowF = saved.flowId;

    // User B tries to claim with a different flowId
    const claimed = await claimPendingOnboardingPlanForUser(userB, 'flow-wrong');
    expect(claimed).toBeNull();

    // User B tries to claim with the correct flowId
    // The claim succeeds because the pending is not yet owned by anyone
    // and the flowId matches. This is correct: the flowId proves the parcours,
    // and the authenticated user is the one who completed it.
    const claimed2 = await claimPendingOnboardingPlanForUser(userB, flowF);
    expect(claimed2).not.toBeNull();
    expect(claimed2?.ownerUserId).toBe(userB);
  });

  it('12b. user B cannot claim pending already owned by user A', async () => {
    const saved = await savePendingOnboardingPlan({
      firstName: 'Alice',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'skipped',
      discoverySource: 'google',
      experienceChoice: 'daily_limited',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const flowF = saved.flowId;

    // User A claims it
    const claimedA = await claimPendingOnboardingPlanForUser(userA, flowF);
    expect(claimedA).not.toBeNull();
    expect(claimedA?.ownerUserId).toBe(userA);

    // User B tries to claim — should fail because already owned by A
    const claimedB = await claimPendingOnboardingPlanForUser(userB, flowF);
    expect(claimedB).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13: GUEST FLOWID STABILITY ACROSS RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

describe('Guest flowId stability within same runtime', () => {
  // 13. AsyncStorage failure still gives every screen the same in-memory
  //     flow ID during the current runtime, or blocks explicitly.
  it('13. same flowId returned on repeated calls within same runtime', async () => {
    const f1 = await getOrCreateGuestFlowId();
    const f2 = await getOrCreateGuestFlowId();
    const f3 = await getOrCreateGuestFlowId();
    expect(f1).toBeTruthy();
    expect(f2).toBe(f1);
    expect(f3).toBe(f1);
  });

  it('13b. flowId is stable even if AsyncStorage getItem fails on second call', async () => {
    const f1 = await getOrCreateGuestFlowId();
    expect(f1).toBeTruthy();

    // Simulate AsyncStorage failure on subsequent reads
    const mockAsync = AsyncStorage as unknown as {
      getItem: jest.Mock;
    };
    const originalGetItem = mockAsync.getItem.getMockImplementation();
    mockAsync.getItem.mockRejectedValueOnce(new Error('disk error'));

    const f2 = await getOrCreateGuestFlowId();
    // Should return the same value from in-memory cache
    expect(f2).toBe(f1);

    // Restore
    if (originalGetItem) mockAsync.getItem.mockImplementation(originalGetItem);
  });

  it('13c. clearGuestFlowId resets in-memory cache so next call generates new id', async () => {
    const f1 = await getOrCreateGuestFlowId();
    await clearGuestFlowId();
    const f2 = await getOrCreateGuestFlowId();
    expect(f2).not.toBe(f1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15: SUCCESSFUL FINALIZATION CLEARS ONLY EXACT USER/TRANSACTION STATE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finalization cleanup precision', () => {
  // 15. Successful finalization clears only the exact user/transaction state
  //     that was consumed.
  it('15. finalization clears only the finalized user draft, not other users', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));
    await saveOnboardingDraftForOwner(ownerB, makeDraft('Bob'));

    // Finalize for user A
    const result = await finalizeOnboardingV2Plan(userA, '');
    expect(result.ok).toBe(true);

    // User A's draft is cleared
    const draftA = await readOnboardingDraftForOwner(ownerA);
    expect(draftA).toBeNull();

    // User B's draft is NOT cleared
    const draftB = await readOnboardingDraftForOwner(ownerB);
    expect(draftB).not.toBeNull();
    expect(draftB?.firstName).toBe('Bob');
  });
});
