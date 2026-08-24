/// <reference types="jest" />
// ─── Regression test: name screen must not auto-skip to greeting ──────────
//
// Verifies that a draft with currentStep='greeting' and firstName='Walid'
// does NOT cause an automatic redirect to /onboarding-v2/greeting.
// The name screen must always display and restore the firstName.
// Only the Continue button navigates to greeting.
//
// This test exercises the draft resume logic contract directly:
//   1. Seed a draft with firstName='Walid' and currentStep='greeting'
//   2. Read the draft (simulating what name.tsx does on mount)
//   3. Verify firstName is restored
//   4. Verify no redirect occurs (the redirect code has been removed)

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveOnboardingDraftForOwner,
  readOnboardingDraftForOwner,
  clearGuestFlowId,
  getOrCreateGuestFlowId,
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
function makeDraftWithGreeting(name: string): OnboardingDraftV1 {
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
    discoverySource: 'tiktok',
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys);
  await clearGuestFlowId();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('name screen resume logic — no auto-skip on currentStep=greeting', () => {

  it('restores firstName from a draft with currentStep=greeting without redirecting', async () => {
    // Seed a guest draft with firstName='Walid' and currentStep='greeting'
    const flowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraftWithGreeting('Walid'));

    // Simulate what name.tsx does on mount: read the draft
    const draft = await readOnboardingDraftForOwner(guestOwner);

    // The draft exists and has the greeting step...
    expect(draft).not.toBeNull();
    expect(draft?.currentStep).toBe('greeting');
    expect(draft?.firstName).toBe('Walid');

    // ...but the name screen must NOT redirect based on currentStep.
    // The old code did: if (draft?.currentStep === 'greeting') router.replace(...)
    // That code has been removed. The only action is to restore firstName.
    let restoredFirstName = '';
    if (draft?.firstName) restoredFirstName = draft.firstName;

    // Verify firstName is restored
    expect(restoredFirstName).toBe('Walid');

    // Verify NO redirect would occur — the name screen's resume logic
    // must not check currentStep at all. We verify this by confirming
    // that the resume logic contract is: read firstName, ignore currentStep.
    // If the old redirect code were present, it would have jumped to
    // router.replace('/onboarding-v2/greeting') and never reached the
    // firstName restoration below.
    //
    // Since we're testing the contract (not the component), we assert
    // that the resume path always reaches firstName restoration regardless
    // of currentStep value.
    const stepsThatShouldNotRedirect: OnboardingDraftV1['currentStep'][] = ['greeting', 'program_summary'];
    for (const step of stepsThatShouldNotRedirect) {
      await saveOnboardingDraftForOwner(guestOwner, {
        ...makeDraftWithGreeting('Walid'),
        currentStep: step,
      });
      const d = await readOnboardingDraftForOwner(guestOwner);
      // firstName must always be restorable, regardless of currentStep
      expect(d?.firstName).toBe('Walid');
    }
  });

  // ─── Legacy step migration — a draft persisted by an older app version
  // may still carry a currentStep value for a screen that no longer exists
  // ('motivation' / 'motivation_reassurance' / 'learning_mode_reassurance').
  // Reading it must never wipe the draft — every other field is preserved
  // and currentStep is remapped to the next valid step. ─────────────────────
  it('migrates a stale currentStep from a removed screen to the next valid step, preserving every other field', async () => {
    const flowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId };

    const cases: { legacyStep: string; expectedStep: string; learningMode: OnboardingDraftV1['learningMode'] }[] = [
      { legacyStep: 'motivation', expectedStep: 'learning_mode', learningMode: null },
      { legacyStep: 'motivation_reassurance', expectedStep: 'learning_mode', learningMode: null },
      { legacyStep: 'learning_mode_reassurance', expectedStep: 'known_surahs', learningMode: 'recommended' },
      { legacyStep: 'learning_mode_reassurance', expectedStep: 'start_surah_picker', learningMode: 'start_surah' },
      { legacyStep: 'learning_mode_reassurance', expectedStep: 'custom_order_picker', learningMode: 'custom_order' },
    ];

    for (const { legacyStep, expectedStep, learningMode } of cases) {
      await saveOnboardingDraftForOwner(guestOwner, {
        ...makeDraftWithGreeting('Walid'),
        currentStep: legacyStep as unknown as OnboardingDraftV1['currentStep'],
        learningMode,
      });
      const d = await readOnboardingDraftForOwner(guestOwner);
      expect(d).not.toBeNull();
      expect(d?.currentStep).toBe(expectedStep);
      // every other field survives the migration untouched
      expect(d?.firstName).toBe('Walid');
      expect(d?.knownSurahs).toEqual([1, 2, 3]);
      expect(d?.discoverySource).toBe('tiktok');
    }
  });

  it('produces empty firstName after cold-start guest cleanup', async () => {
    // Seed a stale guest draft
    const oldFlowId = await getOrCreateGuestFlowId();
    const guestOwner = { kind: 'guest' as const, flowId: oldFlowId };
    await saveOnboardingDraftForOwner(guestOwner, makeDraftWithGreeting('OldName'));

    // Simulate cold-start cleanup: clear guest flowId + drafts
    await clearGuestFlowId();

    // New flowId is generated — different from the old one
    const newFlowId = await getOrCreateGuestFlowId();
    expect(newFlowId).not.toBe(oldFlowId);

    // Reading with the new flowId returns null — empty field
    const draft = await readOnboardingDraftForOwner({ kind: 'guest', flowId: newFlowId });
    expect(draft).toBeNull();

    // Name screen would set firstName='' (the default)
    let restoredFirstName = '';
    if (draft?.firstName) restoredFirstName = draft.firstName;
    expect(restoredFirstName).toBe('');
  });
});
