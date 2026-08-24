/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  savePendingOnboardingPlan,
  readPendingOnboardingPlan,
  clearAuthHandoff,
  clearAllPendingOnboardingData,
  hasValidPendingOnboardingPlan,
  hasValidPendingOnboardingPlanForUser,
  claimPendingOnboardingPlanForUser,
  readOwnedPendingOnboardingPlanForUser,
  readAuthHandoff,
  saveActiveOnboardingAuthFlow,
  readActiveOnboardingAuthFlow,
  clearActiveOnboardingAuthFlow,
  setSessionAuthFlowId,
  getSessionAuthFlowId,
  clearSessionAuthFlowId,
  type PendingPlanInput,
} from '../pendingOnboardingPlan';
import {
  acceptResultForUser,
  createInitialPreparationState,
  createPreparingState,
  createReadyState,
  createErrorState,
  canRenderStackForUser,
  shouldShowCustomSplash,
  shouldShowPreparationError,
} from '../preparationStateMachine';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
      setItem: jest.fn((key: string, value: string) => {
        store[key] = value;
        return Promise.resolve();
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
        return Promise.resolve();
      }),
      multiRemove: jest.fn((keys: string[]) => {
        for (const k of keys) delete store[k];
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = {};
        return Promise.resolve();
      }),
      getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
    },
  };
});

const validInput: PendingPlanInput = {
  firstName: 'Test',
  learningMode: 'recommended',
  knownSurahs: [1, 2],
  startingSurah: null,
  customSurahOrder: [],
  continueWithRest: true,
  notificationPreference: 'enabled',  ownerUserId: null,
};

// ─── Multi-account preparation state machine tests ──────────────────────────

describe('acceptResultForUser', () => {
  it('accepts when generation and userId match', () => {
    expect(acceptResultForUser(1, 1, 'user-A', 'user-A')).toBe(true);
  });

  it('rejects when generation differs (retry or account switch)', () => {
    expect(acceptResultForUser(1, 2, 'user-A', 'user-A')).toBe(false);
  });

  it('rejects when userId differs (account switch A→B)', () => {
    expect(acceptResultForUser(1, 1, 'user-A', 'user-B')).toBe(false);
  });

  it('rejects when currentUserId is null (logout)', () => {
    expect(acceptResultForUser(1, 1, 'user-A', null)).toBe(false);
  });

  it('rejects when both generation and userId differ', () => {
    expect(acceptResultForUser(1, 2, 'user-A', 'user-B')).toBe(false);
  });
});

describe('canRenderStackForUser', () => {
  it('returns false when initialVisualReleased is false and user is authed', () => {
    expect(canRenderStackForUser(false, true, true, createReadyState('user-A'), 'user-A')).toBe(false);
  });

  it('returns true for guest even when initialVisualReleased is false', () => {
    expect(canRenderStackForUser(false, true, false, createInitialPreparationState(), null)).toBe(true);
  });

  it('returns false when authReady is false', () => {
    expect(canRenderStackForUser(true, false, true, createReadyState('user-A'), 'user-A')).toBe(false);
  });

  it('returns true for guest (not authed)', () => {
    expect(canRenderStackForUser(true, true, false, createInitialPreparationState(), null)).toBe(true);
  });

  it('returns true for authed user with ready preparation matching userId', () => {
    expect(canRenderStackForUser(true, true, true, createReadyState('user-A'), 'user-A')).toBe(true);
  });

  it('returns false for authed user with preparing status', () => {
    expect(canRenderStackForUser(true, true, true, createPreparingState('user-A'), 'user-A')).toBe(false);
  });

  it('returns false for authed user with error status', () => {
    expect(canRenderStackForUser(true, true, true, createErrorState('user-A', 'timeout'), 'user-A')).toBe(false);
  });

  it('returns false when preparation userId does not match current userId', () => {
    expect(canRenderStackForUser(true, true, true, createReadyState('user-A'), 'user-B')).toBe(false);
  });

  it('returns false when preparation userId is null but user is authed', () => {
    expect(canRenderStackForUser(true, true, true, createInitialPreparationState(), 'user-A')).toBe(false);
  });
});

describe('shouldShowCustomSplash', () => {
  it('returns false during resolving (not ready)', () => {
    expect(shouldShowCustomSplash(false, false, false, false, false)).toBe(false);
  });

  it('returns false for guest (unauthenticated)', () => {
    expect(shouldShowCustomSplash(false, true, false, true, false)).toBe(false);
  });

  it('returns false for guest even when canRender is false', () => {
    expect(shouldShowCustomSplash(false, true, false, false, false)).toBe(false);
  });

  it('returns true for authed user during initial boot, not yet ready to render', () => {
    expect(shouldShowCustomSplash(false, true, true, false, false)).toBe(true);
  });

  it('returns false for authed user once stack can render', () => {
    expect(shouldShowCustomSplash(false, true, true, true, false)).toBe(false);
  });

  it('returns false after boot completes even if authed and not ready to render', () => {
    expect(shouldShowCustomSplash(true, true, true, false, false)).toBe(false);
  });

  it('returns false when preparation error should be shown instead', () => {
    expect(shouldShowCustomSplash(false, true, true, false, true)).toBe(false);
  });

  it('returns false after boot completes with preparation error', () => {
    expect(shouldShowCustomSplash(true, true, true, false, true)).toBe(false);
  });
});

describe('shouldShowPreparationError', () => {
  it('returns true for authed user with error matching userId', () => {
    expect(shouldShowPreparationError(true, createErrorState('user-A', 'timeout'), 'user-A')).toBe(true);
  });

  it('returns false for guest', () => {
    expect(shouldShowPreparationError(false, createErrorState('user-A', 'timeout'), 'user-A')).toBe(false);
  });

  it('returns false when userId does not match', () => {
    expect(shouldShowPreparationError(true, createErrorState('user-A', 'timeout'), 'user-B')).toBe(false);
  });

  it('returns false when status is ready', () => {
    expect(shouldShowPreparationError(true, createReadyState('user-A'), 'user-A')).toBe(false);
  });

  it('returns false when status is preparing', () => {
    expect(shouldShowPreparationError(true, createPreparingState('user-A'), 'user-A')).toBe(false);
  });
});

// ─── Pending onboarding plan ownership tests ────────────────────────────────

describe('hasValidPendingOnboardingPlanForUser', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns true for unclaimed payload with matching handoff', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(true);
  });

  it('returns false for legacy payload without flowId and clears it', async () => {
    // Simulate a legacy payload without flowId field
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      firstName: 'Test',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',      ownerUserId: null,
    };
    await AsyncStorage.setItem('zainly:onboardingV2:pendingPlan', JSON.stringify(payload));
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
    // Payload should have been cleared
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('returns false after claim because handoff is consumed', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Claim it for user-A — this consumes the handoff
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // After claim, handoff is gone, so hasValid returns false
    // even though the payload is owned by user-A
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
    // But the payload still exists and is owned by user-A
    const pending = await readPendingOnboardingPlan();
    expect(pending?.ownerUserId).toBe('user-A');
  });

  it('returns false and clears payload when ownerUserId is different user', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Claim for user-A
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // user-B checks — should be false and payload cleared
    expect(await hasValidPendingOnboardingPlanForUser('user-B')).toBe(false);
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('returns false when no payload exists', async () => {
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
  });

  it('returns false for expired payload regardless of ownerUserId', async () => {
    const expiredPayload = {
      version: 1,
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
      firstName: 'Test',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',      ownerUserId: null,
      flowId: 'test-flow-id',
    };
    await AsyncStorage.setItem('zainly:onboardingV2:pendingPlan', JSON.stringify(expiredPayload));
    const handoff = {
      version: 1,
      flowId: 'test-flow-id',
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify(handoff));
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
  });

  it('returns false when handoff is missing', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    // Clear the handoff that savePendingOnboardingPlan wrote
    await clearAuthHandoff();
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
    // Payload should NOT be cleared — handoff may arrive later
    expect(await readPendingOnboardingPlan()).not.toBeNull();
  });

  it('returns false when handoff flowId does not match payload flowId', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    // Overwrite handoff with a different flowId
    const handoff = {
      version: 1,
      flowId: 'different-flow-id',
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify(handoff));
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
  });
});

// ─── Pending payload lifecycle: save → claim → clear ────────────────────────

describe('Pending payload ownership lifecycle', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('pre-auth payload is claimable by any user until claimed', async () => {
    // 1. Create payload pre-auth (ownerUserId null)
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    expect(await hasValidPendingOnboardingPlan()).toBe(true);

    // 2. User A can see it (handoff matches)
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(true);

    // 3. User B can also see it (still unclaimed, handoff matches)
    expect(await hasValidPendingOnboardingPlanForUser('user-B')).toBe(true);
  });

  it('after clearAllPendingOnboardingData, no user can claim the payload', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    await clearAllPendingOnboardingData();
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
    expect(await hasValidPendingOnboardingPlanForUser('user-B')).toBe(false);
  });

  it('payload claimed by A is inaccessible to B after A→B switch without logout', async () => {
    // Simulate: A creates and claims, then B logs in without explicit logout
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);

    // B checks — should be false and payload cleared
    expect(await hasValidPendingOnboardingPlanForUser('user-B')).toBe(false);
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('claim writes ownerUserId and consumes handoff', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-A');
    // Handoff should be consumed
    expect(await readAuthHandoff()).toBeNull();
  });

  it('claim fails if handoff is missing', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await clearAuthHandoff();
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).toBeNull();
  });

  it('claim fails if handoff flowId does not match', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Overwrite handoff with different flowId
    const handoff = {
      version: 1,
      flowId: 'wrong-flow',
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify(handoff));
    // authFlowId matches payload but handoff has wrong flowId — claim fails
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).toBeNull();
  });

  it('claim fails for legacy payload without flowId and clears it', async () => {
    const legacyPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      firstName: 'Test',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',      ownerUserId: null,
    };
    await AsyncStorage.setItem('zainly:onboardingV2:pendingPlan', JSON.stringify(legacyPayload));
    // Legacy payload has no flowId — any authFlowId is irrelevant, claim cleared
    const claimed = await claimPendingOnboardingPlanForUser('user-A', 'any-flow-id');
    expect(claimed).toBeNull();
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('claim fails if payload is owned by a different user', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // Re-create handoff since claim consumed it
    const pending = await readPendingOnboardingPlan();
    const handoff = {
      version: 1,
      flowId: pending?.flowId,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify(handoff));
    // user-B tries to claim — should fail and clear
    const claimed = await claimPendingOnboardingPlanForUser('user-B', saved.flowId);
    expect(claimed).toBeNull();
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('claim is idempotent for same user', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const first = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(first).not.toBeNull();
    // Second claim for same user — handoff is already consumed
    const second = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // Handoff is gone, so claim fails — but payload is still owned by A
    expect(second).toBeNull();
    // Payload still exists and is owned by A
    const pending = await readPendingOnboardingPlan();
    expect(pending?.ownerUserId).toBe('user-A');
  });

  it('savePendingOnboardingPlan writes both payload and handoff with same flowId', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    const pending = await readPendingOnboardingPlan();
    const handoff = await readAuthHandoff();
    expect(pending?.flowId).toBeTruthy();
    expect(handoff?.flowId).toBeTruthy();
    expect(pending?.flowId).toBe(handoff?.flowId);
  });

  it('clearAllPendingOnboardingData clears both payload and handoff', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    await clearAllPendingOnboardingData();
    expect(await readPendingOnboardingPlan()).toBeNull();
    expect(await readAuthHandoff()).toBeNull();
  });

  it('expired handoff is rejected and cleared', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    // Overwrite handoff with expired createdAt
    const pending = await readPendingOnboardingPlan();
    const expiredHandoff = {
      version: 1,
      flowId: pending?.flowId,
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
    };
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify(expiredHandoff));
    expect(await readAuthHandoff()).toBeNull();
    expect(await hasValidPendingOnboardingPlanForUser('user-A')).toBe(false);
  });
});

// ─── Preparation state machine: generation scenarios ────────────────────────

describe('Preparation generation scenarios', () => {
  it('generation 1 result is rejected when generation has advanced to 2', () => {
    // Simulate: preparation starts (gen 1), retry triggers (gen 2),
    // gen 1 completes late — must be rejected
    expect(acceptResultForUser(1, 2, 'user-A', 'user-A')).toBe(false);
  });

  it('generation 1 result is accepted when no retry or switch occurred', () => {
    expect(acceptResultForUser(1, 1, 'user-A', 'user-A')).toBe(true);
  });

  it('A→B switch: gen 1 for A is rejected when current user is B', () => {
    expect(acceptResultForUser(1, 2, 'user-A', 'user-B')).toBe(false);
  });

  it('B preparation gen 2 is accepted for B', () => {
    expect(acceptResultForUser(2, 2, 'user-B', 'user-B')).toBe(true);
  });

  it('timeout from gen 1 is rejected after retry to gen 2', () => {
    // Timeout fires for gen 1, but gen 2 is now active
    expect(acceptResultForUser(1, 2, 'user-A', 'user-A')).toBe(false);
  });

  it('error from gen 1 does not place gen 2 in error', () => {
    const startGen = 1;
    const currentGen = 2;
    // The error result from gen 1 should be rejected
    expect(acceptResultForUser(startGen, currentGen, 'user-A', 'user-A')).toBe(false);
  });

  it('A→B→A: gen 1 for A rejected, gen 2 for B rejected, gen 3 for A accepted', () => {
    // A starts (gen 1), B starts (gen 2, A cleanup), A starts again (gen 3, B cleanup)
    // gen 1 late result: generation 1 ≠ 3 → rejected
    expect(acceptResultForUser(1, 3, 'user-A', 'user-A')).toBe(false);
    // gen 2 late result: generation 2 ≠ 3 → rejected
    expect(acceptResultForUser(2, 3, 'user-B', 'user-B')).toBe(false);
    // gen 3 result: generation 3 === 3, userId A === A → accepted
    expect(acceptResultForUser(3, 3, 'user-A', 'user-A')).toBe(true);
  });
});

// ─── Auth flow claims: explicit authFlowId requirement ───────────────────────

describe('Auth flow claims with explicit authFlowId', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('1. Onboarding V2 signup with correct authFlowId → claim accepted', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Simulate: signup-email sets sessionAuthFlowId after receiving flowId from params
    setSessionAuthFlowId(saved.flowId);
    const authFlowId = getSessionAuthFlowId();
    const claimed = await claimPendingOnboardingPlanForUser('user-A', authFlowId);
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-A');
    expect(claimed?.flowId).toBe(saved.flowId);
  });

  it('2. Onboarding V2 login with correct authFlowId → claim accepted', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Simulate: login-email sets sessionAuthFlowId
    setSessionAuthFlowId(saved.flowId);
    const claimed = await claimPendingOnboardingPlanForUser('user-B', getSessionAuthFlowId());
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-B');
  });

  it('3. Welcome login (empty authFlowId) → claim rejected', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Welcome login never calls setSessionAuthFlowId → authFlowId is ''
    const claimed = await claimPendingOnboardingPlanForUser('user-B', '');
    expect(claimed).toBeNull();
    // Payload still exists (not cleared on authFlowId mismatch)
    expect(await readPendingOnboardingPlan()).not.toBeNull();
  });

  it('4. Wrong authFlowId → claim rejected', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const claimed = await claimPendingOnboardingPlanForUser('user-A', 'completely-wrong-id');
    expect(claimed).toBeNull();
  });

  it('5. Handoff present but authFlowId empty (no onboarding route visited) → claim rejected', async () => {
    // Payload + handoff exist (left from a previous session on same device)
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // sessionAuthFlowId was never set (Welcome login or cold start without re-entry)
    const authFlowId = getSessionAuthFlowId(); // ''
    expect(authFlowId).toBe('');
    const claimed = await claimPendingOnboardingPlanForUser('user-A', authFlowId);
    expect(claimed).toBeNull();
  });

  it('6. Explicit onboarding V2 cold-start resumption with same flowId → claim accepted', async () => {
    // Simulate cold start: payload + handoff already in storage, user re-enters auth flow
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // login-email reads flowId from stored handoff (cold-start resumption path)
    const handoff = await readAuthHandoff();
    const resolvedFlowId = handoff?.flowId ?? '';
    setSessionAuthFlowId(resolvedFlowId);
    const claimed = await claimPendingOnboardingPlanForUser('user-A', getSessionAuthFlowId());
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-A');
  });

  it('7. Abandoned flow: different authFlowId later → claim rejected', async () => {
    // User A did onboarding (flowId=X), abandoned, came back and started a new
    // onboarding (flowId=Y), but old payload still has flowId=X.
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // New session has a different flowId (from a new program-summary save)
    setSessionAuthFlowId('different-new-flow-id');
    const claimed = await claimPendingOnboardingPlanForUser('user-A', getSessionAuthFlowId());
    expect(claimed).toBeNull();
  });
});

// ─── Claim serializer: concurrency scenarios ────────────────────────────────

describe('Claim serializer: concurrency', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('8. Two simultaneous claims, same flowId → only one succeeds', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const flowId = saved.flowId;
    // Fire two concurrent claims for the same flowId — only one should win
    const [r1, r2] = await Promise.all([
      claimPendingOnboardingPlanForUser('user-A', flowId),
      claimPendingOnboardingPlanForUser('user-A', flowId),
    ]);
    const successes = [r1, r2].filter(Boolean).length;
    expect(successes).toBe(1);
  });

  it('9. Two simultaneous claims, different users → never two owners', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const flowId = saved.flowId;
    const [r1, r2] = await Promise.all([
      claimPendingOnboardingPlanForUser('user-A', flowId),
      claimPendingOnboardingPlanForUser('user-B', flowId),
    ]);
    // Serializer ensures they run sequentially: exactly one succeeds, one fails.
    // The loser (different-user rejection) clears the payload — that is correct.
    const successes = [r1, r2].filter(Boolean);
    expect(successes.length).toBeLessThanOrEqual(1);
    // The returned claimed payload carries the correct ownerUserId
    if (r1) expect(r1.ownerUserId).toBe('user-A');
    if (r2) expect(r2.ownerUserId).toBe('user-B');
    // r1 and r2 must not both be non-null (no double-claim)
    expect(r1 !== null && r2 !== null).toBe(false);
  });

  it('10. Rejected claim does not block subsequent claims in chain', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const flowId = saved.flowId;
    // Bad claim (wrong flowId) must not deadlock the serializer
    const bad = claimPendingOnboardingPlanForUser('user-X', 'wrong');
    // Good claim queued right after
    const good = claimPendingOnboardingPlanForUser('user-A', flowId);
    const [r1, r2] = await Promise.all([bad, good]);
    expect(r1).toBeNull();
    expect(r2).not.toBeNull();
  });
});

// ─── Session auth flow ID: lifecycle ────────────────────────────────────────

describe('Session auth flow ID lifecycle', () => {
  beforeEach(() => {
    clearSessionAuthFlowId();
  });

  it('11. setSessionAuthFlowId / getSessionAuthFlowId round-trip', () => {
    setSessionAuthFlowId('test-flow-abc');
    expect(getSessionAuthFlowId()).toBe('test-flow-abc');
  });

  it('12. clearSessionAuthFlowId resets to empty string', () => {
    setSessionAuthFlowId('flow-to-clear');
    clearSessionAuthFlowId();
    expect(getSessionAuthFlowId()).toBe('');
  });

  it('13. clearAllPendingOnboardingData clears sessionAuthFlowId and activeAuthFlow', async () => {
    setSessionAuthFlowId('flow-to-clear-all');
    await saveActiveOnboardingAuthFlow('flow-to-clear-all');
    await clearAllPendingOnboardingData();
    expect(getSessionAuthFlowId()).toBe('');
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('14. getSessionAuthFlowId returns empty string by default', () => {
    expect(getSessionAuthFlowId()).toBe('');
  });

  it('15. setSessionAuthFlowId overwrites previous value', () => {
    setSessionAuthFlowId('first');
    setSessionAuthFlowId('second');
    expect(getSessionAuthFlowId()).toBe('second');
  });
});

// ─── Cross-account protection ────────────────────────────────────────────────

describe('Cross-account protection', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('16. savePendingOnboardingPlan returns flowId on success', async () => {
    const result = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.flowId).toBe('string');
    expect(result.flowId.length).toBeGreaterThan(0);
  });

  it('17. Claim with correct authFlowId but missing handoff → rejected', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await clearAuthHandoff();
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).toBeNull();
    // Payload not cleared — handoff may arrive later
    expect(await readPendingOnboardingPlan()).not.toBeNull();
  });

  it('18. Claim with correct authFlowId but handoff has different flowId → rejected', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Tamper with handoff
    await AsyncStorage.setItem('zainly:onboardingV2:authHandoff', JSON.stringify({
      version: 1, flowId: 'tampered', createdAt: new Date().toISOString(),
    }));
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).toBeNull();
  });

  it('19. After successful claim, sessionAuthFlowId should be cleared by caller', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    setSessionAuthFlowId(saved.flowId);
    const claimed = await claimPendingOnboardingPlanForUser('user-A', getSessionAuthFlowId());
    expect(claimed).not.toBeNull();
    // Caller (useOnboardingV2AuthFinalize) clears sessionAuthFlowId after success
    clearSessionAuthFlowId();
    expect(getSessionAuthFlowId()).toBe('');
  });

  it('20. Three concurrent claims — serializer ensures ordered execution', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    const flowId = saved.flowId;
    const [r1, r2, r3] = await Promise.all([
      claimPendingOnboardingPlanForUser('user-A', flowId),
      claimPendingOnboardingPlanForUser('user-B', 'wrong'),
      claimPendingOnboardingPlanForUser('user-C', flowId),
    ]);
    // Only one can claim — user-A or user-C (whichever runs first in chain)
    const successes = [r1, r2, r3].filter(Boolean);
    expect(successes.length).toBeLessThanOrEqual(1);
    // r2 must always be null (wrong flowId)
    expect(r2).toBeNull();
  });
});

// ─── ActiveOnboardingAuthFlow: persistent cold-start marker ─────────────────

describe('ActiveOnboardingAuthFlow persistent marker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('A1. saveActiveOnboardingAuthFlow persists to storage', async () => {
    await saveActiveOnboardingAuthFlow('flow-persist-1');
    const stored = await readActiveOnboardingAuthFlow();
    expect(stored).not.toBeNull();
    expect(stored?.flowId).toBe('flow-persist-1');
    expect(stored?.source).toBe('onboarding-v2');
    expect(stored?.version).toBe(1);
  });

  it('A2. readActiveOnboardingAuthFlow returns null when absent', async () => {
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('A3. clearActiveOnboardingAuthFlow removes the marker', async () => {
    await saveActiveOnboardingAuthFlow('flow-to-clear');
    await clearActiveOnboardingAuthFlow();
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('A4. expired activeAuthFlow is rejected and cleared automatically', async () => {
    const expired = {
      version: 1,
      flowId: 'expired-flow',
      createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
      source: 'onboarding-v2',
    };
    await AsyncStorage.setItem('zainly:onboardingV2:activeAuthFlow', JSON.stringify(expired));
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('A5. corrupted activeAuthFlow is rejected silently', async () => {
    await AsyncStorage.setItem('zainly:onboardingV2:activeAuthFlow', '{not-valid-json');
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('A6. wrong source field is rejected', async () => {
    const bad = {
      version: 1, flowId: 'flow-x', createdAt: new Date().toISOString(), source: 'other',
    };
    await AsyncStorage.setItem('zainly:onboardingV2:activeAuthFlow', JSON.stringify(bad));
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });
});

// ─── Cold-start / flow resumption tests (required 1–10) ─────────────────────

describe('Cold-start and flow resumption', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('T1. Auth success → claim → simulate process reset → payload owned and recoverable', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Claim succeeds (simulates auth success)
    const claimed = await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    expect(claimed).not.toBeNull();
    // Simulate process reset: session var cleared (module reloaded in real app)
    clearSessionAuthFlowId();
    // Cold-start resume: payload already owned, no authFlowId needed
    const resumed = await readOwnedPendingOnboardingPlanForUser('user-A');
    expect(resumed).not.toBeNull();
    expect(resumed?.ownerUserId).toBe('user-A');
  });

  it('T2. Cold start with valid activeAuthFlow → claim succeeds without explicit authFlowId param', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Simulate: program-summary persisted activeAuthFlow before app kill
    await saveActiveOnboardingAuthFlow(saved.flowId);
    // Simulate cold start: no in-memory sessionAuthFlowId, no route param (empty string)
    const claimed = await claimPendingOnboardingPlanForUser('user-A', '');
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-A');
  });

  it('T3. Cold start without activeAuthFlow → unclaimed payload cannot be claimed', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // No activeAuthFlow, no sessionAuthFlowId, no param
    const claimed = await claimPendingOnboardingPlanForUser('user-A', '');
    expect(claimed).toBeNull();
  });

  it('T4. Welcome login does not consume pending payload (no authFlowId proof)', async () => {
    // Payload from a previous onboarding session
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // welcome.tsx clears activeAuthFlow before going to login-methods
    await clearActiveOnboardingAuthFlow();
    clearSessionAuthFlowId();
    // Welcome login → authFlowId is '' (no context=onboarding in route)
    const claimed = await claimPendingOnboardingPlanForUser('user-B', '');
    expect(claimed).toBeNull();
    // Payload still intact
    expect(await readPendingOnboardingPlan()).not.toBeNull();
  });

  it('T5. Abandon toward Welcome clears activeAuthFlow so subsequent Welcome login is isolated', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await saveActiveOnboardingAuthFlow(saved.flowId);
    // User navigates back to Welcome → welcome.tsx clears activeAuthFlow
    await clearActiveOnboardingAuthFlow();
    clearSessionAuthFlowId();
    // Welcome login cannot claim
    const claimed = await claimPendingOnboardingPlanForUser('user-B', '');
    expect(claimed).toBeNull();
    // activeAuthFlow gone
    expect(await readActiveOnboardingAuthFlow()).toBeNull();
  });

  it('T6. Apple/Google from onboarding: activeAuthFlow persisted → claim succeeds after callback', async () => {
    // Simulate: program-summary saves payload + activeAuthFlow (Apple/Google path)
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await saveActiveOnboardingAuthFlow(saved.flowId);
    // Callback arrives: app relaunched, no route params, sessionAuthFlowId empty
    clearSessionAuthFlowId();
    // claim resolves via stored activeAuthFlow
    const claimed = await claimPendingOnboardingPlanForUser('user-apple', '');
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-apple');
  });

  it('T7. Google from onboarding: same as Apple — activeAuthFlow sufficient', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await saveActiveOnboardingAuthFlow(saved.flowId);
    clearSessionAuthFlowId();
    const claimed = await claimPendingOnboardingPlanForUser('user-google', '');
    expect(claimed).not.toBeNull();
    expect(claimed?.flowId).toBe(saved.flowId);
  });

  it('T8. Email confirmation delayed: sessionAuthFlowId gone after kill but activeAuthFlow survives', async () => {
    // User signed up, email not confirmed yet, app killed
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await saveActiveOnboardingAuthFlow(saved.flowId);
    // App killed — sessionAuthFlowId lost
    clearSessionAuthFlowId();
    // User re-opens app and email is confirmed in the background → session arrives
    // claim via activeAuthFlow
    const claimed = await claimPendingOnboardingPlanForUser('user-confirm', '');
    expect(claimed).not.toBeNull();
    expect(claimed?.ownerUserId).toBe('user-confirm');
  });

  it('T9. Payload already owned can be finalized after cold start without claim', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    // Claim in session 1
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // Cold start: sessionAuthFlowId gone, activeAuthFlow consumed by claim
    clearSessionAuthFlowId();
    // readOwned works without any flowId
    const owned = await readOwnedPendingOnboardingPlanForUser('user-A');
    expect(owned).not.toBeNull();
    expect(owned?.ownerUserId).toBe('user-A');
    // readOwned rejects unclaimed
    const ownedB = await readOwnedPendingOnboardingPlanForUser('user-B');
    expect(ownedB).toBeNull();
  });

  it('T10. Payload owned by A is refused for B (clears payload)', async () => {
    // Manually write an owned payload for user-A
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    // user-B tries readOwned → rejected and payload cleared
    const ownedB = await readOwnedPendingOnboardingPlanForUser('user-B');
    expect(ownedB).toBeNull();
    expect(await readPendingOnboardingPlan()).toBeNull();
  });
});

// ─── readOwnedPendingOnboardingPlanForUser ───────────────────────────────────

describe('readOwnedPendingOnboardingPlanForUser', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionAuthFlowId();
  });

  it('R1. returns null when no payload exists', async () => {
    expect(await readOwnedPendingOnboardingPlanForUser('user-A')).toBeNull();
  });

  it('R2. returns null for unclaimed payload (ownerUserId null)', async () => {
    await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    expect(await readOwnedPendingOnboardingPlanForUser('user-A')).toBeNull();
  });

  it('R3. returns payload for correct owner', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    const owned = await readOwnedPendingOnboardingPlanForUser('user-A');
    expect(owned).not.toBeNull();
    expect(owned?.ownerUserId).toBe('user-A');
  });

  it('R4. rejects and clears payload owned by different user', async () => {
    const saved = await savePendingOnboardingPlan({ ...validInput, ownerUserId: null });
    if (!saved.ok) throw new Error('save failed');
    await claimPendingOnboardingPlanForUser('user-A', saved.flowId);
    const owned = await readOwnedPendingOnboardingPlanForUser('user-B');
    expect(owned).toBeNull();
    expect(await readPendingOnboardingPlan()).toBeNull();
  });
});
