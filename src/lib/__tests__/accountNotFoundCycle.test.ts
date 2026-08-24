/// <reference types="jest" />
// ─── accountNotFoundCycle.test.ts ───────────────────────────────────────────
// 12 integration tests proving the full account_not_found cycle:
//
//   1. prepareAuthenticatedLaunch returns account_not_found when plan+progress are null
//   2. prepareAuthenticatedLaunch returns ready when plan+progress exist
//   3. prepareAuthenticatedLaunch returns error when one query rejects
//   4. shouldSignOutForAccountNotFound returns true only for matching userId + account_not_found
//   5. shouldSignOutForAccountNotFound returns false for needs_onboarding
//   6. shouldSignOutForAccountNotFound returns false for ready
//   7. shouldSignOutForAccountNotFound returns false for error
//   8. shouldSignOutForAccountNotFound returns false when userId mismatches
//   9. shouldSignOutForAccountNotFound returns false when not authed
//  10. canRenderStackForUser returns false for account_not_found (app never mounts)
//  11. canRenderOnboardingStackForUser returns false for account_not_found (no auto-onboarding)
//  12. canRenderOnboardingStackForUser returns true for needs_onboarding (legitimate onboarding)

import { QueryClient } from '@tanstack/react-query';
import { prepareAuthenticatedLaunch, purgeUserScopedCaches } from '../prepareAuthenticatedLaunch';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import {
  hasValidPendingOnboardingPlanForUser,
  readPendingOnboardingPlan,
} from '@/lib/pendingOnboardingPlan';
import {
  canRenderStackForUser,
  canRenderOnboardingStackForUser,
  shouldSignOutForAccountNotFound,
  createAccountNotFoundState,
  createNeedsOnboardingState,
  createReadyState,
  createErrorState,
} from '../preparationStateMachine';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/db/plans', () => ({
  fetchPlan: jest.fn(),
}));
jest.mock('@/db/progress', () => ({
  fetchProgress: jest.fn(),
}));
jest.mock('@/db/reviewItems', () => ({
  fetchDueCount: jest.fn(async () => 0),
  fetchLearnedItems: jest.fn(async () => []),
}));
jest.mock('@/db/profiles', () => ({
  fetchProfile: jest.fn(async () => null),
}));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  hasValidPendingOnboardingPlanForUser: jest.fn(async () => false),
  readPendingOnboardingPlan: jest.fn(async () => null),
  setSessionAuthFlowId: jest.fn(),
  getSessionAuthFlowId: jest.fn(() => ''),
  clearSessionAuthFlowId: jest.fn(),
  invalidateStaleOnboardingAuthorization: jest.fn(async () => {}),
  saveCompletedAuthProof: jest.fn(async () => {}),
}));
jest.mock('@/lib/onboardingFinalize', () => ({
  finalizeOnboardingV2Plan: jest.fn(),
}));
jest.mock('@/lib/onboardingDashboardHandoff', () => ({
  handOffFinalizedProgram: jest.fn(),
}));
jest.mock('@/lib/revenueCat', () => ({
  getRevenueCatCustomerInfo: jest.fn(async () => null),
  ensureRevenueCatReadyForUser: jest.fn(async () => {}),
  getRevenueCatCurrentUserId: jest.fn(() => null),
  getRevenueCatGeneration: jest.fn(() => 0),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

const USER_ID = 'user-google-123';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('account_not_found full cycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hasValidPendingOnboardingPlanForUser as jest.Mock).mockResolvedValue(false);
    (readPendingOnboardingPlan as jest.Mock).mockResolvedValue(null);
  });

  // 1. prepareAuthenticatedLaunch returns account_not_found when plan+progress are null
  test('1. plan=null + progress=null → account_not_found', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue(null);
    (fetchProgress as jest.Mock).mockResolvedValue(null);

    const result = await prepareAuthenticatedLaunch(makeQueryClient(), USER_ID);

    expect(result.status).toBe('account_not_found');
  });

  // 2. prepareAuthenticatedLaunch returns ready when plan+progress exist
  test('2. plan=non-null + progress=non-null → ready', async () => {
    (fetchPlan as jest.Mock).mockResolvedValue({ id: 'plan-1' });
    (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-1' });

    const result = await prepareAuthenticatedLaunch(makeQueryClient(), USER_ID);

    expect(result.status).toBe('ready');
  });

  // 3. prepareAuthenticatedLaunch returns error when one query rejects
  test('3. plan rejects → error', async () => {
    (fetchPlan as jest.Mock).mockRejectedValue(new Error('network'));
    (fetchProgress as jest.Mock).mockResolvedValue({ id: 'progress-1' });

    const result = await prepareAuthenticatedLaunch(makeQueryClient(), USER_ID);

    expect(result.status).toBe('error');
  });

  // 4. shouldSignOutForAccountNotFound returns true only for matching userId + account_not_found
  test('4. authed + account_not_found + matching userId → true', () => {
    const prep = createAccountNotFoundState(USER_ID);
    expect(shouldSignOutForAccountNotFound(true, prep, USER_ID)).toBe(true);
  });

  // 5. shouldSignOutForAccountNotFound returns false for needs_onboarding
  test('5. authed + needs_onboarding + matching userId → false', () => {
    const prep = createNeedsOnboardingState(USER_ID);
    expect(shouldSignOutForAccountNotFound(true, prep, USER_ID)).toBe(false);
  });

  // 6. shouldSignOutForAccountNotFound returns false for ready
  test('6. authed + ready + matching userId → false', () => {
    const prep = createReadyState(USER_ID);
    expect(shouldSignOutForAccountNotFound(true, prep, USER_ID)).toBe(false);
  });

  // 7. shouldSignOutForAccountNotFound returns false for error
  test('7. authed + error + matching userId → false', () => {
    const prep = createErrorState(USER_ID, new Error('test'));
    expect(shouldSignOutForAccountNotFound(true, prep, USER_ID)).toBe(false);
  });

  // 8. shouldSignOutForAccountNotFound returns false when userId mismatches
  test('8. authed + account_not_found + mismatched userId → false', () => {
    const prep = createAccountNotFoundState('user-other');
    expect(shouldSignOutForAccountNotFound(true, prep, USER_ID)).toBe(false);
  });

  // 9. shouldSignOutForAccountNotFound returns false when not authed
  test('9. not authed + account_not_found → false', () => {
    const prep = createAccountNotFoundState(USER_ID);
    expect(shouldSignOutForAccountNotFound(false, prep, USER_ID)).toBe(false);
  });

  // 10. canRenderStackForUser returns false for account_not_found (app never mounts)
  test('10. account_not_found → canRenderStack=false', () => {
    const prep = createAccountNotFoundState(USER_ID);
    expect(canRenderStackForUser(true, true, true, prep, USER_ID)).toBe(false);
  });

  // 11. canRenderOnboardingStackForUser returns false for account_not_found (no auto-onboarding)
  test('11. account_not_found → canRenderOnboardingStack=false', () => {
    const prep = createAccountNotFoundState(USER_ID);
    expect(canRenderOnboardingStackForUser(true, true, true, prep, USER_ID)).toBe(false);
  });

  // 12. canRenderOnboardingStackForUser returns true for needs_onboarding (legitimate onboarding)
  test('12. needs_onboarding → canRenderOnboardingStack=true', () => {
    const prep = createNeedsOnboardingState(USER_ID);
    expect(canRenderOnboardingStackForUser(true, true, true, prep, USER_ID)).toBe(true);
  });
});

// ── purgeUserScopedCaches tests ──────────────────────────────────────────────

describe('purgeUserScopedCaches', () => {
  test('removes only the specified user\'s queries, not other users\'', () => {
    const qc = makeQueryClient();
    // Seed user-A and user-B caches
    qc.setQueryData(['plan', 'user-A'], { id: 'plan-A' });
    qc.setQueryData(['progress', 'user-A'], { id: 'progress-A' });
    qc.setQueryData(['plan', 'user-B'], { id: 'plan-B' });
    qc.setQueryData(['progress', 'user-B'], { id: 'progress-B' });

    purgeUserScopedCaches(qc, 'user-A');

    expect(qc.getQueryData(['plan', 'user-A'])).toBeUndefined();
    expect(qc.getQueryData(['progress', 'user-A'])).toBeUndefined();
    expect(qc.getQueryData(['plan', 'user-B'])).toEqual({ id: 'plan-B' });
    expect(qc.getQueryData(['progress', 'user-B'])).toEqual({ id: 'progress-B' });
  });
});
