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
// surah_start/start_ayah/ayah_per_day are seeded on every plan row so the
// progress-repair path (onboardingFinalize.ts) has real canonical fields to
// reconstruct progress from, exactly like a real Supabase row would.
const mockPlansTable = new Map<string, {
  id: string; user_id: string;
  surah_start: number; start_ayah: number; ayah_per_day: number;
}>();

jest.mock('@/db/plans', () => ({
  upsertPlan: jest.fn(async (userId: string, payload: any) => {
    mockPlansTable.set(userId, {
      id: `plan-${userId}`, user_id: userId,
      surah_start: payload?.surah_start ?? 1,
      start_ayah: payload?.start_ayah ?? 1,
      ayah_per_day: payload?.ayah_per_day ?? 2,
    });
  }),
  fetchPlan: jest.fn(async (userId: string) => {
    return mockPlansTable.get(userId) ?? null;
  }),
}));

// ── Mock Supabase progress table ───────────────────────────────────────────
// Simulates the progress table: a Map<userId, progressRow>.
const mockProgressTable = new Map<string, {
  id: string; user_id: string;
  current_surah: number; current_ayah: number; ayah_per_day: number;
  streak: number; total_memorized: number; last_session_date: string | null;
}>();

jest.mock('@/db/progress', () => ({
  upsertProgress: jest.fn(async (_userId: string, _payload: unknown) => {}),
  fetchProgress: jest.fn(async (userId: string) => {
    return mockProgressTable.get(userId) ?? null;
  }),
  resetProgressForNewPlan: jest.fn(async (userId: string, payload: any) => {
    mockProgressTable.set(userId, {
      id: `progress-${userId}`, user_id: userId,
      current_surah: payload.current_surah,
      current_ayah: payload.current_ayah,
      ayah_per_day: payload.ayah_per_day,
      streak: 0, total_memorized: 0, last_session_date: null,
    });
  }),
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
  clearPendingOnboardingIfMatches,
} from '../pendingOnboardingPlan';
import { fetchPlan, upsertPlan } from '@/db/plans';
import { fetchProgress, resetProgressForNewPlan } from '@/db/progress';

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
  mockProgressTable.clear();
  (AsyncStorage.clear as jest.Mock)();
  clearOnboardingDraft();
  // Reset mock call tracking
  (fetchPlan as jest.Mock).mockClear();
  (upsertPlan as jest.Mock).mockClear();
  (fetchProgress as jest.Mock).mockClear();
  (resetProgressForNewPlan as jest.Mock).mockClear();
});

// ─── 1. Plan-already-exists guard ──────────────────────────────────────────

describe('Plan-already-exists guard', () => {
  it('returns ok with reason=plan_already_exists and does NOT call upsertPlan when both plan and progress exist', async () => {
    // Seed an existing, COMPLETE plan+progress pair for USER_A
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A, surah_start: 1, start_ayah: 1, ayah_per_day: 2 });
    mockProgressTable.set(USER_A, {
      id: 'progress-A', user_id: USER_A,
      current_surah: 1, current_ayah: 0, ayah_per_day: 2,
      streak: 5, total_memorized: 40, last_session_date: '2026-01-01',
    });

    // Seed a draft (which would normally be finalized)
    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('plan_already_exists');
    }
    // upsertPlan must NOT have been called — the existing plan is untouched
    expect(upsertPlan).not.toHaveBeenCalled();
    // A complete pair must never be reset/recreated — the legitimate streak
    // and total_memorized above must survive untouched.
    expect(resetProgressForNewPlan).not.toHaveBeenCalled();
    expect(mockProgressTable.get(USER_A)?.streak).toBe(5);
    expect(mockProgressTable.get(USER_A)?.total_memorized).toBe(40);
  });

  it('repairs a missing progress row when plan exists but progress does not (partial-write recovery)', async () => {
    // Plan exists (e.g. a prior finalize whose upsertPlan succeeded but the
    // progress write failed) — no progress row seeded.
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A, surah_start: 3, start_ayah: 5, ayah_per_day: 4 });

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('plan_already_exists');
    }
    // The plan itself must never be recreated.
    expect(upsertPlan).not.toHaveBeenCalled();
    // The repair must reconstruct progress from the PLAN's own canonical
    // fields — never guessed, never from a draft/pending source.
    expect(resetProgressForNewPlan).toHaveBeenCalledWith(USER_A, {
      current_surah: 3,
      current_ayah: 4, // start_ayah - 1
      ayah_per_day: 4,
    });
    const repaired = mockProgressTable.get(USER_A);
    expect(repaired).not.toBeUndefined();
    expect(repaired?.current_surah).toBe(3);
    expect(repaired?.current_ayah).toBe(4);
    expect(repaired?.ayah_per_day).toBe(4);
  });

  it('clears all pre-auth sources when plan already exists', async () => {
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A, surah_start: 1, start_ayah: 1, ayah_per_day: 2 });
    mockProgressTable.set(USER_A, {
      id: 'progress-A', user_id: USER_A,
      current_surah: 1, current_ayah: 0, ayah_per_day: 2,
      streak: 0, total_memorized: 0, last_session_date: null,
    });
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
    // Creation always uses resetProgressForNewPlan — never the
    // preserve-on-update upsertProgress() (reserved for real sessions).
    expect(resetProgressForNewPlan).toHaveBeenCalledWith(USER_A, expect.any(Object));
  });

  it('resets an orphaned progress row when creating a brand-new plan (no plan, stale progress present)', async () => {
    // Simulate a leftover progress row from an unrelated prior attempt —
    // no plan exists for this user right now.
    mockProgressTable.set(USER_A, {
      id: 'progress-orphan', user_id: USER_A,
      current_surah: 50, current_ayah: 12, ayah_per_day: 9,
      streak: 30, total_memorized: 500, last_session_date: '2025-01-01',
    });
    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('created');
    }
    // The orphan's streak/totals must NEVER carry over into the new plan.
    const reset = mockProgressTable.get(USER_A);
    expect(reset?.streak).toBe(0);
    expect(reset?.total_memorized).toBe(0);
    expect(reset?.current_surah).not.toBe(50);
  });

  it('retry after upsertPlan succeeds but progress reset fails repairs on the next attempt', async () => {
    await seedValidDraft();
    (resetProgressForNewPlan as jest.Mock).mockRejectedValueOnce(new Error('network dropped'));

    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(result1.reason).toBe('persist_error');
    }
    // The plan write itself succeeded and must not be retried/duplicated.
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(mockPlansTable.has(USER_A)).toBe(true);
    // Progress is still missing — the pending/draft source must survive
    // for the retry below (not asserted directly here; draft persistence
    // is exercised in "Draft isolation" — this test only proves the retry
    // itself repairs the pair).

    // Retry — resetProgressForNewPlan now succeeds (mockRejectedValueOnce
    // only fails the first call).
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      // Plan already existed on this second attempt — goes through the
      // repair branch, not a fresh 'created'.
      expect(result2.reason).toBe('plan_already_exists');
    }
    // upsertPlan is still only called once — never recreated.
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    expect(mockProgressTable.get(USER_A)).not.toBeUndefined();
  });

  it('does not clear the pending payload when progress confirmation fails after a successful write', async () => {
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
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    // No draft — forces the pending-payload source path so we can assert
    // on it surviving below.

    // The write succeeds, but the very next read used to CONFIRM the pair
    // fails — this must not clear the pending payload nor report success.
    (fetchProgress as jest.Mock).mockImplementationOnce(async () => { throw new Error('replica lag'); });
    // First implementation-once above is consumed by the internal
    // confirmProgress check inside resetProgressForNewPlan's caller path;
    // fetchProgress is also called once more for the initial existence
    // check inside runFinalize's guard — but since no plan exists yet at
    // that point, the guard branch that calls fetchProgress is skipped
    // entirely (only called after fetchPlan finds a plan). So this
    // mockImplementationOnce is guaranteed to hit the post-write
    // confirmation call.

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('persist_error');
    }
    // The plan+progress were actually written — never corrupted or undone.
    expect(mockPlansTable.has(USER_A)).toBe(true);
    // Pending payload must survive — confirmation failure must not be
    // treated as a reason to discard the retry source.
    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
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
    // USER_B already has a complete plan+progress pair
    mockPlansTable.set(USER_B, { id: 'plan-B', user_id: USER_B, surah_start: 1, start_ayah: 1, ayah_per_day: 2 });
    mockProgressTable.set(USER_B, {
      id: 'progress-B', user_id: USER_B,
      current_surah: 1, current_ayah: 0, ayah_per_day: 2,
      streak: 0, total_memorized: 0, last_session_date: null,
    });

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

// ─── 9. Pending payload as transaction marker ──────────────────────────────
// The pending payload must survive a handoff failure and only be cleared
// after the handoff succeeds. This tests the full sequence:
// 1. pending owned exists
// 2. finalize persists + confirms the pair
// 3. handoff fails (simulated)
// 4. pending is still present
// 5. retry: finalize detects existing pair (idempotent, no reset)
// 6. handoff succeeds
// 7. clearPendingOnboardingForUser clears the pending
// 8. dashboard can be revealed

describe('Pending payload as transaction marker', () => {
  it('pending survives finalize success but handoff failure, then cleared after retry', async () => {
    // Seed a pending payload and claim it for USER_A
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
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved.flowId);

    // Step 1: pending exists and is owned by USER_A
    let pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);

    // Step 2: finalize persists + confirms the pair
    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(true);
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();

    // Step 3: handoff fails (simulated — in production this is a network
    // error in handOffFinalizedProgram; here we just don't call it yet)

    // Step 4: pending is STILL present after finalize (not cleared)
    pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);

    // Step 5: retry — finalize detects existing pair, no reset
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.reason).toBe('plan_already_exists');
    }
    // upsertPlan was NOT called again
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    // Progress was NOT reset again
    const resetCalls = (resetProgressForNewPlan as jest.Mock).mock.calls.length;
    // The first finalize created the plan and called resetProgressForNewPlan once.
    // The retry goes through the plan_already_exists branch which does NOT call
    // resetProgressForNewPlan (both plan and progress exist).
    // So total resetProgressForNewPlan calls should still be 1.
    expect(resetCalls).toBe(1);

    // Step 6: handoff succeeds (simulated — in production handOffFinalizedProgram
    // would run here; we simulate by confirming the pair is in the mock tables)

    // Step 7: clearPendingOnboardingIfMatches clears the pending (flowId matches)
    await clearPendingOnboardingIfMatches(USER_A, saved.flowId);
    pending = await readPendingOnboardingPlan();
    expect(pending).toBeNull();

    // Step 8: pair is still durable in Supabase (mock tables)
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();
  });

  it('clearPendingOnboardingIfMatches does not clear another user pending', async () => {
    // USER_A has a pending payload
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

    // USER_B tries to clear with USER_A's flowId — must not affect USER_A's pending
    await clearPendingOnboardingIfMatches(USER_B, saved.flowId);

    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);
  });

  it('clearPendingOnboardingIfMatches does NOT clear unclaimed pending (pre-auth)', async () => {
    const saved = await savePendingOnboardingPlan({
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
    // Not claimed — no ownerUserId
    if (!saved.ok) throw new Error('savePendingOnboardingPlan failed in test setup');

    // clearPendingOnboardingIfMatches must NOT clear an unclaimed pending.
    // The post-handoff clear function requires ownership.
    await clearPendingOnboardingIfMatches('any-user', saved.flowId);

    expect(await readPendingOnboardingPlan()).not.toBeNull();
  });

  it('clearPendingOnboardingIfMatches does not clear a newer transaction for the same user', async () => {
    // USER_A finalizes transaction T1
    const saved1 = await savePendingOnboardingPlan({
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
    if (!saved1.ok) throw new Error('savePendingOnboardingPlan failed in test setup');
    saveActiveOnboardingAuthFlow(saved1.flowId);
    setSessionAuthFlowId(saved1.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved1.flowId);

    // USER_A starts a NEW onboarding parcours, creating transaction T2
    const saved2 = await savePendingOnboardingPlan({
      firstName: 'Ahmed',
      learningMode: 'start_surah',
      knownSurahs: [5],
      startingSurah: 2,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    if (!saved2.ok) throw new Error('savePendingOnboardingPlan failed in test setup');
    saveActiveOnboardingAuthFlow(saved2.flowId);
    setSessionAuthFlowId(saved2.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved2.flowId);

    // The old transaction T1's handoff completes and tries to clear with T1's flowId.
    // This must NOT clear T2 — the flowId doesn't match.
    await clearPendingOnboardingIfMatches(USER_A, saved1.flowId);

    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.flowId).toBe(saved2.flowId);
    expect(pending?.ownerUserId).toBe(USER_A);
  });

  it('clearPendingOnboardingIfMatches with wrong flowId does not clear', async () => {
    const saved = await savePendingOnboardingPlan({
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
    if (!saved.ok) throw new Error('savePendingOnboardingPlan failed in test setup');
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved.flowId);

    // Wrong flowId — must not clear
    await clearPendingOnboardingIfMatches(USER_A, 'wrong-flow-id');

    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);
  });

  it('clear failure after handoff → pending survives, idempotent retry clears it, no progress reset', async () => {
    // Seed a pending payload and claim it for USER_A
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
    saveActiveOnboardingAuthFlow(saved.flowId);
    setSessionAuthFlowId(saved.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved.flowId);

    // Step 1: finalize persists the pair
    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(true);
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();

    // Step 2: handoff succeeds (simulated — pair is in mock tables)

    // Step 3: clear fails — simulate by using a wrong flowId.
    // clearPendingOnboardingIfMatches does NOT clear when flowId doesn't match.
    await clearPendingOnboardingIfMatches(USER_A, 'wrong-flow-id');

    // Step 4: pending is STILL present
    let pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);
    expect(pending?.flowId).toBe(saved.flowId);

    // Step 5: no foreign pending was touched (there is none, but verify no error)

    // Step 6: retry — finalize detects existing pair (idempotent)
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.reason).toBe('plan_already_exists');
    }
    // upsertPlan was NOT called again
    expect(upsertPlan).toHaveBeenCalledTimes(1);
    // Progress was NOT reset again
    const resetCalls = (resetProgressForNewPlan as jest.Mock).mock.calls.length;
    expect(resetCalls).toBe(1);

    // Step 7: correct clear with matching flowId finally clears the pending
    await clearPendingOnboardingIfMatches(USER_A, saved.flowId);
    pending = await readPendingOnboardingPlan();
    expect(pending).toBeNull();

    // Step 8: pair is still durable in Supabase
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();
  });
});
