/// <reference types="jest" />
// ─── TodayScreen — hasNoPlan branch never shows the legacy CTA ─────────────────
//
// Reproduces the exact reported bug: a Google-authenticated user with no
// plan/progress lands on TodayScreen (e.g. via a stale-gate divergence)
// and must NEVER see the "Créons ton programme." / "Créer mon programme"
// CTA card. TodayScreen renders only a neutral background — it must
// never call router.replace itself; the actual navigation is owned by
// the central gate in app/_layout.tsx.
//
// Placed under src/lib/__tests__ (not app/__tests__) because the jest config
// excludes <rootDir>/app/ from testPathIgnorePatterns — TodayScreen is
// imported from its real app/ location, only the TEST FILE lives under src/.

import { create, act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TodayScreen from '../../../app/(app)/(tabs)/index';

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-google' } }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('@/components/providers/DashboardReadyProvider', () => ({
  useDashboardReady: () => ({ onDashboardLayout: jest.fn() }),
}));

jest.mock('@/hooks/useOnboardingV2AuthFinalize', () => ({
  useOnboardingV2AuthFinalize: () => ({
    status: 'idle',
    lastError: null,
    runFinalize: jest.fn(),
    retryFinalize: jest.fn(),
  }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
}));

jest.mock('@/db/plans', () => ({ fetchPlan: jest.fn(async () => null) }));
jest.mock('@/db/progress', () => ({ fetchProgress: jest.fn(async () => null) }));
jest.mock('@/db/reviewItems', () => ({
  fetchDueCount: jest.fn(async () => 0),
  fetchLearnedItems: jest.fn(async () => []),
}));
jest.mock('@/db/profiles', () => ({ fetchProfile: jest.fn(async () => null) }));
jest.mock('@/lib/pendingOnboardingPlan', () => ({
  hasValidPendingOnboardingPlanForUser: jest.fn(async () => false),
}));
jest.mock('@/lib/revenueCat', () => ({
  getRevenueCatCustomerInfo: jest.fn(async () => null),
  ensureRevenueCatReadyForUser: jest.fn(async () => ({ ready: true, generation: 1 })),
  getRevenueCatCurrentUserId: jest.fn(() => 'user-google'),
  getRevenueCatGeneration: jest.fn(() => 1),
}));
jest.mock('@/hooks/useZainlyPlusAccess', () => ({
  useZainlyPlusAccess: () => ({ hasZainlyPlus: false, isLoading: false }),
}));

function renderTodayScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <QueryClientProvider client={qc}>
        <TodayScreen />
      </QueryClientProvider>,
    );
  });
  return tree!;
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(100);
    });
  }
}

describe('TodayScreen — hasNoPlan (Google user, no plan/progress)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    mockReplace.mockClear();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('never renders the legacy CTA text and never navigates itself', async () => {
    const tree = renderTodayScreen();
    await flushMicrotasks();

    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('Créons ton programme');
    expect(json).not.toContain('Créer mon programme');
    expect(json).not.toMatch(/buttonLabel/);

    expect(mockReplace).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });
});
