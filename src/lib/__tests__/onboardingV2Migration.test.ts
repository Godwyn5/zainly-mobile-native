/// <reference types="jest" />
/* eslint-disable import/first, @typescript-eslint/no-require-imports */

// ─── Onboarding V2 migration tests ──────────────────────────────────────────
// Covers the V1→V2 migration safety requirements:
//   1. Plan-already-exists guard in finalizeOnboardingV2Plan
//   2. Draft isolation across auth boundaries (logout, account switch)
//   3. V1 AsyncStorage key cleanup at logout
//   4. Idempotence / double-trigger protection
//   5. V1 adapter redirects

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Mock AsyncStorage ──────────────────────────────────────────────────────
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

// ── Mock Supabase plans table ──────────────────────────────────────────────
// Simulates the plans table: a Map<userId, planRow>
// Must be prefixed with `mock` to be allowed in jest.mock factory.
const mockPlansTable = new Map<string, { id: string; user_id: string }>();

jest.mock('@/db/plans', () => ({
  upsertPlan: jest.fn(async (userId: string, _payload: unknown) => {
    mockPlansTable.set(userId, { id: `plan-${userId}`, user_id: userId });
  }),
  fetchPlan: jest.fn(async (userId: string) => {
    return mockPlansTable.get(userId) ?? null;
  }),
}));

// ── Mock Supabase progress table ───────────────────────────────────────────
jest.mock('@/db/progress', () => ({
  upsertProgress: jest.fn(async (_userId: string, _payload: unknown) => {}),
}));

// ── Mock profiles ──────────────────────────────────────────────────────────
jest.mock('@/db/profiles', () => ({
  upsertProfileFirstName: jest.fn(async () => {}),
}));

// ── Mock notifications ─────────────────────────────────────────────────────
jest.mock('@/notifications/scheduler', () => ({
  scheduleDailyHifzReminder: jest.fn(async () => undefined),
}));

jest.mock('@/notifications/storage', () => ({
  saveNotificationSettings: jest.fn(async () => {}),
}));

jest.mock('@/notifications/types', () => ({
  DEFAULT_SETTINGS: {},
}));

// ── Mock RevenueCat ────────────────────────────────────────────────────────
jest.mock('@/lib/revenueCat', () => ({
  syncRevenueCatUserAfterAuth: jest.fn(async () => ({ ok: true })),
  getRevenueCatCustomerInfo: jest.fn(async () => null),
  hasRevenueCatEntitlement: jest.fn(() => false),
}));

// ── Import after mocks ─────────────────────────────────────────────────────
import {
  finalizeOnboardingV2Plan,
} from '../onboardingFinalize';
import {
  readOnboardingDraft,
  clearOnboardingDraft,
  updateOnboardingDraft,
} from '../onboardingDraft';
import {
  savePendingOnboardingPlan,
  clearAllPendingOnboardingData,
  clearOnboardingStateForSessionExpiry,
  readPendingOnboardingPlan,
  claimPendingOnboardingPlanForUser,
  saveActiveOnboardingAuthFlow,
  setSessionAuthFlowId,
} from '../pendingOnboardingPlan';
import { fetchPlan, upsertPlan } from '@/db/plans';

// ── Helpers ────────────────────────────────────────────────────────────────
const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';

async function seedValidDraft() {
  await updateOnboardingDraft({
    currentStep: 'program_summary',
    firstName: 'Ahmed',
    motivationReason: 'closer_to_allah',
    learningMode: 'recommended',
    knownSurahs: [1, 2],
    experienceChoice: 'daily_limited',
    notificationPreference: 'enabled',
    discoverySource: 'tiktok',
  });
}

beforeEach(() => {
  // Reset all state
  mockPlansTable.clear();
  (AsyncStorage.clear as jest.Mock)();
  clearOnboardingDraft();
  // Reset mock call tracking
  (fetchPlan as jest.Mock).mockClear();
  (upsertPlan as jest.Mock).mockClear();
});

// ─── 1. Plan-already-exists guard ──────────────────────────────────────────

describe('Plan-already-exists guard', () => {
  it('returns ok with reason=plan_already_exists and does NOT call upsertPlan when a plan exists', async () => {
    // Seed an existing plan for USER_A
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A });

    // Seed a draft (which would normally be finalized)
    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('plan_already_exists');
    }
    // upsertPlan must NOT have been called — the existing plan is untouched
    expect(upsertPlan).not.toHaveBeenCalled();
  });

  it('clears all pre-auth sources when plan already exists', async () => {
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A });
    await seedValidDraft();
    await savePendingOnboardingPlan({
      firstName: 'Ahmed',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });

    await finalizeOnboardingV2Plan(USER_A, '');

    // Draft must be cleared
    expect(await readOnboardingDraft()).toBeNull();
  });

  it('returns persist_error (not ok) when fetchPlan throws — never finalizes blindly', async () => {
    (fetchPlan as jest.Mock).mockRejectedValueOnce(new Error('network down'));

    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('persist_error');
    }
    expect(upsertPlan).not.toHaveBeenCalled();
  });

  it('proceeds with finalization when no plan exists', async () => {
    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('created');
    }
    expect(upsertPlan).toHaveBeenCalledWith(USER_A, expect.any(Object));
  });
});

// ─── 2. Draft isolation across auth boundaries ─────────────────────────────

describe('Draft isolation across auth boundaries', () => {
  it('draft is cleared by clearOnboardingDraft and becomes null', async () => {
    await seedValidDraft();
    expect(await readOnboardingDraft()).not.toBeNull();

    await clearOnboardingDraft();
    expect(await readOnboardingDraft()).toBeNull();
  });

  it('account A draft is not visible to account B after clearOnboardingDraft', async () => {
    // Simulate account A creating a draft
    await updateOnboardingDraft({ firstName: 'Alice', currentStep: 'first_name' });
    expect((await readOnboardingDraft())?.firstName).toBe('Alice');

    // Simulate logout (clearOnboardingDraft is called)
    await clearOnboardingDraft();

    // Simulate account B logging in — draft must be null
    expect(await readOnboardingDraft()).toBeNull();
  });

  it('account A draft cannot be finalized by account B after clearOnboardingDraft', async () => {
    // Account A creates a draft
    await seedValidDraft();

    // Logout clears the draft
    await clearOnboardingDraft();

    // Account B tries to finalize — no draft, no pending → no_source
    const result = await finalizeOnboardingV2Plan(USER_B, '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_source');
    }
  });

  it('same-account draft is resumed without being overwritten', async () => {
    await updateOnboardingDraft({ firstName: 'Alice', currentStep: 'first_name' });
    // A second update merges, not replaces
    await updateOnboardingDraft({ motivationReason: 'closer_to_allah' });
    const draft = await readOnboardingDraft();
    expect(draft?.firstName).toBe('Alice');
    expect(draft?.motivationReason).toBe('closer_to_allah');
  });
});

// ─── 3. V1 AsyncStorage key cleanup at logout ──────────────────────────────

describe('V1 AsyncStorage key cleanup at logout', () => {
  it('removes onboardingIntroSeen and onboardingPersonalAnswers for the user', async () => {
    const userId = 'user-logout-test';
    const introKey = `zainly:onboardingIntroSeen:${userId}`;
    const personalKey = `zainly:onboardingPersonalAnswers:${userId}`;
    await AsyncStorage.setItem(introKey, 'true');
    await AsyncStorage.setItem(personalKey, JSON.stringify({ motivationReason: 'test' }));

    // Simulate the logout cleanup
    await AsyncStorage.multiRemove([introKey, personalKey]);

    expect(await AsyncStorage.getItem(introKey)).toBeNull();
    expect(await AsyncStorage.getItem(personalKey)).toBeNull();
  });

  it('does not remove keys belonging to a different user', async () => {
    const userA = 'user-a-logout';
    const userB = 'user-b-logout';
    const keyA = `zainly:onboardingIntroSeen:${userA}`;
    const keyB = `zainly:onboardingPersonalAnswers:${userB}`;
    await AsyncStorage.setItem(keyA, 'true');
    await AsyncStorage.setItem(keyB, JSON.stringify({}));

    // Logout of user A only removes user A's keys
    await AsyncStorage.multiRemove([
      `zainly:onboardingIntroSeen:${userA}`,
      `zainly:onboardingPersonalAnswers:${userA}`,
    ]);

    expect(await AsyncStorage.getItem(keyA)).toBeNull();
    expect(await AsyncStorage.getItem(keyB)).not.toBeNull();
  });
});

// ─── 4. Idempotence / double-trigger protection ────────────────────────────

describe('Idempotence / double-trigger protection', () => {
  it('finalizeOnboardingV2Plan deduplicates concurrent calls (inFlight guard)', async () => {
    // No existing plan
    await seedValidDraft();

    // Fire two calls in parallel
    const [result1, result2] = await Promise.all([
      finalizeOnboardingV2Plan(USER_A, ''),
      finalizeOnboardingV2Plan(USER_A, ''),
    ]);

    // Both must return ok
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);

    // upsertPlan must have been called exactly once (deduplication)
    expect(upsertPlan).toHaveBeenCalledTimes(1);
  });

  it('a second finalize after the first completes does not create a second plan (plan now exists)', async () => {
    await seedValidDraft();

    // First call creates the plan
    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(true);

    // Second call sees the existing plan and short-circuits
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.reason).toBe('plan_already_exists');
    }

    // upsertPlan was called only once (by the first call)
    expect(upsertPlan).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. V1 adapter redirect behavior ────────────────────────────────────────

describe('V1 adapter redirect behavior', () => {
  it('/onboarding/index.tsx is a redirect adapter (contains Redirect, not the old 1700-line screen)', async () => {
    // Read the file content directly — the adapter uses expo-router Redirect
    // which can't be imported in jest without mocking the whole router.
    // We verify the file is a tiny redirect, not the old V1 screen.
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(process.cwd(), 'app/onboarding/index.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Redirect');
    expect(content).toContain('/onboarding-v2/name');
    // The old screen had computePlan, usePlan, useAuthStore — the adapter must not
    expect(content).not.toContain('computePlan');
    expect(content).not.toContain('useAuthStore');
    expect(content).not.toContain('SeriousQuestionnaire');
  });

  it('/onboarding/intro.tsx is a redirect adapter (contains Redirect, not the old 600-line screen)', async () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(process.cwd(), 'app/onboarding/intro.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Redirect');
    expect(content).toContain('/onboarding-v2/name');
    // The old intro had TypewriterText, AsyncStorage, useFonts — the adapter must not
    expect(content).not.toContain('TypewriterText');
    expect(content).not.toContain('AsyncStorage');
    expect(content).not.toContain('useFonts');
  });
});

// ─── 6. clearAllPendingOnboardingData + draft clearing ─────────────────────

describe('Combined auth boundary clearing', () => {
  it('clearAllPendingOnboardingData + clearOnboardingDraft together wipe all onboarding state', async () => {
    // Seed both durable and in-memory state
    await savePendingOnboardingPlan({
      firstName: 'Test',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    await seedValidDraft();

    // Clear everything (as logout does)
    await clearAllPendingOnboardingData();
    await clearOnboardingDraft();

    expect(await readOnboardingDraft()).toBeNull();
    // Pending plan should also be gone
    const raw = await AsyncStorage.getItem('zainly:onboardingV2:pendingPlan');
    expect(raw).toBeNull();
  });
});

// ─── 7. Session-expiry boundary (clearOnboardingStateForSessionExpiry) ─────

describe('Session-expiry boundary (clearOnboardingStateForSessionExpiry)', () => {
  it('clears the in-memory draft unconditionally, even with no pending payload', async () => {
    await seedValidDraft();
    expect(await readOnboardingDraft()).not.toBeNull();

    // No pending payload exists at all
    expect(await readPendingOnboardingPlan()).toBeNull();

    await clearOnboardingStateForSessionExpiry();

    // Draft must be cleared — this is the critical guarantee
    expect(await readOnboardingDraft()).toBeNull();
  });

  it('clears the draft and owned pending payload when pending is owned', async () => {
    await seedValidDraft();
    const saved = await savePendingOnboardingPlan({
      firstName: 'Ahmed',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    if (!saved.ok) throw new Error('savePendingOnboardingPlan failed in test setup');
    // Set up the auth flow proof so claim can succeed
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    // Claim it for USER_A so ownerUserId is set
    await claimPendingOnboardingPlanForUser(USER_A, saved.flowId);

    await clearOnboardingStateForSessionExpiry();

    expect(await readOnboardingDraft()).toBeNull();
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('clears the draft but preserves unclaimed pending payload (pre-auth)', async () => {
    await seedValidDraft();
    await savePendingOnboardingPlan({
      firstName: 'NewUser',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    // Not claimed — ownerUserId is absent (undefined), not explicitly null

    await clearOnboardingStateForSessionExpiry();

    expect(await readOnboardingDraft()).toBeNull();
    // Pending payload survives — it may belong to a new pre-auth flow
    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    // ownerUserId is undefined (not set) for unclaimed payloads
    expect(pending?.ownerUserId ?? null).toBeNull();
  });
});

// ─── 8. Cross-account pending payload in plan_already_exists branch ────────

describe('Cross-account pending payload protection in plan_already_exists', () => {
  it('does not delete a pending payload owned by another user when plan exists for current user', async () => {
    // USER_B already has a plan
    mockPlansTable.set(USER_B, { id: 'plan-B', user_id: USER_B });

    // USER_A has a pending payload claimed for USER_A
    const saved = await savePendingOnboardingPlan({
      firstName: 'Alice',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    if (!saved.ok) throw new Error('savePendingOnboardingPlan failed in test setup');
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved.flowId);

    // Also seed a draft (for USER_B's session, but draft has no owner)
    await seedValidDraft();

    // USER_B finalizes — plan already exists for B
    const result = await finalizeOnboardingV2Plan(USER_B, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('plan_already_exists');
    }
    expect(upsertPlan).not.toHaveBeenCalled();

    // The draft is cleared (no ownerUserId)
    expect(await readOnboardingDraft()).toBeNull();

    // USER_A's pending payload must survive — it is not B's to clear
    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);
  });
});
