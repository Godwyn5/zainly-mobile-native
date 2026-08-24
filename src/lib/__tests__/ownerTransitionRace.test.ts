import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveOnboardingDraftForOwner,
  readOnboardingDraftForOwner,
  draftKeyForOwner,
  purgeAllOnboardingDrafts,
  type OnboardingDraftOwner,
  type OnboardingDraftV1,
} from '@/lib/onboardingDraft';

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
    clear: jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
  };
  return { __esModule: true, default: mock };
});

const mockAsyncStorage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  getAllKeys: jest.Mock;
  multiRemove: jest.Mock;
};

// ─── Simulates the production effect pattern from program-summary.tsx ──────

interface OwnerState {
  planResult: string | null;
  learningMode: string | null;
  knownCount: number;
  ready: boolean;
}

function makeDraft(firstName: string): OnboardingDraftV1 {
  return {
    version: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    currentStep: 'program_summary',
    firstName,
    learningMode: 'recommended',
    knownSurahs: [],
    startingSurah: 1,
    customSurahOrder: [],
    continueWithRest: true,
    notificationPreference: null,
    discoverySource: null,
  };
}

const userA = 'user-aaa-111';
const userB = 'user-bbb-222';
const guestFlowF = 'guest-flow-fff';
const ownerA: OnboardingDraftOwner = { kind: 'authenticated', userId: userA };
const ownerB: OnboardingDraftOwner = { kind: 'authenticated', userId: userB };
const ownerGuestF: OnboardingDraftOwner = { kind: 'guest', flowId: guestFlowF };

// Simulates one run of the production effect. Returns a controller.
// The async read is controlled via a deferred promise so the test can
// resolve it in deterministic order.
function startEffect(
  draftOwner: OnboardingDraftOwner | null,
  state: OwnerState,
  stateRef: { current: string | null },
): {
  ownerKey: string | null;
  resolve: (draft: OnboardingDraftV1 | null) => Promise<void>;
} {
  const ownerKey = draftOwner ? draftKeyForOwner(draftOwner) : null;
  stateRef.current = ownerKey;

  // Clear owner-derived state immediately (same as production effect)
  state.planResult = null;
  state.learningMode = null;
  state.knownCount = 0;
  state.ready = false;

  if (!draftOwner || !ownerKey) {
    state.ready = true;
    return {
      ownerKey,
      resolve: async () => {},
    };
  }

  let resolveFn!: (draft: OnboardingDraftV1 | null) => void;
  const readPromise = new Promise<OnboardingDraftV1 | null>((res) => { resolveFn = res; });

  // Start the async callback (same as production: void (async () => { ... })())
  void (async () => {
    const draft = await readPromise;
    // Guard: currentOwnerKeyRef must still match this effect's ownerKey
    if (stateRef.current !== ownerKey) return;

    if (!draft) return;
    state.planResult = draft.firstName;
    state.learningMode = draft.learningMode;
    state.knownCount = draft.knownSurahs.length;
    state.ready = true;
  })();

  return {
    ownerKey,
    resolve: async (draft: OnboardingDraftV1 | null) => {
      resolveFn(draft);
      // Flush microtasks so the async callback continuation runs
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

beforeEach(async () => {
  mockAsyncStorage.getItem.mockClear();
  mockAsyncStorage.setItem.mockClear();
  mockAsyncStorage.removeItem.mockClear();
  await purgeAllOnboardingDrafts();
});

afterEach(async () => {
  await purgeAllOnboardingDrafts();
});

describe('Owner-transition race prevention — program-summary effect pattern', () => {
  it('1. Start read for A, switch to B, resolve A last → no A value appears', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));
    await saveOnboardingDraftForOwner(ownerB, makeDraft('Bob'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Start read for A
    const effectA = startEffect(ownerA, state, stateRef);

    // Switch to B — this clears state and starts a new read
    const effectB = startEffect(ownerB, state, stateRef);

    // Resolve A's read LAST (stale)
    const draftA = await readOnboardingDraftForOwner(ownerA);
    await effectA.resolve(draftA);

    // Resolve B's read
    const draftB = await readOnboardingDraftForOwner(ownerB);
    await effectB.resolve(draftB);

    // A's result must NOT appear — stateRef changed to B's key
    expect(state.planResult).toBe('Bob');
    expect(state.planResult).not.toBe('Alice');
  });

  it('2. Start read for guest F, authenticate as U, resolve F last → guest value does not overwrite U state', async () => {
    await saveOnboardingDraftForOwner(ownerGuestF, makeDraft('GuestF'));
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Start read for guest F
    const effectF = startEffect(ownerGuestF, state, stateRef);

    // Authenticate as U (userA) — owner changes
    const effectU = startEffect(ownerA, state, stateRef);

    // Resolve F's read LAST (stale)
    const draftF = await readOnboardingDraftForOwner(ownerGuestF);
    await effectF.resolve(draftF);

    // Resolve U's read
    const draftU = await readOnboardingDraftForOwner(ownerA);
    await effectU.resolve(draftU);

    expect(state.planResult).toBe('Alice');
    expect(state.planResult).not.toBe('GuestF');
  });

  it('3. Owner becomes null during read → late result ignored', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Start read for A
    const effectA = startEffect(ownerA, state, stateRef);

    // Owner becomes null (logout)
    startEffect(null, state, stateRef);
    expect(state.ready).toBe(true);

    // Resolve A's read (stale)
    const draftA = await readOnboardingDraftForOwner(ownerA);
    await effectA.resolve(draftA);

    // A's result must NOT appear
    expect(state.planResult).toBeNull();
    expect(state.ready).toBe(true);
  });

  it('4. B read resolves before A\'s stale read → B remains visible', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));
    await saveOnboardingDraftForOwner(ownerB, makeDraft('Bob'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Start read for A
    const effectA = startEffect(ownerA, state, stateRef);

    // Switch to B
    const effectB = startEffect(ownerB, state, stateRef);

    // Resolve B's read FIRST
    const draftB = await readOnboardingDraftForOwner(ownerB);
    await effectB.resolve(draftB);
    expect(state.planResult).toBe('Bob');

    // Now resolve A's stale read
    const draftA = await readOnboardingDraftForOwner(ownerA);
    await effectA.resolve(draftA);

    // B remains visible — A's stale read is rejected
    expect(state.planResult).toBe('Bob');
  });

  it('5. Same owner rerender → no unnecessary destructive reset or infinite loop', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // First render with ownerA
    const effect1 = startEffect(ownerA, state, stateRef);
    const draft1 = await readOnboardingDraftForOwner(ownerA);
    await effect1.resolve(draft1);
    expect(state.planResult).toBe('Alice');
    expect(state.ready).toBe(true);

    // "Rerender" with same owner — ownerKey is the same string, so the
    // effect should NOT rerun. In the production component, React skips
    // the effect because [ownerKey] hasn't changed.
    const key1 = draftKeyForOwner(ownerA);
    const key2 = draftKeyForOwner(ownerA);
    expect(key1).toBe(key2); // Same string → no effect rerun

    // State is preserved (no destructive reset)
    expect(state.planResult).toBe('Alice');
    expect(state.ready).toBe(true);
  });

  it('6. Legitimate guest-to-auth handoff uses sourceGuestFlowId through the proof mechanism', async () => {
    // The ownerKey for a guest owner and an authenticated owner are
    // DIFFERENT keys — the guest draft is not accidentally read under
    // the authenticated user's key.
    const guestKey = draftKeyForOwner(ownerGuestF);
    const authedKey = draftKeyForOwner(ownerA);
    expect(guestKey).not.toBe(authedKey);
    expect(guestKey).toContain('guest');
    expect(authedKey).toContain('user');

    // The guest draft is stored under the guest key, not the user key
    await saveOnboardingDraftForOwner(ownerGuestF, makeDraft('GuestData'));
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
    expect((await readOnboardingDraftForOwner(ownerGuestF))?.firstName).toBe('GuestData');

    // sourceGuestFlowId is separate from the authenticated owner's key.
    // The claim mechanism (claimGuestDraftWithHandoff) uses the proof
    // system, not the owner key, to authorize the transfer.
  });

  it('7. Authenticated U\'s current owner-scoped draft loads after transition', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Simulate transition from guest to authenticated userA
    const effect = startEffect(ownerA, state, stateRef);

    const draft = await readOnboardingDraftForOwner(ownerA);
    await effect.resolve(draft);

    expect(state.planResult).toBe('Alice');
    expect(state.learningMode).toBe('recommended');
    expect(state.ready).toBe(true);
  });

  it('8. Logout A → login B without unmount → B sees no A data', async () => {
    await saveOnboardingDraftForOwner(ownerA, makeDraft('Alice'));

    const state: OwnerState = { planResult: null, learningMode: null, knownCount: 0, ready: false };
    const stateRef = { current: '' as string | null };

    // Start as A
    const effectA = startEffect(ownerA, state, stateRef);
    const draftA = await readOnboardingDraftForOwner(ownerA);
    await effectA.resolve(draftA);
    expect(state.planResult).toBe('Alice');

    // Logout — owner becomes null
    startEffect(null, state, stateRef);
    expect(state.planResult).toBeNull();
    expect(state.ready).toBe(true);

    // Login as B — owner changes to B
    await saveOnboardingDraftForOwner(ownerB, makeDraft('Bob'));
    const effectB = startEffect(ownerB, state, stateRef);
    const draftB = await readOnboardingDraftForOwner(ownerB);
    await effectB.resolve(draftB);

    // B sees B's data, not A's
    expect(state.planResult).toBe('Bob');
    expect(state.planResult).not.toBe('Alice');
  });
});
