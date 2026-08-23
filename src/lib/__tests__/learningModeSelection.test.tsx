/// <reference types="jest" />
// ─── learning-mode — a fresh selection must survive a re-render and must
// switch cleanly to a new choice, never reverting to the last PERSISTED
// (draft) value ──────────────────────────────────────────────────────────
//
// Reproduces the exact reported bug at the screen level: the user returns
// to this screen with a previously-answered mode already stored in the
// draft ('recommended'), taps a DIFFERENT card, the screen re-renders (as
// happens constantly from ambient/entrance Animated.Value updates and any
// parent re-render), and the freshly tapped card must still show as
// selected — never silently revert to the stale persisted draft value.
// Persistence only ever happens in handleContinue(), never mid-screen, so
// any re-render that re-syncs local state from the draft is the bug.
//
// Uses only react-test-renderer + act (already used elsewhere in this repo,
// e.g. src/lib/__tests__/todayScreenNoPlan.test.tsx) — no new dependency,
// no new test framework. useDraftOwner itself is mocked with a STABLE
// reference (the real, fixed behavior) — this test targets the screen's
// own interaction logic, not useDraftOwner (already covered by
// src/hooks/__tests__/useDraftOwner.test.tsx).
//
// Placed under src/lib/__tests__ (not app/__tests__) because the jest
// config excludes <rootDir>/app/ from testPathIgnorePatterns — the screen
// is imported from its real app/ location, only the TEST FILE lives here
// (same convention as src/lib/__tests__/todayScreenNoPlan.test.tsx).

import { create, act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import OnboardingLearningModeScreen from '../../../app/onboarding-v2/learning-mode';

const mockDraft: { firstName: string | null; motivationReason: string | null; learningMode: string | null } = {
  firstName: 'Yusuf',
  motivationReason: 'consistency',
  learningMode: 'recommended', // simulates a mode already answered in a previous pass
};

// Stable reference across renders — matches the real, fixed useDraftOwner
// (see src/hooks/useDraftOwner.ts's useMemo). Declared once at module scope
// so every render of the screen receives the exact same object.
const stableOwnerResult = { owner: { kind: 'authenticated', userId: 'user-1' } as const, sourceGuestFlowId: null };

jest.mock('@/hooks/useDraftOwner', () => ({
  useDraftOwner: () => stableOwnerResult,
}));

jest.mock('@/lib/onboardingDraft', () => ({
  readOnboardingDraftForOwner: jest.fn(async () => ({ ...mockDraft })),
  updateOnboardingDraftForOwner: jest.fn(async () => {}),
  setLearningModeAndCleanupBranchForOwner: jest.fn(async () => {}),
}));

jest.mock('@/lib/onboardingQuestionnaire', () => ({
  TOTAL_ONBOARDING_PHASES: 10,
  phaseStepNumber: () => 3,
  QUESTIONNAIRE_BACK_TARGETS: { learning_mode: '/onboarding-v2/motivation' },
}));

jest.mock('@/utils/haptics', () => ({ hapticLight: jest.fn() }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(500);
    });
  }
}

function renderScreen() {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<OnboardingLearningModeScreen />);
  });
  return tree!;
}

// react-test-renderer ships no .d.ts in this project, so findAllByType's
// element type resolves to `any` — this local shape covers only the props
// this test actually reads, avoiding an implicit-any lint error without
// depending on an unavailable library type.
interface CardTestNode {
  props: { accessibilityState?: { selected?: boolean }; onPress: () => void };
}

// Only OnboardingChoiceCard sets accessibilityState={{ selected }} — this
// filters out the header's back button and the bottom CTA, which are also
// TouchableOpacity instances but carry no `selected` accessibility state.
function findChoiceCards(tree: ReturnType<typeof create>): CardTestNode[] {
  return tree.root
    .findAllByType(TouchableOpacity)
    .filter((node: CardTestNode) => node.props.accessibilityState?.selected !== undefined);
}

function isCardSelected(tree: ReturnType<typeof create>, index: number): boolean {
  const cards = findChoiceCards(tree);
  return !!cards[index].props.accessibilityState?.selected;
}

function tapCard(tree: ReturnType<typeof create>, index: number) {
  const cards = findChoiceCards(tree);
  act(() => {
    cards[index].props.onPress();
  });
}

describe('OnboardingLearningModeScreen — selection survives re-render', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('lets the user change a previously-answered mode, keeps the new choice after a re-render, then switches cleanly again', async () => {
    const tree = renderScreen();
    await flushMicrotasks();

    // 3 choice cards rendered: [0]=recommended, [1]=start_surah, [2]=custom_order.
    // (findAllByType(TouchableOpacity) alone would also match the header's
    // back button and the bottom CTA — findChoiceCards filters those out.)
    const cards = findChoiceCards(tree);
    expect(cards).toHaveLength(3);

    // ── resumed state: the draft already has learningMode='recommended' ──
    expect(isCardSelected(tree, 0)).toBe(true);
    expect(isCardSelected(tree, 1)).toBe(false);

    // ── user changes their mind: tap "start_surah" (index 1) ──
    tapCard(tree, 1);
    expect(isCardSelected(tree, 1)).toBe(true);
    expect(isCardSelected(tree, 0)).toBe(false);
    expect(isCardSelected(tree, 2)).toBe(false);

    // ── force a re-render unrelated to the selection itself, exactly what
    // exposed the bug: any re-render (ambient animation tick, parent
    // update) must NOT re-sync local state from the stale persisted draft
    // value (learningMode is still 'recommended' in storage — persistence
    // only happens in handleContinue(), never before). ──
    act(() => {
      tree.update(<OnboardingLearningModeScreen />);
    });
    await flushMicrotasks();

    expect(isCardSelected(tree, 1)).toBe(true); // still selected — the bug would flip this back to card 0
    expect(isCardSelected(tree, 0)).toBe(false); // must NOT have reverted to the stale draft value

    // ── change the selection again, to a third card ──
    tapCard(tree, 2);
    expect(isCardSelected(tree, 2)).toBe(true);
    expect(isCardSelected(tree, 1)).toBe(false);

    // ── re-render again — the NEW selection must also survive ──
    act(() => {
      tree.update(<OnboardingLearningModeScreen />);
    });
    await flushMicrotasks();

    expect(isCardSelected(tree, 2)).toBe(true);
    expect(isCardSelected(tree, 1)).toBe(false);
    expect(isCardSelected(tree, 0)).toBe(false);

    act(() => { tree.unmount(); });
  });
});
