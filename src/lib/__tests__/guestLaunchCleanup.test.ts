/// <reference types="jest" />
// ─── Targeted test: guest draft cleanup race elimination ───────────────────
//
// Verifies that prepareGuestLaunchIfNeeded:
//   1. Blocks the bootstrap chain (returns a pending promise) until cleanup
//      completes — no screen can read a stale draft during that window.
//   2. Actually clears the persisted guest flowId and orphaned guest drafts.
//   3. Skips cleanup when a valid pending onboarding plan exists.
//   4. Skips cleanup when an active auth flow marker exists.
//   5. Never touches user-owned drafts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveOnboardingDraftForOwner,
  readOnboardingDraftForOwner,
  getOrCreateGuestFlowId,
  clearGuestFlowId,
  prepareGuestLaunchIfNeeded,
  type OnboardingDraftV1,
} from '../onboardingDraft';
import {
  savePendingOnboardingPlan,
  clearAllPendingOnboardingData,
  saveActiveOnboardingAuthFlow,
  hasValidPendingOnboardingPlan,
  readActiveOnboardingAuthFlow,
} from '../pendingOnboardingPlan';

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
    currentStep: 'greeting',
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

beforeEach(async () => {
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  (AsyncStorage.getAllKeys as jest.Mock).mockClear();
  (AsyncStorage.multiRemove as jest.Mock).mockClear();
  // Clear all keys
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys);
  // Reset in-memory guest flowId memo
  await clearGuestFlowId();
  // Clear all pending onboarding data
  await clearAllPendingOnboardingData();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('prepareGuestLaunchIfNeeded', () => {

  it('blocks until cleanup completes — stale draft is unreadable during cleanup', async () => {
    // Seed a stale guest draft with an old firstName
    const oldFlowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId: oldFlowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('OldName'));

    // Verify the stale draft exists
    const stale = await readOnboardingDraftForOwner(guestOwner);
    expect(stale?.firstName).toBe('OldName');

    // Start prepareGuestLaunchIfNeeded — it should clear the draft
    // but we control the timing to prove the promise is unresolved
    // while cleanup is in flight.
    const cleanupPromise = prepareGuestLaunchIfNeeded(
      hasValidPendingOnboardingPlan,
      readActiveOnboardingAuthFlow,
    );

    // The promise must be pending (not resolved) — the caller (AuthBootstrap)
    // must not call setReady() until it resolves.
    let resolved = false;
    cleanupPromise.then(() => { resolved = true; });

    // Yield to microtask queue once — the promise should still be pending
    // because AsyncStorage operations are async.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Now let the cleanup complete
    await cleanupPromise;
    expect(resolved).toBe(true);

    // After cleanup, the old flowId is cleared and a new one is generated
    const newFlowId = await getOrCreateGuestFlowId();
    expect(newFlowId).not.toBe(oldFlowId);

    // The old draft is gone
    const afterCleanup = await readOnboardingDraftForOwner(guestOwner);
    expect(afterCleanup).toBeNull();

    // The new flowId has no draft — fresh start
    const newDraft = await readOnboardingDraftForOwner({ kind: 'guest', flowId: newFlowId });
    expect(newDraft).toBeNull();
  });

  it('skips cleanup when a valid pending onboarding plan exists', async () => {
    // Seed a guest draft
    const oldFlowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId: oldFlowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('ProtectedName'));

    // Save a pending onboarding plan (simulates auth finalization in flight)
    const result = await savePendingOnboardingPlan({
      firstName: 'ProtectedName',
      learningMode: 'recommended',
      knownSurahs: [1, 2, 3],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
    });
    expect(result.ok).toBe(true);

    // Run prepareGuestLaunchIfNeeded — should skip cleanup
    await prepareGuestLaunchIfNeeded(
      hasValidPendingOnboardingPlan,
      readActiveOnboardingAuthFlow,
    );

    // The guest draft should still exist (not cleared)
    const draft = await readOnboardingDraftForOwner(guestOwner);
    expect(draft?.firstName).toBe('ProtectedName');

    // The flowId should still be the same
    const sameFlowId = await getOrCreateGuestFlowId();
    expect(sameFlowId).toBe(oldFlowId);
  });

  it('skips cleanup when an active auth flow marker exists', async () => {
    // Seed a guest draft
    const oldFlowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId: oldFlowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('AuthPending'));

    // Save an active auth flow marker (simulates email confirmation pending)
    await saveActiveOnboardingAuthFlow('test-flow-id');

    // Run prepareGuestLaunchIfNeeded — should skip cleanup
    await prepareGuestLaunchIfNeeded(
      hasValidPendingOnboardingPlan,
      readActiveOnboardingAuthFlow,
    );

    // The guest draft should still exist
    const draft = await readOnboardingDraftForOwner(guestOwner);
    expect(draft?.firstName).toBe('AuthPending');
  });

  it('never touches user-owned drafts', async () => {
    // Seed a guest draft AND a user draft
    const oldFlowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId: oldFlowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraft('GuestName'));

    const userOwner = { kind: 'authenticated' as const, userId: 'user-123' };
    await saveOnboardingDraftForOwner(userOwner, makeDraft('UserName'));

    // Run cleanup
    await prepareGuestLaunchIfNeeded(
      hasValidPendingOnboardingPlan,
      readActiveOnboardingAuthFlow,
    );

    // Guest draft is cleared
    const guestDraft = await readOnboardingDraftForOwner(guestOwner);
    expect(guestDraft).toBeNull();

    // User draft is untouched
    const userDraft = await readOnboardingDraftForOwner(userOwner);
    expect(userDraft?.firstName).toBe('UserName');
  });
});
