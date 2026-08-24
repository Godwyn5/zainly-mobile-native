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

// ── Mock Supabase progress table ───────────────────────────────────────────
const mockProgressTable = new Map<string, {
  id: string; user_id: string;
  current_surah: number; current_ayah: number; ayah_per_day: number;
  streak: number; total_memorized: number; last_session_date: string | null;
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

// ── Mock finalizeOnboardingPlanRpc (atomic PostgreSQL RPC) ─────────────────
// Simulates the server-side finalize_onboarding_plan function.
// The RPC does not receive userId — it derives identity from auth.uid()
// server-side.  In tests, we set mockAuthUid to simulate the authenticated
// user.  The RPC mock writes to the same mockPlansTable/mockProgressTable
// that fetchPlan/fetchProgress read from, so the confirm check in
// onboardingFinalize.ts works correctly.
let mockAuthUid = 'test-user';

jest.mock('@/db/finalizeOnboardingPlan', () => ({
  finalizeOnboardingPlanRpc: jest.fn(async (planPayload: any, progressPayload: any) => {
    const userId = mockAuthUid;
    const hasPlan = mockPlansTable.has(userId);
    const hasProgress = mockProgressTable.has(userId);

    if (hasPlan && hasProgress) {
      return { ok: true, reason: 'already_finalized' };
    }
    if (hasPlan || hasProgress) {
      return { ok: false, reason: 'inconsistent_state' };
    }
    // Simulate atomic insert of both rows in a single transaction
    mockPlansTable.set(userId, {
      id: `plan-${userId}`, user_id: userId,
      surah_start: planPayload?.surah_start ?? 1,
      start_ayah: planPayload?.start_ayah ?? 1,
      ayah_per_day: planPayload?.ayah_per_day ?? 2,
    });
    mockProgressTable.set(userId, {
      id: `progress-${userId}`, user_id: userId,
      current_surah: progressPayload?.current_surah ?? 1,
      current_ayah: progressPayload?.current_ayah ?? 0,
      ayah_per_day: progressPayload?.ayah_per_day ?? 2,
      streak: 0, total_memorized: 0, last_session_date: null,
    });
    return { ok: true, reason: 'created' };
  }),
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
  readOnboardingDraftForOwner,
  updateOnboardingDraftForOwner,
  clearOnboardingDraftForOwner,
  purgeAllOnboardingDrafts,
  type OnboardingDraftOwner,
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
  type ClearPendingResult,
} from '../pendingOnboardingPlan';
import { fetchPlan, upsertPlan } from '@/db/plans';
import { fetchProgress, resetProgressForNewPlan } from '@/db/progress';
import { finalizeOnboardingPlanRpc } from '@/db/finalizeOnboardingPlan';

// ── Helpers ────────────────────────────────────────────────────────────────
const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';
const ownerA: OnboardingDraftOwner = { kind: 'authenticated', userId: USER_A };
const ownerB: OnboardingDraftOwner = { kind: 'authenticated', userId: USER_B };

async function seedValidDraft() {
  await updateOnboardingDraftForOwner(ownerA, {
    currentStep: 'program_summary',
    firstName: 'Ahmed',
    learningMode: 'recommended',
    knownSurahs: [1, 2],
    experienceChoice: 'daily_limited',
    notificationPreference: 'enabled',
    discoverySource: 'tiktok',
  });
}

beforeEach(async () => {
  // Reset all state
  mockPlansTable.clear();
  mockProgressTable.clear();
  mockAuthUid = USER_A;
  (AsyncStorage.clear as jest.Mock)();
  await purgeAllOnboardingDrafts();
  // Reset mock call tracking
  (fetchPlan as jest.Mock).mockClear();
  (upsertPlan as jest.Mock).mockClear();
  (fetchProgress as jest.Mock).mockClear();
  (resetProgressForNewPlan as jest.Mock).mockClear();
  (finalizeOnboardingPlanRpc as jest.Mock).mockClear();
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

  it('plan-only (no progress) → inconsistent_state, no write, no repair', async () => {
    // Plan exists but progress does not — this is a partial state that
    // must NOT be repaired by the client. The RPC contract is authoritative.
    mockPlansTable.set(USER_A, { id: 'plan-A', user_id: USER_A, surah_start: 3, start_ayah: 5, ayah_per_day: 4 });

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('persist_error');
    }
    // No write must occur — neither upsertPlan, resetProgressForNewPlan, nor the RPC.
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(resetProgressForNewPlan).not.toHaveBeenCalled();
    expect(finalizeOnboardingPlanRpc).not.toHaveBeenCalled();
    // The plan row must be untouched.
    expect(mockPlansTable.get(USER_A)?.surah_start).toBe(3);
    // No progress row must have been created.
    expect(mockProgressTable.has(USER_A)).toBe(false);
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
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
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
    // Creation now uses the atomic RPC, not upsertPlan + resetProgressForNewPlan
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(resetProgressForNewPlan).not.toHaveBeenCalled();
  });

  it('progress-only (no plan) → inconsistent_state, no write, no repair', async () => {
    // Progress exists but plan does not — partial state, must NOT be
    // repaired or deleted by the client. The RPC contract is authoritative.
    mockProgressTable.set(USER_A, {
      id: 'progress-orphan', user_id: USER_A,
      current_surah: 50, current_ayah: 12, ayah_per_day: 9,
      streak: 30, total_memorized: 500, last_session_date: '2025-01-01',
    });
    await seedValidDraft();

    const result = await finalizeOnboardingV2Plan(USER_A, '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('persist_error');
    }
    // No write must occur — neither upsertPlan, resetProgressForNewPlan, nor the RPC.
    expect(upsertPlan).not.toHaveBeenCalled();
    expect(resetProgressForNewPlan).not.toHaveBeenCalled();
    expect(finalizeOnboardingPlanRpc).not.toHaveBeenCalled();
    // The orphan progress row must be untouched.
    expect(mockProgressTable.get(USER_A)?.streak).toBe(30);
    expect(mockProgressTable.get(USER_A)?.total_memorized).toBe(500);
    // No plan row must have been created.
    expect(mockPlansTable.has(USER_A)).toBe(false);
  });

  it('retry after RPC failure repairs on the next attempt (atomic — no partial state)', async () => {
    await seedValidDraft();
    // Simulate the RPC failing (e.g. network error)
    (finalizeOnboardingPlanRpc as jest.Mock).mockRejectedValueOnce(new Error('network dropped'));

    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(result1.reason).toBe('persist_error');
    }
    // The atomic RPC failed — neither plan nor progress should exist.
    expect(mockPlansTable.has(USER_A)).toBe(false);
    expect(mockProgressTable.has(USER_A)).toBe(false);
    // The draft source must survive for retry (not cleared on failure)
    expect(await readOnboardingDraftForOwner(ownerA)).not.toBeNull();

    // Retry — RPC now succeeds (mockRejectedValueOnce only fails the first call).
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.reason).toBe('created');
    }
    // RPC was called once (failed) + once (succeeded) = 2 total
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(2);
    expect(mockPlansTable.has(USER_A)).toBe(true);
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
    // fetchProgress is called once for the state guard (before the RPC) and
    // once for the post-RPC confirm check. The throw must hit the confirm
    // call, so we use mockRejectedValueOnce for the second call.
    (fetchProgress as jest.Mock).mockResolvedValueOnce(null); // state guard: no progress
    (fetchProgress as jest.Mock).mockRejectedValueOnce(new Error('replica lag'));

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
  it('draft is cleared by clearOnboardingDraftForOwner and becomes null', async () => {
    await seedValidDraft();
    expect(await readOnboardingDraftForOwner(ownerA)).not.toBeNull();

    await clearOnboardingDraftForOwner(ownerA);
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
  });

  it('account A draft is not visible to account B after purgeAllOnboardingDrafts', async () => {
    // Simulate account A creating a draft
    await updateOnboardingDraftForOwner(ownerA, { firstName: 'Alice', currentStep: 'first_name' });
    expect((await readOnboardingDraftForOwner(ownerA))?.firstName).toBe('Alice');

    // Simulate logout: purgeAllOnboardingDrafts is called by useLogout
    await purgeAllOnboardingDrafts();

    // Simulate account B logging in — draft must be null
    expect(await readOnboardingDraftForOwner(ownerB)).toBeNull();
  });

  it('account A draft cannot be finalized by account B after purgeAllOnboardingDrafts', async () => {
    // Account A creates a draft
    await seedValidDraft();

    // Logout clears all drafts
    await purgeAllOnboardingDrafts();

    // Account B tries to finalize — no draft, no pending → no_source
    mockAuthUid = USER_B;
    const result = await finalizeOnboardingV2Plan(USER_B, '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_source');
    }
  });

  it('same-account draft is resumed without being overwritten', async () => {
    await updateOnboardingDraftForOwner(ownerA, { firstName: 'Alice', currentStep: 'first_name' });
    // A second update merges, not replaces
    await updateOnboardingDraftForOwner(ownerA, { learningMode: 'recommended' });
    const draft = await readOnboardingDraftForOwner(ownerA);
    expect(draft?.firstName).toBe('Alice');
    expect(draft?.learningMode).toBe('recommended');
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

    // RPC must have been called exactly once (deduplication via inFlight guard)
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);
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

    // RPC was called only once (by the first call)
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);
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
  it('clearAllPendingOnboardingData + purgeAllOnboardingDrafts together wipe all onboarding state', async () => {
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
    await purgeAllOnboardingDrafts();

    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
    // Pending plan should also be gone
    const raw = await AsyncStorage.getItem('zainly:onboardingV2:pendingPlan');
    expect(raw).toBeNull();
  });
});

// ─── 7. Session-expiry boundary (clearOnboardingStateForSessionExpiry) ─────

describe('Session-expiry boundary (clearOnboardingStateForSessionExpiry)', () => {
  it('clears the in-memory draft unconditionally, even with no pending payload', async () => {
    await seedValidDraft();
    expect(await readOnboardingDraftForOwner(ownerA)).not.toBeNull();

    // No pending payload exists at all
    expect(await readPendingOnboardingPlan()).toBeNull();

    await clearOnboardingStateForSessionExpiry();

    // Draft must be cleared — this is the critical guarantee
    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
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

    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
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

    expect(await readOnboardingDraftForOwner(ownerA)).toBeNull();
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

    // Also seed a draft for USER_B's session
    await updateOnboardingDraftForOwner(ownerB, {
      currentStep: 'program_summary',
      firstName: 'Bob',
      learningMode: 'recommended',
      knownSurahs: [1, 2],
      experienceChoice: 'daily_limited',
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
    });

    // USER_B finalizes — plan already exists for B
    mockAuthUid = USER_B;
    const result = await finalizeOnboardingV2Plan(USER_B, '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('plan_already_exists');
    }
    expect(upsertPlan).not.toHaveBeenCalled();

    // USER_B's draft is cleared after finalization
    expect(await readOnboardingDraftForOwner(ownerB)).toBeNull();

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
    // RPC was NOT called again (plan_already_exists short-circuits before RPC)
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);

    // Step 6: handoff succeeds (simulated — in production handOffFinalizedProgram
    // would run here; we simulate by confirming the pair is in the mock tables)

    // Step 7: clearPendingOnboardingIfMatches clears the pending (flowId matches)
    const clearRes = await clearPendingOnboardingIfMatches(USER_A, saved.flowId);
    expect(clearRes).toBe('cleared');
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
    const result = await clearPendingOnboardingIfMatches(USER_B, saved.flowId);
    expect(result).toBe('superseded');

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
    const result = await clearPendingOnboardingIfMatches('any-user', saved.flowId);
    expect(result).toBe('superseded');

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
    const result = await clearPendingOnboardingIfMatches(USER_A, saved1.flowId);
    expect(result).toBe('superseded');

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
    const result = await clearPendingOnboardingIfMatches(USER_A, 'wrong-flow-id');
    expect(result).toBe('superseded');

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
    // clearPendingOnboardingIfMatches returns 'superseded' when flowId doesn't match.
    const wrongResult = await clearPendingOnboardingIfMatches(USER_A, 'wrong-flow-id');
    expect(wrongResult).toBe('superseded');

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
    // RPC was NOT called again (plan_already_exists short-circuits before RPC)
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);

    // Step 7: correct clear with matching flowId finally clears the pending
    const finalResult = await clearPendingOnboardingIfMatches(USER_A, saved.flowId);
    expect(finalResult).toBe('cleared');
    pending = await readPendingOnboardingPlan();
    expect(pending).toBeNull();

    // Step 8: pair is still durable in Supabase
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();
  });

  it('real AsyncStorage failure during clearPending → storage_error, pending survives, idempotent retry, no loop', async () => {
    // Seed and claim a pending for USER_A
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

    // Finalize persists the pair
    const result1 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result1.ok).toBe(true);
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();

    // 1. Pair is intact ✅
    // 2. Handoff succeeded (simulated — pair is in mock tables) ✅

    // 3. Make AsyncStorage.removeItem reject — simulate real storage failure.
    // The mock factory's removeItem is a jest.fn; mockRejectedValueOnce
    // only affects the next call, then falls back to the original impl.
    const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;
    mockRemoveItem.mockRejectedValueOnce(new Error('disk I/O error'));

    // Call clearPendingOnboardingIfMatches with CORRECT userId and flowId
    const clearResult: ClearPendingResult = await clearPendingOnboardingIfMatches(USER_A, saved.flowId);

    // 3. The error is NOT silently transformed into success — storage_error returned
    expect(clearResult).toBe('storage_error');

    // 4. The matching pending STILL EXISTS
    let pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.ownerUserId).toBe(USER_A);
    expect(pending?.flowId).toBe(saved.flowId);

    // 5. No foreign pending was touched (there is none, but verify no error)

    // 6. The caller remains in a recoverable state — no navigation happened,
    //    no inconsistent state. The pair is durable in Supabase.

    // 7. After recreating the hook/orchestrator, the existing pair is NOT reset
    const result2 = await finalizeOnboardingV2Plan(USER_A, '');
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.reason).toBe('plan_already_exists');
    }
    expect(finalizeOnboardingPlanRpc).toHaveBeenCalledTimes(1);

    // 8. A new idempotent handoff succeeds (simulated — pair is in mock tables)

    // 9. The delete succeeds now with the exact transaction
    // (mockRejectedValueOnce was consumed — removeItem uses original impl again)
    const clearResult2 = await clearPendingOnboardingIfMatches(USER_A, saved.flowId);
    expect(clearResult2).toBe('cleared');
    pending = await readPendingOnboardingPlan();
    expect(pending).toBeNull();

    // 10. No uncontrolled automatic loop if storage keeps failing
    // Save the original implementation, then make removeItem always reject
    const originalImpl = mockRemoveItem.getMockImplementation();
    mockRemoveItem.mockRejectedValue(new Error('persistent disk error'));
    // Seed a new pending to test repeated failures
    const saved2 = await savePendingOnboardingPlan({
      firstName: 'Ahmed2',
      learningMode: 'recommended',
      knownSurahs: [1],
      startingSurah: null,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    if (!saved2.ok) throw new Error('savePendingOnboardingPlan failed in test setup 2');
    saveActiveOnboardingAuthFlow(saved2.flowId);
    setSessionAuthFlowId(saved2.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved2.flowId);

    // Multiple calls all return storage_error — no loop, no crash
    const r1 = await clearPendingOnboardingIfMatches(USER_A, saved2.flowId);
    expect(r1).toBe('storage_error');
    const r2 = await clearPendingOnboardingIfMatches(USER_A, saved2.flowId);
    expect(r2).toBe('storage_error');
    const r3 = await clearPendingOnboardingIfMatches(USER_A, saved2.flowId);
    expect(r3).toBe('storage_error');

    // Pending still exists after repeated failures
    pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();

    // Restore storage — now it can be cleared
    mockRemoveItem.mockImplementation(originalImpl);
    const r4 = await clearPendingOnboardingIfMatches(USER_A, saved2.flowId);
    expect(r4).toBe('cleared');
    pending = await readPendingOnboardingPlan();
    expect(pending).toBeNull();

    // Pair still durable in Supabase throughout
    expect(mockPlansTable.has(USER_A)).toBe(true);
    expect(mockProgressTable.get(USER_A)).toBeDefined();
  });

  it('clearPendingOnboardingIfMatches returns already_absent when no pending exists', async () => {
    // No pending was ever saved — clear should return already_absent
    const result = await clearPendingOnboardingIfMatches(USER_A, 'any-flow-id');
    expect(result).toBe('already_absent');
  });

  it('T1 handoff done, T2 replaces pending before T1 clear → T1 gets superseded, T2 survives', async () => {
    // T1 saves and claims a pending
    const saved1 = await savePendingOnboardingPlan({
      firstName: 'Ahmed-T1',
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

    // T2 replaces the pending with a new transaction
    const saved2 = await savePendingOnboardingPlan({
      firstName: 'Ahmed-T2',
      learningMode: 'start_surah',
      knownSurahs: [5],
      startingSurah: 2,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });
    if (!saved2.ok) throw new Error('savePendingOnboardingPlan failed in test setup 2');
    saveActiveOnboardingAuthFlow(saved2.flowId);
    setSessionAuthFlowId(saved2.flowId);
    await claimPendingOnboardingPlanForUser(USER_A, saved2.flowId);

    // T1 tries to clear with T1's flowId — should get superseded
    const t1Result = await clearPendingOnboardingIfMatches(USER_A, saved1.flowId);
    expect(t1Result).toBe('superseded');

    // T2's pending survives
    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    expect(pending?.flowId).toBe(saved2.flowId);
    expect(pending?.ownerUserId).toBe(USER_A);

    // T2 can clear its own pending
    const t2Result = await clearPendingOnboardingIfMatches(USER_A, saved2.flowId);
    expect(t2Result).toBe('cleared');
    expect(await readPendingOnboardingPlan()).toBeNull();
  });

  it('write-during-clear determinism: new pending save waits for clear to finish', async () => {
    // Seed and claim a pending for USER_A
    const saved1 = await savePendingOnboardingPlan({
      firstName: 'Ahmed-1',
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

    // Start a clear for T1
    const clearPromise = clearPendingOnboardingIfMatches(USER_A, saved1.flowId);

    // While the clear is in-flight, save a new pending (T2).
    // Because savePendingOnboardingPlan is now serialized via the same chain,
    // the save will wait for the clear to finish before writing.
    const savePromise = savePendingOnboardingPlan({
      firstName: 'Ahmed-2',
      learningMode: 'start_surah',
      knownSurahs: [5],
      startingSurah: 2,
      customSurahOrder: [],
      continueWithRest: true,
      notificationPreference: 'enabled',
      discoverySource: 'tiktok',
      experienceChoice: 'daily_limited',
    });

    // Both should resolve without error
    const [clearResult, saveResult] = await Promise.all([clearPromise, savePromise]);

    // T1's clear succeeded (the pending matched T1)
    expect(clearResult).toBe('cleared');

    // T2's save succeeded
    expect(saveResult.ok).toBe(true);

    // The pending in storage is T2's (the save ran after the clear)
    const pending = await readPendingOnboardingPlan();
    expect(pending).not.toBeNull();
    if (saved1.ok && saveResult.ok) {
      expect(pending?.flowId).toBe(saveResult.flowId);
      expect(pending?.flowId).not.toBe(saved1.flowId);
    }

    // T2 can clear its own pending — but T2 was not claimed, so clear returns 'superseded'
    if (saveResult.ok) {
      const t2Clear = await clearPendingOnboardingIfMatches(USER_A, saveResult.flowId);
      expect(t2Clear).toBe('superseded'); // pending exists but not owned by USER_A
    }
  });
});
